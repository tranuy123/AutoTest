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
import { BannedDataError } from "./data-generator.js";
import { logEvent } from "./log.js";
import type { RunLogger } from "./run-logger.js";
import {
  RunNotFoundError,
  ScenarioMissingError,
  type DataService,
} from "./run-data-store.js";
import {
  RUN_MODE_LABELS,
  RUN_RESULT_LABELS,
  type RunRecord,
  type RunResult,
  type RunService,
  type RunStatus,
} from "./run-store.js";
import {
  ScenarioExistsError,
  toScenarioSummary,
  type ScenarioService,
} from "./scenario-store.js";
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
  /** Thu vien kich ban (S2.2). */
  scenarioService?: ScenarioService;
  /** Sinh du lieu theo run_id (S2.3). */
  dataService?: DataService;
}

const RUN_STATUSES: RunStatus[] = ["dang-cho", "dang-chay", "qua", "hong", "dung"];
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
        // S2.2: giao dien tao lan chay o trang thai cho (thuc thi thuoc Epic 3);
        // API truc tiep mac dinh giu trang thai dang-chay nhu S1.3.
        const run = await deps.runService.createRun({
          scenarioId,
          mode,
          targetUrl,
          ...(body.queue === true ? { status: "dang-cho" as const } : {}),
        });
        deps.runLogger?.log({ event: "run_created", runId: run.runId });
        // S2.3: tuy chon sinh du lieu ngay khi tao lan chay.
        if (body.generateData === true && deps.dataService) {
          try {
            const input = await deps.dataService.generateForRun(
              run.runId,
              typeof body.seed === "string" ? body.seed : undefined,
            );
            sendJson(res, 201, {
              ...toRunView(run),
              input: { seed: input.seed, thongKe: input.data.thongKe },
            });
          } catch (error) {
            sendJson(res, 201, {
              ...toRunView(run),
              dataError: error instanceof Error ? error.message : "khong sinh duoc du lieu",
            });
          }
          return;
        }
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

      /* ---------------- Thu vien kich ban (S2.2) ---------------- */

      if (req.method === "GET" && url.pathname === "/api/scenarios") {
        if (!deps.scenarioService) {
          sendJson(res, 501, { error: "scenario_store_not_configured" });
          return;
        }
        sendJson(res, 200, { scenarios: await deps.scenarioService.listSummaries() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/scenarios") {
        if (!deps.scenarioService) {
          sendJson(res, 501, { error: "scenario_store_not_configured" });
          return;
        }
        const body = await readJsonBody(req);
        const filename = typeof body.filename === "string" ? body.filename : "kich-ban";
        const format = body.format === "excel" ? "excel" : "yaml";
        try {
          const result = await deps.scenarioService.importScenario({
            filename,
            format,
            ...(typeof body.contentText === "string" ? { contentText: body.contentText } : {}),
            ...(typeof body.contentBase64 === "string"
              ? { contentBase64: body.contentBase64 }
              : {}),
          });
          if (!result.ok) {
            // Validate chan tu dau: khong nap do dang (S2.2 AC-2).
            sendJson(res, 422, { errors: result.errors });
            return;
          }
          sendJson(res, 201, {
            scenario: toScenarioSummary(result.record),
            message: `Đã nạp kịch bản '${result.record.name}' vào thư viện`,
          });
        } catch (error) {
          if (error instanceof ScenarioExistsError) {
            sendJson(res, 409, { error: "scenario_exists", message: error.message });
            return;
          }
          throw error;
        }
        return;
      }

      const scenarioDetailMatch = /^\/api\/scenarios\/([^/]+)$/.exec(url.pathname);
      if (scenarioDetailMatch && (req.method === "GET" || req.method === "DELETE")) {
        if (!deps.scenarioService) {
          sendJson(res, 501, { error: "scenario_store_not_configured" });
          return;
        }
        const id = decodeURIComponent(scenarioDetailMatch[1] ?? "");
        if (req.method === "GET") {
          const record = await deps.scenarioService.getScenario(id);
          if (!record) {
            sendJson(res, 404, { error: "scenario_not_found" });
            return;
          }
          sendJson(res, 200, {
            ...toScenarioSummary(record),
            yaml: record.yaml,
            scenario: record.scenario,
          });
          return;
        }
        const deleted = await deps.scenarioService.deleteScenario(id);
        if (!deleted) {
          sendJson(res, 404, { error: "scenario_not_found" });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      /* ---------------- Du lieu sinh theo run_id (S2.3) ---------------- */

      const generateMatch = /^\/api\/runs\/([^/]+)\/generate-data$/.exec(url.pathname);
      if (req.method === "POST" && generateMatch) {
        if (!deps.dataService) {
          sendJson(res, 501, { error: "data_service_not_configured" });
          return;
        }
        const runId = decodeURIComponent(generateMatch[1] ?? "");
        const body = await readJsonBody(req);
        try {
          const input = await deps.dataService.generateForRun(
            runId,
            typeof body.seed === "string" ? body.seed : undefined,
          );
          sendJson(res, 201, input);
        } catch (error) {
          if (error instanceof RunNotFoundError) {
            sendJson(res, 404, { error: "run_not_found", message: error.message });
            return;
          }
          if (error instanceof ScenarioMissingError) {
            sendJson(res, 409, { error: "scenario_missing", message: error.message });
            return;
          }
          if (error instanceof BannedDataError) {
            sendJson(res, 422, { error: "banned_data", message: error.message, violations: error.violations });
            return;
          }
          throw error;
        }
        return;
      }

      const inputExportMatch = /^\/api\/runs\/([^/]+)\/input\/export$/.exec(url.pathname);
      if (req.method === "GET" && inputExportMatch) {
        if (!deps.dataService) {
          sendJson(res, 501, { error: "data_service_not_configured" });
          return;
        }
        const runId = decodeURIComponent(inputExportMatch[1] ?? "");
        const input = await deps.dataService.getRunInput(runId);
        if (!input) {
          sendJson(res, 404, { error: "run_input_not_found" });
          return;
        }
        const payload = JSON.stringify(input.data, null, 2);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="input-${runId}.json"`,
          "content-length": Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }

      const inputMatch = /^\/api\/runs\/([^/]+)\/input$/.exec(url.pathname);
      if (req.method === "GET" && inputMatch) {
        if (!deps.dataService) {
          sendJson(res, 501, { error: "data_service_not_configured" });
          return;
        }
        const runId = decodeURIComponent(inputMatch[1] ?? "");
        const input = await deps.dataService.getRunInput(runId);
        if (!input) {
          sendJson(res, 404, { error: "run_input_not_found" });
          return;
        }
        sendJson(res, 200, input);
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
