/**
 * Orchestrator - may chu HTTP.
 * Route:
 * - GET  /health           (S1.1) kiem tra suc khoe
 * - GET  /api/environment  (S1.2) trang thai moi truong, khong chua mat khau
 * - POST /api/runs         cong vao cua moi lan chay: buoc 1 la cong chan
 *                          allowlist (S1.2, AD-6); viec tao lan chay that
 *                          duoc noi o S1.3.
 * Theo AD-1, orchestrator khong thao tac trinh duyet truc tiep.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { toEnvironmentStatus, type AppConfig } from "./config.js";
import { logEvent } from "./log.js";
import type { RunLogger } from "./run-logger.js";
import {
  RUN_MODE_LABELS,
  RUN_RESULT_LABELS,
  type RunRecord,
  type RunResult,
  type RunService,
  type RunStatus,
} from "./run-store.js";
import { evaluateTarget } from "./target-guard.js";

export interface HealthResponse {
  status: "ok";
  service: "@autotest/orchestrator";
}

export function healthResponse(): HealthResponse {
  return { status: "ok", service: "@autotest/orchestrator" };
}

export function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

export interface OrchestratorDeps {
  config: AppConfig;
  /** Kho lan chay (S1.3). Vang mat thi POST /api/runs tra 501 sau khi qua cong chan. */
  runService?: RunService;
  runLogger?: RunLogger;
}

const RUN_STATUSES: RunStatus[] = ["dang-chay", "qua", "hong", "dung"];
const RUN_RESULTS: RunResult[] = ["qua", "hong", "dung"];

function toRunView(run: RunRecord) {
  return {
    ...run,
    result: run.status,
    resultLabel: RUN_RESULT_LABELS[run.status],
    modeLabel: RUN_MODE_LABELS[run.mode] ?? run.mode,
  };
}

export function createOrchestratorServer(deps: OrchestratorDeps): Server {
  const { config } = deps;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, healthResponse());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/environment") {
        const targetEvaluation = evaluateTarget(config.targetBaseUrl, config.allowlist);
        sendJson(res, 200, { ...toEnvironmentStatus(config), targetEvaluation });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runs") {
        const body = await readJsonBody(req);
        const targetUrl =
          typeof body.targetUrl === "string" && body.targetUrl.length > 0
            ? body.targetUrl
            : config.targetBaseUrl;

        // Cong chan AD-6: chay truoc moi thao tac tao lan chay.
        const evaluation = evaluateTarget(targetUrl, config.allowlist);
        if (!evaluation.allowed) {
          logEvent("target_blocked", {
            origin: evaluation.origin,
            reason: evaluation.reason,
          });
          sendJson(res, 403, {
            blocked: true,
            allowed: false,
            reason: evaluation.reason,
            message: "Không phải UAT — đã chặn",
          });
          return;
        }

        if (!deps.runService) {
          sendJson(res, 501, {
            error: "run_store_not_configured",
            message: "Orchestrator chưa được nối kho lần chạy",
          });
          return;
        }

        const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
        if (!scenarioId) {
          sendJson(res, 400, { error: "missing_scenario_id" });
          return;
        }
        const mode = typeof body.mode === "string" ? body.mode : "xem-truc-tiep";
        const run = await deps.runService.createRun({ scenarioId, mode, targetUrl });
        deps.runLogger?.log({ event: "run_created", runId: run.runId });
        sendJson(res, 201, toRunView(run));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/runs") {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
        const resultParam = url.searchParams.get("result") ?? undefined;
        const status =
          resultParam && (RUN_STATUSES as string[]).includes(resultParam)
            ? (resultParam as RunStatus)
            : undefined;
        const runs = await deps.runService.listRuns({
          ...(scenarioId ? { scenarioId } : {}),
          ...(status ? { status } : {}),
        });
        sendJson(res, 200, { runs: runs.map(toRunView) });
        return;
      }

      const runDetailMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && runDetailMatch) {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const detail = await deps.runService.getRunWithSteps(
          decodeURIComponent(runDetailMatch[1] ?? ""),
        );
        if (!detail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        sendJson(res, 200, { ...toRunView(detail.run), steps: detail.steps });
        return;
      }

      const stepMatch = /^\/api\/runs\/([^/]+)\/steps$/.exec(url.pathname);
      if (req.method === "POST" && stepMatch) {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const runId = decodeURIComponent(stepMatch[1] ?? "");
        const body = await readJsonBody(req);
        const stepId = typeof body.stepId === "string" ? body.stepId : "";
        const name = typeof body.name === "string" ? body.name : "";
        const status = typeof body.status === "string" ? body.status : "";
        if (!stepId || !name || !status) {
          sendJson(res, 400, { error: "missing_step_fields" });
          return;
        }
        await deps.runService.recordStep({
          runId,
          stepId,
          name,
          status,
          durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
          errorCode: typeof body.errorCode === "string" ? body.errorCode : null,
        });
        deps.runLogger?.log({
          event: "run_step",
          runId,
          stepId,
          ...(typeof body.durationMs === "number" ? { durationMs: body.durationMs } : {}),
          ...(typeof body.errorCode === "string" ? { errorCode: body.errorCode } : {}),
        });
        sendJson(res, 201, { ok: true });
        return;
      }

      const finishMatch = /^\/api\/runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (req.method === "POST" && finishMatch) {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const runId = decodeURIComponent(finishMatch[1] ?? "");
        const body = await readJsonBody(req);
        const result = body.result;
        if (typeof result !== "string" || !(RUN_RESULTS as string[]).includes(result)) {
          sendJson(res, 400, { error: "invalid_result", allowed: RUN_RESULTS });
          return;
        }
        await deps.runService.finishRun(runId, result as RunResult, {
          ...(typeof body.videoPath === "string" ? { videoPath: body.videoPath } : {}),
          ...(typeof body.reportPath === "string" ? { reportPath: body.reportPath } : {}),
        });
        deps.runLogger?.log({ event: "run_finished", runId, result });
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "not_found", path: url.pathname });
    } catch (error) {
      logEvent("request_error", {
        path: url.pathname,
        reason: error instanceof Error ? error.name : "unknown",
      });
      sendJson(res, 500, { error: "internal_error" });
    }
  });
}
