/**
 * Orchestrator - may chu HTTP.
 * Route:
 * - GET  /health           (S1.1) kiem tra suc khoe
 * - GET  /api/environment  (S1.2) trang thai moi truong, khong chua mat khau
 * - GET/PUT /api/settings  (S5.5) cau hinh khai bao qua giao dien (dich UAT,
 *                          allowlist, tenant, tai khoan theo vai) - PUT
 *                          validate bang cong chan AD-6 truoc khi luu,
 *                          phan hoi khong bao gio chua mat khau
 * - POST /api/runs         cong vao cua moi lan chay: buoc 1 la cong chan
 *                          allowlist (S1.2, AD-6); viec tao lan chay that
 *                          duoc noi o S1.3.
 * Theo AD-1, orchestrator khong thao tac trinh duyet truc tiep.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { STEP_ACTIONS } from "@autotest/scenario-schema";

import type { BatchService } from "./batch.js";
import type { CleanupService } from "./cleanup.js";
import { ROLE_DEFINITIONS, type AppConfig } from "./config.js";
import { BannedDataError } from "./data-generator.js";
import { EffectiveConfigResolver } from "./effective-config.js";
import { SyncTimeoutError, type RunEventBus } from "./event-bus.js";
import type { EntityRegistry } from "./entity-registry.js";
import { logEvent } from "./log.js";
import type { RoleStatusStore } from "./role-status.js";
import type { RunExecutor } from "./run-executor.js";
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
  assembleRunResultDetail,
  buildMarkdownReport,
  buildRoleVideos,
  docBaoCaoLanChay,
  timFileVideo,
  type RunResultDeps,
} from "./run-report.js";
import type { SandboxGate } from "./sandbox-gate.js";
import {
  ScenarioExistsError,
  toScenarioSummary,
  type ScenarioService,
} from "./scenario-store.js";
import type { SettingsService } from "./settings-store.js";
import { evaluateTarget } from "./target-guard.js";
import type { WorkerClient, WorkerSessionResult } from "./worker-client.js";

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
  /** Bo thuc thi nhieu vai (S3.3) + cac thanh phan phu tro cua Epic 3. */
  executor?: RunExecutor;
  bus?: RunEventBus;
  roleStatus?: RoleStatusStore;
  /** So dang ky thuc the + bo don du lieu (S2.4). */
  registry?: EntityRegistry;
  cleanupService?: CleanupService;
  /** Dot chay nhanh (S3.4). */
  batchService?: BatchService;
  /** Client worker - dung de gop trang thai stream cho luoi xem (S3.2). */
  worker?: WorkerClient;
  /** Base URL WebSocket cua Stream Gateway (vd ws://localhost:3102). */
  streamGatewayWsUrl?: string;
  /** Cong sandbox kenh ngoai (S5.3) - chi tiet lan chay tra kem ban ghi kiem tra. */
  sandboxGate?: SandboxGate;
  /** Cau hinh khai bao qua giao dien (S5.5) - doc/ghi o /api/settings. */
  settingsService?: SettingsService;
  /** Thu muc artifact lan chay (S5.1: doc ket-qua.json + phuc vu video theo vai). */
  artifactsRoot?: string;
  /** Chinh sach video (S3.4) - dung de giai thich ly do khong co video o trang ket qua. */
  keepVideoOnPass?: boolean;
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
  // S5.5: moi diem doc cau hinh dich/allowlist di qua bo giai cau hinh
  // hieu luc (settings ghi de env, doc truc tiep moi lan - ap dung ngay).
  const effective = new EffectiveConfigResolver(config, deps.settingsService ?? null);

  // Bo phu tro lap rap chi tiet ket qua lan chay (S5.1) - dung chung cho
  // trang ket qua, file bao cao .md va phuc vu video theo vai.
  const resultDeps: RunResultDeps = {
    getRunWithSteps: async (runId) =>
      deps.runService ? deps.runService.getRunWithSteps(runId) : null,
    getScenario: async (scenarioId) =>
      deps.scenarioService ? deps.scenarioService.getScenario(scenarioId) : null,
    getRunInput: async (runId) =>
      deps.dataService ? deps.dataService.getRunInput(runId) : null,
    getCleanupReport: (runId) => deps.cleanupService?.getReport(runId) ?? null,
    getSandboxRecord: (runId) => deps.sandboxGate?.getRecord(runId) ?? null,
    artifactsRoot: deps.artifactsRoot ?? "runs-data",
  };
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, healthResponse());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/environment") {
        const effTarget = await effective.getTarget();
        const targetEvaluation = evaluateTarget(effTarget.baseUrl, effTarget.allowlist);
        sendJson(res, 200, {
          ...(await effective.getEnvironmentStatus()),
          targetEvaluation,
        });
        return;
      }

      /* ---------------- Cau hinh khai bao qua giao dien (S5.5) ---------------- */

      if (req.method === "GET" && url.pathname === "/api/settings") {
        if (!deps.settingsService) {
          sendJson(res, 501, { error: "settings_not_configured" });
          return;
        }
        // View da che: chi co hasPassword, tuyet doi khong co gia tri mat khau.
        sendJson(res, 200, await deps.settingsService.getView());
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/settings") {
        if (!deps.settingsService) {
          sendJson(res, 501, { error: "settings_not_configured" });
          return;
        }
        const body = await readJsonBody(req);
        const result = await deps.settingsService.update(body);
        if (!result.ok) {
          sendJson(res, 400, { error: "invalid_settings", message: result.message });
          return;
        }
        // Chi ghi su kien, khong ghi gia tri (dac biet la mat khau).
        logEvent("settings_updated", {});
        sendJson(res, 200, result.view);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runs") {
        const body = await readJsonBody(req);
        const effTarget = await effective.getTarget();
        const targetUrl =
          typeof body.targetUrl === "string" && body.targetUrl.length > 0
            ? body.targetUrl
            : effTarget.baseUrl;

        // Cong chan AD-6: chay truoc moi thao tac tao lan chay.
        const evaluation = evaluateTarget(targetUrl, effTarget.allowlist);
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
        const resultDetail = await assembleRunResultDetail(
          resultDeps,
          detail.run.runId,
        ).catch(() => null);
        sendJson(res, 200, {
          ...toRunView(detail.run),
          steps: detail.steps,
          // S3.3/S2.4: trang thai phien theo vai va bao cao don (neu da co).
          roles: deps.roleStatus?.listByRun(detail.run.runId) ?? [],
          cleanup: deps.cleanupService?.getReport(detail.run.runId) ?? null,
          // S5.3 AC-3: ban ghi kiem tra sandbox kenh ngoai cua lan chay.
          sandboxCheck: deps.sandboxGate?.getRecord(detail.run.runId) ?? null,
          // S5.1: ket luan lon, bang doi chieu, video theo vai, du lieu
          // dau vao da che - nguon cho trang ket qua tren Control App.
          ketLuan: resultDetail?.ketLuan ?? null,
          scenarioName: resultDetail?.scenarioName ?? null,
          kiemDem: resultDetail?.kiemDem ?? null,
          videos: resultDetail?.videos ?? [],
          input: resultDetail?.input ?? null,
          // S5.2: vi tri hang doi (AC-1) va thong tin dung (AC-2).
          queuePosition: deps.executor?.queuePosition(detail.run.runId) ?? null,
          stop: resultDetail?.stop ?? null,
          reportDownloadUrl: `/api/runs/${encodeURIComponent(detail.run.runId)}/report.md`,
        });
        return;
      }

      /* ---------------- Trang ket qua + bao cao + video (S5.1) ---------------- */

      const reportMatch = /^\/api\/runs\/([^/]+)\/report\.md$/.exec(url.pathname);
      if (req.method === "GET" && reportMatch) {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const runId = decodeURIComponent(reportMatch[1] ?? "");
        const resultDetail = await assembleRunResultDetail(resultDeps, runId).catch(
          () => null,
        );
        if (!resultDetail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        const markdown = buildMarkdownReport(resultDetail);
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="bao-cao-${runId}.md"`,
          "content-length": Buffer.byteLength(markdown),
        });
        res.end(markdown);
        return;
      }

      const videoMatch = /^\/api\/runs\/([^/]+)\/videos\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && videoMatch) {
        if (!deps.runService) {
          sendJson(res, 501, { error: "run_store_not_configured" });
          return;
        }
        const runId = decodeURIComponent(videoMatch[1] ?? "");
        const roleId = decodeURIComponent(videoMatch[2] ?? "");
        const detail = await deps.runService.getRunWithSteps(runId);
        if (!detail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        const reportFile = await docBaoCaoLanChay(detail.run);
        const videoPath = timFileVideo({
          run: detail.run,
          roleId,
          reportRoles: reportFile?.roles ?? [],
          artifactsRoot: resultDeps.artifactsRoot,
        });
        if (!videoPath) {
          const scenario = deps.scenarioService
            ? await deps.scenarioService.getScenario(detail.run.scenarioId)
            : null;
          const videos = buildRoleVideos({
            run: detail.run,
            roleIds: scenario?.scenario.cacVai ?? [roleId],
            reportRoles: reportFile?.roles ?? [],
            artifactsRoot: resultDeps.artifactsRoot,
          });
          const info = videos.find((v) => v.roleId === roleId);
          sendJson(res, 404, {
            error: "video_not_found",
            reason: info?.reason ?? "Không có video của vai này",
          });
          return;
        }
        const fileStat = await stat(videoPath).catch(() => null);
        if (!fileStat) {
          sendJson(res, 404, { error: "video_not_found", reason: "File video đã bị xoá" });
          return;
        }
        res.writeHead(200, {
          "content-type": videoPath.endsWith(".mp4") ? "video/mp4" : "video/webm",
          "content-length": fileStat.size,
        });
        createReadStream(videoPath).pipe(res);
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

      /* ---------------- Thuc thi nhieu vai (Epic 3) ---------------- */

      const startMatch = /^\/api\/runs\/([^/]+)\/start$/.exec(url.pathname);
      if (req.method === "POST" && startMatch) {
        if (!deps.executor || !deps.runService) {
          sendJson(res, 501, { error: "executor_not_configured" });
          return;
        }
        const runId = decodeURIComponent(startMatch[1] ?? "");
        const detail = await deps.runService.getRunWithSteps(runId);
        if (!detail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        if (deps.executor.isActive(runId)) {
          sendJson(res, 409, { error: "run_already_active" });
          return;
        }
        // Cong chan AD-6 ap dung ca khi bat dau thuc thi (allowlist hieu luc S5.5).
        const effTarget = await effective.getTarget();
        const evaluation = evaluateTarget(detail.run.targetUrl, effTarget.allowlist);
        if (!evaluation.allowed) {
          sendJson(res, 403, {
            blocked: true,
            allowed: false,
            reason: evaluation.reason,
            message: "Không phải UAT — đã chặn",
          });
          return;
        }
        void deps.executor.startRun(runId).catch(() => undefined);
        sendJson(res, 202, { accepted: true, runId });
        return;
      }

      /* ---------------- Dung an toan + hang doi (S5.2) ---------------- */

      const stopMatch = /^\/api\/runs\/([^/]+)\/stop$/.exec(url.pathname);
      if (req.method === "POST" && stopMatch) {
        if (!deps.executor || !deps.runService) {
          sendJson(res, 501, { error: "executor_not_configured" });
          return;
        }
        const runId = decodeURIComponent(stopMatch[1] ?? "");
        const detail = await deps.runService.getRunWithSteps(runId);
        if (!detail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        const outcome = deps.executor.requestStop(runId);
        if (!outcome.accepted) {
          sendJson(res, 409, {
            error: "run_not_active",
            message: "Lần chạy không còn đang chạy hoặc đang chờ — không dừng được",
          });
          return;
        }
        sendJson(res, 202, {
          accepted: true,
          runId,
          state: outcome.state,
          message:
            outcome.state === "dang-cho"
              ? "Đã huỷ lần chạy khỏi hàng đợi — sẽ chốt là Đã dừng theo yêu cầu"
              : "Đã ghi yêu cầu dừng — hệ thống dừng sau bước hiện tại và vẫn dọn dữ liệu",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/queue") {
        sendJson(res, 200, {
          queue: deps.executor?.queueSnapshot() ?? null,
        });
        return;
      }

      const eventsMatch = /^\/api\/internal\/runs\/([^/]+)\/events$/.exec(url.pathname);
      if (req.method === "POST" && eventsMatch) {
        if (!deps.bus) {
          sendJson(res, 501, { error: "event_bus_not_configured" });
          return;
        }
        const runId = decodeURIComponent(eventsMatch[1] ?? "");
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name : "";
        const fromRole = typeof body.fromRole === "string" ? body.fromRole : "";
        if (!name || !fromRole) {
          sendJson(res, 400, { error: "missing_event_fields" });
          return;
        }
        const payload: Record<string, string | number | boolean> = {};
        if (typeof body.payload === "object" && body.payload !== null) {
          for (const [key, value] of Object.entries(
            body.payload as Record<string, unknown>,
          )) {
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            ) {
              payload[key] = value;
            }
          }
        }
        const event = deps.bus.emit({ runId, name, payload, fromRole });
        sendJson(res, 201, { ok: true, emittedAt: event.emittedAt });
        return;
      }

      const waitMatch = /^\/api\/internal\/runs\/([^/]+)\/events\/wait$/.exec(url.pathname);
      if (req.method === "GET" && waitMatch) {
        if (!deps.bus) {
          sendJson(res, 501, { error: "event_bus_not_configured" });
          return;
        }
        const runId = decodeURIComponent(waitMatch[1] ?? "");
        const name = url.searchParams.get("name") ?? "";
        const role = url.searchParams.get("role") ?? "";
        const timeoutRaw = Number(url.searchParams.get("timeoutMs") ?? 120_000);
        const timeoutMs = Math.min(300_000, Math.max(1_000, Number.isFinite(timeoutRaw) ? timeoutRaw : 120_000));
        const expectedFromRole = url.searchParams.get("expectedFromRole");
        if (!name || !role) {
          sendJson(res, 400, { error: "missing_wait_fields" });
          return;
        }
        try {
          const event = await deps.bus.waitFor({
            runId,
            name,
            waitingRole: role,
            timeoutMs,
            ...(expectedFromRole ? { expectedFromRole } : {}),
          });
          sendJson(res, 200, {
            name: event.name,
            payload: event.payload,
            fromRole: event.fromRole,
            emittedAt: event.emittedAt,
          });
        } catch (error) {
          if (error instanceof SyncTimeoutError) {
            sendJson(res, 408, { error: "sync_timeout", message: error.message });
            return;
          }
          throw error;
        }
        return;
      }

      const roleStatusMatch = /^\/api\/internal\/runs\/([^/]+)\/roles\/([^/]+)\/status$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && roleStatusMatch) {
        if (!deps.roleStatus) {
          sendJson(res, 501, { error: "role_status_not_configured" });
          return;
        }
        const runId = decodeURIComponent(roleStatusMatch[1] ?? "");
        const roleId = decodeURIComponent(roleStatusMatch[2] ?? "");
        const body = await readJsonBody(req);
        const state = body.state;
        if (state !== "dang-chay" && state !== "xong" && state !== "loi") {
          sendJson(res, 400, { error: "invalid_role_state" });
          return;
        }
        deps.roleStatus.set({
          runId,
          roleId,
          state,
          ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}),
          ...(typeof body.currentStepId === "string"
            ? { currentStepId: body.currentStepId }
            : {}),
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      const entitiesMatch = /^\/api\/internal\/runs\/([^/]+)\/entities$/.exec(url.pathname);
      if (req.method === "POST" && entitiesMatch) {
        if (!deps.registry) {
          sendJson(res, 501, { error: "registry_not_configured" });
          return;
        }
        const runId = decodeURIComponent(entitiesMatch[1] ?? "");
        const body = await readJsonBody(req);
        const type = typeof body.type === "string" ? body.type : "";
        const entityId = typeof body.entityId === "string" ? body.entityId : "";
        if (!type || !entityId) {
          sendJson(res, 400, { error: "missing_entity_fields" });
          return;
        }
        await deps.registry.register({
          runId,
          type,
          entityId,
          ...(typeof body.createdByStepId === "string"
            ? { createdByStepId: body.createdByStepId }
            : {}),
        });
        sendJson(res, 201, { ok: true });
        return;
      }

      const finishedMatch = /^\/api\/internal\/sessions\/([^/]+)\/finished$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && finishedMatch) {
        if (!deps.executor) {
          sendJson(res, 501, { error: "executor_not_configured" });
          return;
        }
        const body = (await readJsonBody(req)) as unknown as WorkerSessionResult;
        deps.executor.handleSessionFinished(body);
        sendJson(res, 200, { ok: true });
        return;
      }

      const streamsMatch = /^\/api\/runs\/([^/]+)\/streams$/.exec(url.pathname);
      if (req.method === "GET" && streamsMatch) {
        if (!deps.runService || !deps.roleStatus) {
          sendJson(res, 501, { error: "streams_not_configured" });
          return;
        }
        const runId = decodeURIComponent(streamsMatch[1] ?? "");
        const detail = await deps.runService.getRunWithSteps(runId);
        if (!detail) {
          sendJson(res, 404, { error: "run_not_found" });
          return;
        }
        const scenarioRecord = deps.scenarioService
          ? await deps.scenarioService.getScenario(detail.run.scenarioId)
          : null;
        const roleIds = scenarioRecord?.scenario.cacVai ?? [];
        const fastMode = detail.run.mode === "chay-nhanh";
        let gatewayStreams: Awaited<ReturnType<WorkerClient["listStreams"]>> = [];
        if (!fastMode && deps.worker) {
          gatewayStreams = await deps.worker.listStreams().catch(() => []);
        }
        const gatewayBySession = new Map(gatewayStreams.map((s) => [s.sessionId, s]));
        const actionLabels = new Map(STEP_ACTIONS.map((a) => [a.id, a.ten]));
        const roles = roleIds.map((roleId) => {
          const status = deps.roleStatus?.get(runId, roleId);
          const label =
            ROLE_DEFINITIONS.find((r) => r.id === roleId)?.label ?? roleId;
          const state = status?.state ?? "cho";
          const currentStep = status?.currentStepId
            ? (scenarioRecord?.scenario.cacBuoc.find((b) => b.id === status.currentStepId) ??
              null)
            : null;
          let stream: { state: string; wsUrl: string | null } | null = null;
          if (!fastMode) {
            const sessionId = status?.sessionId ?? null;
            const gatewayInfo = sessionId ? gatewayBySession.get(sessionId) : undefined;
            stream = {
              state:
                state === "dang-chay"
                  ? (gatewayInfo?.state ?? "mat-tin-hieu")
                  : state === "cho"
                    ? "cho"
                    : "da-dong",
              wsUrl:
                sessionId && deps.streamGatewayWsUrl
                  ? `${deps.streamGatewayWsUrl.replace(/\/$/, "")}/stream/${sessionId}`
                  : null,
            };
          }
          return {
            roleId,
            label,
            state,
            stateLabel:
              state === "cho"
                ? "Đang chờ"
                : state === "dang-chay"
                  ? "Đang chạy"
                  : state === "xong"
                    ? "Đã xong"
                    : "Lỗi",
            currentStepId: status?.currentStepId ?? null,
            currentStepLabel: currentStep
              ? (actionLabels.get(currentStep.hanhDong) ?? currentStep.hanhDong)
              : null,
            sessionId: status?.sessionId ?? null,
            stream,
          };
        });
        sendJson(res, 200, {
          runId,
          mode: detail.run.mode,
          fastMode,
          roles,
          // S5.2 AC-1: vi tri hang doi lan chay (null = khong xep hang)
          // de giao dien hien "Dang cho phien trong - vi tri N".
          queuePosition: deps.executor?.queuePosition(runId) ?? null,
          runStatus: detail.run.status,
        });
        return;
      }

      const cleanupMatch = /^\/api\/runs\/([^/]+)\/cleanup$/.exec(url.pathname);
      if (req.method === "POST" && cleanupMatch) {
        if (!deps.cleanupService) {
          sendJson(res, 501, { error: "cleanup_not_configured" });
          return;
        }
        const runId = decodeURIComponent(cleanupMatch[1] ?? "");
        const report = await deps.cleanupService.cleanupRun(runId);
        sendJson(res, 200, report);
        return;
      }

      /* ---------------- Dot chay nhanh (S3.4) ---------------- */

      if (req.method === "POST" && url.pathname === "/api/batches") {
        if (!deps.batchService) {
          sendJson(res, 501, { error: "batch_not_configured" });
          return;
        }
        const body = await readJsonBody(req);
        const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
        if (!scenarioId) {
          sendJson(res, 400, { error: "missing_scenario_id" });
          return;
        }
        const effTarget = await effective.getTarget();
        const targetUrl =
          typeof body.targetUrl === "string" && body.targetUrl.length > 0
            ? body.targetUrl
            : effTarget.baseUrl;
        const evaluation = evaluateTarget(targetUrl, effTarget.allowlist);
        if (!evaluation.allowed) {
          sendJson(res, 403, {
            blocked: true,
            allowed: false,
            reason: evaluation.reason,
            message: "Không phải UAT — đã chặn",
          });
          return;
        }
        const batch = await deps.batchService.startBatch({
          scenarioId,
          targetUrl,
          count: typeof body.count === "number" ? body.count : 4,
        });
        sendJson(res, 201, batch);
        return;
      }

      const batchMatch = /^\/api\/batches\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && batchMatch) {
        if (!deps.batchService) {
          sendJson(res, 501, { error: "batch_not_configured" });
          return;
        }
        const summary = await deps.batchService.summary(
          decodeURIComponent(batchMatch[1] ?? ""),
        );
        if (!summary) {
          sendJson(res, 404, { error: "batch_not_found" });
          return;
        }
        sendJson(res, 200, summary);
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
