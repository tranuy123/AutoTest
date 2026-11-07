/**
 * May chu HTTP cua worker (runner).
 * API noi bo (orchestrator goi):
 * - GET    /health                 suc khoe + so phien
 * - POST   /sessions               tao phien (Xvnc neu co stream + Chromium + context rieng)
 * - POST   /sessions/:id/execute   chay ke hoach buoc cua phien (bat dong bo, bao ve orchestrator)
 * - GET    /sessions/:id           trang thai phien + ket qua khi xong
 * - DELETE /sessions/:id           dong phien ngay (phuc vu Dung lan chay)
 * - GET    /streams                trang thai Stream Gateway (AD-9)
 * - WS     /stream/:sessionId      cau noVNC cho trinh duyet xem (AD-9)
 *
 * Thong tin dang nhap chi nam trong bo nho cua phien, khong ghi log,
 * khong dua vao bat ky phan hoi API nao.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SessionFactory } from "./browser.js";
import { crmPathsFromEnv } from "./crm-actions.js";
import { SessionEngine } from "./engine.js";
import { OrchestratorClient } from "./orchestrator-client.js";
import { StreamGateway } from "./stream-gateway.js";
import type { SessionRequest, SessionResult, StepPlan } from "./types.js";
import { acceptWebSocket } from "./ws-min.js";
import type { DisplayHandle } from "./xvnc.js";

/** Nguon cap man hinh ao - XvncManager la ban that, test dung stub. */
export interface DisplayProvider {
  start: () => Promise<DisplayHandle>;
}

export interface RunnerDeps {
  factory: SessionFactory;
  xvnc: DisplayProvider;
  gateway: StreamGateway;
  log?: (message: string) => void;
}

type SessionState = "san-sang" | "dang-chay" | "xong" | "loi" | "da-dong";

interface SessionRecord {
  sessionId: string;
  req: SessionRequest;
  handle: Awaited<ReturnType<SessionFactory["launch"]>>;
  display: DisplayHandle | null;
  state: SessionState;
  result: SessionResult | null;
  orchestratorUrl: string | null;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseSessionRequest(body: Record<string, unknown>): SessionRequest | null {
  if (
    typeof body.runId !== "string" ||
    typeof body.roleId !== "string" ||
    (body.mode !== "xem" && body.mode !== "nhanh") ||
    typeof body.targetBaseUrl !== "string" ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    typeof body.artifactsDir !== "string"
  ) {
    return null;
  }
  return {
    runId: body.runId,
    roleId: body.roleId,
    mode: body.mode,
    targetBaseUrl: body.targetBaseUrl,
    username: body.username,
    password: body.password,
    artifactsDir: body.artifactsDir,
    stream: body.stream === true,
    ...(typeof body.paceMs === "number" ? { paceMs: body.paceMs } : {}),
  };
}

export function createRunnerServer(deps: RunnerDeps): Server {
  const sessions = new Map<string, SessionRecord>();
  const log = deps.log ?? ((message: string) => console.log(`[runner] ${message}`));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "@autotest/runner",
          sessions: sessions.size,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/streams") {
        sendJson(res, 200, { streams: deps.gateway.status() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/sessions") {
        const body = await readJsonBody(req);
        const sessionReq = parseSessionRequest(body);
        if (!sessionReq) {
          sendJson(res, 400, { error: "invalid_session_request" });
          return;
        }
        await mkdir(sessionReq.artifactsDir, { recursive: true });
        let display: DisplayHandle | null = null;
        try {
          if (sessionReq.stream && sessionReq.mode === "xem") {
            display = await deps.xvnc.start();
          }
          const handle = await deps.factory.launch(sessionReq, display);
          const sessionId = randomUUID();
          sessions.set(sessionId, {
            sessionId,
            req: sessionReq,
            handle,
            display,
            state: "san-sang",
            result: null,
            orchestratorUrl: null,
          });
          if (display) deps.gateway.register(sessionId, display.vncPort);
          log(
            `da tao phien ${sessionId} cho lan chay ${sessionReq.runId}, vai ${sessionReq.roleId}`,
          );
          sendJson(res, 201, {
            sessionId,
            runId: sessionReq.runId,
            roleId: sessionReq.roleId,
            stream: display
              ? { vncPort: display.vncPort, wsPath: `/stream/${sessionId}` }
              : null,
          });
        } catch (error) {
          if (display) await display.stop().catch(() => undefined);
          log(
            `tao phien that bai cho lan chay ${sessionReq.runId}, vai ${sessionReq.roleId}: ` +
              (error instanceof Error ? error.message : "loi khong ro"),
          );
          sendJson(res, 500, {
            error: "session_create_failed",
            message: error instanceof Error ? error.message : "lỗi không rõ",
          });
        }
        return;
      }

      const executeMatch = /^\/sessions\/([^/]+)\/execute$/.exec(url.pathname);
      if (req.method === "POST" && executeMatch) {
        const sessionId = decodeURIComponent(executeMatch[1] ?? "");
        const record = sessions.get(sessionId);
        if (!record) {
          sendJson(res, 404, { error: "session_not_found" });
          return;
        }
        if (record.state === "dang-chay") {
          sendJson(res, 409, { error: "session_busy" });
          return;
        }
        const body = await readJsonBody(req);
        const steps = Array.isArray(body.steps) ? (body.steps as StepPlan[]) : null;
        const orchestratorUrl =
          typeof body.orchestratorUrl === "string" ? body.orchestratorUrl : null;
        if (!steps || !orchestratorUrl) {
          sendJson(res, 400, { error: "invalid_execute_request" });
          return;
        }
        record.state = "dang-chay";
        record.orchestratorUrl = orchestratorUrl;
        sendJson(res, 202, { accepted: true, sessionId });
        // Chay bat dong bo: tien do va ket qua bao ve orchestrator qua callback.
        const client = new OrchestratorClient(orchestratorUrl);
        const engine = new SessionEngine({
          sync: client,
          reporter: client,
          paths: crmPathsFromEnv(process.env),
        });
        void (async () => {
          let result: SessionResult;
          try {
            result = await engine.execute({
              sessionId,
              req: record.req,
              steps,
              handle: record.handle,
              display: record.display,
            });
          } catch (error) {
            result = {
              sessionId,
              runId: record.req.runId,
              roleId: record.req.roleId,
              status: "hong",
              steps: [],
              videoPath: null,
              screenshots: [],
              error: error instanceof Error ? error.message : "lỗi không rõ",
            };
          }
          record.result = result;
          record.state = result.status === "qua" ? "xong" : "loi";
          deps.gateway.unregister(sessionId);
          await client.sessionFinished(result).catch(() => undefined);
          log(
            `phien ${sessionId} (lan chay ${record.req.runId}, vai ${record.req.roleId}) ket thuc: ${result.status}`,
          );
        })();
        return;
      }

      const sessionMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (sessionMatch && (req.method === "GET" || req.method === "DELETE")) {
        const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
        const record = sessions.get(sessionId);
        if (!record) {
          sendJson(res, 404, { error: "session_not_found" });
          return;
        }
        if (req.method === "GET") {
          sendJson(res, 200, {
            sessionId,
            runId: record.req.runId,
            roleId: record.req.roleId,
            state: record.state,
            result: record.result,
          });
          return;
        }
        // DELETE: dong phien ngay (ke ca dang chay - dong browser se lam
        // buoc hien tai loi va engine tu ket thuc).
        sessions.delete(sessionId);
        deps.gateway.unregister(sessionId);
        record.state = "da-dong";
        await record.handle.close().catch(() => undefined);
        if (record.display) await record.display.stop().catch(() => undefined);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "not_found", path: url.pathname });
    } catch (error) {
      log(`loi xu ly ${req.method} ${url.pathname}: ${error instanceof Error ? error.name : "unknown"}`);
      sendJson(res, 500, { error: "internal_error" });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const netSocket = socket as unknown as import("node:net").Socket;
    const url = new URL(req.url ?? "/", "http://localhost");
    const streamMatch = /^\/stream\/([^/]+)$/.exec(url.pathname);
    if (!streamMatch) {
      netSocket.destroy();
      return;
    }
    const ws = acceptWebSocket(req, netSocket, head);
    if (!ws) {
      netSocket.destroy();
      return;
    }
    deps.gateway.handleConnection(decodeURIComponent(streamMatch[1] ?? ""), ws);
  });

  return server;
}
