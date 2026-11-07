/**
 * Bo thuc thi lan chay nhieu vai (S3.3 + S3.4).
 * Luong: nap kich ban + du lieu da sinh -> giai tham chieu du lieu ->
 * tao phien worker cho tung vai (moi vai 1 context rieng, tai khoan rieng)
 * -> cac vai chay song song, dong bo bang su kien qua RunEventBus (AD-3)
 * -> tong hop ket qua -> don du lieu theo run_id (S2.4) -> ket thuc lan chay.
 *
 * Gioi han phien dong thoi bang semaphore dung chung (NFR-3): vuot qua
 * thi xep hang o tang phien, khong sap. Che do xem/nhanh dung chung
 * executor nay - chi khac cau hinh phien gui cho worker (AD-8).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ScenarioStepDef } from "@autotest/scenario-schema";

import type { AppConfig } from "./config.js";
import type { CleanupService } from "./cleanup.js";
import type { GeneratedRunData } from "./data-generator.js";
import type { RunEventBus } from "./event-bus.js";
import { logEvent } from "./log.js";
import type { RoleStatusStore } from "./role-status.js";
import type { DataService } from "./run-data-store.js";
import type { RunService } from "./run-store.js";
import type { ScenarioService } from "./scenario-store.js";
import { evaluateTarget } from "./target-guard.js";
import type {
  WorkerClient,
  WorkerSessionResult,
  WorkerStepPlan,
} from "./worker-client.js";

/** Hang doi FIFO gioi han so phien trinh duyet chay dong thoi. */
export class FifoSemaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.available = Math.max(1, max);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }

  get waiting(): number {
    return this.queue.length;
  }
}

const REF_PATTERN = /^\$(benhNhan|dichVu|lichHen|phuTro)\[(\d+)\]$/;

/**
 * Giai tham chieu du lieu cua buoc ($benhNhan[0]...) thanh gia tri that
 * tu bo du lieu da sinh cua lan chay. Ban ghi duoc phang hoa thanh khoa
 * cham (vd "benhNhan.hoTen") de worker doc truc tiep.
 */
export function resolveStepData(
  step: ScenarioStepDef,
  data: GeneratedRunData,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(step.duLieu ?? {})) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const match = REF_PATTERN.exec(value);
    if (!match) {
      out[key] = value;
      continue;
    }
    const collection = match[1] as "benhNhan" | "dichVu" | "lichHen" | "phuTro";
    const index = Number(match[2]);
    const record = data[collection][index];
    if (!record) {
      throw new Error(
        `Bước '${step.id}': tham chiếu '${value}' không có trong dữ liệu đã sinh của lần chạy`,
      );
    }
    if (collection === "benhNhan") {
      const p = record as GeneratedRunData["benhNhan"][number];
      out[key] = p.hoTen;
      out[`${key}.id`] = p.id;
      out[`${key}.hoTen`] = p.hoTen;
      out[`${key}.soDienThoai`] = p.soDienThoai;
      out[`${key}.ngaySinh`] = p.ngaySinh;
      out[`${key}.gioiTinh`] = p.gioiTinh;
    } else if (collection === "dichVu") {
      const sv = record as GeneratedRunData["dichVu"][number];
      out[key] = sv.ma;
      out[`${key}.ma`] = sv.ma;
      out[`${key}.ten`] = sv.ten;
      out[`${key}.gia`] = sv.gia;
    } else if (collection === "lichHen") {
      const a = record as GeneratedRunData["lichHen"][number];
      out[key] = a.id;
      out[`${key}.id`] = a.id;
      out[`${key}.benhNhanId`] = a.benhNhanId;
      out[`${key}.dichVuMa`] = a.dichVuMa;
      out[`${key}.ngayGio`] = a.ngayGio;
      out[`${key}.gia`] = a.gia;
    } else {
      const e = record as GeneratedRunData["phuTro"][number];
      out[key] = e.id;
      out[`${key}.id`] = e.id;
      out[`${key}.loai`] = e.loai;
      for (const [k, v] of Object.entries(e.truong)) out[`${key}.${k}`] = v;
    }
  }
  return out;
}

export interface RunExecutorDeps {
  config: AppConfig;
  runService: RunService;
  scenarioService: ScenarioService;
  dataService: DataService;
  worker: WorkerClient;
  bus: RunEventBus;
  roleStatus: RoleStatusStore;
  cleanupService: CleanupService;
  /** Thu muc goc luu artifact cua cac lan chay (video, anh, ket-qua.json). */
  artifactsRoot: string;
  /** URL de worker goi nguoc ve orchestrator (su kien, tien do, ket qua). */
  callbackBaseUrl: string;
  maxConcurrentSessions?: number;
  viewPaceMs?: number;
  /** S3.4 AC-3: true = luu video ca lan chay qua; mac dinh false. */
  keepVideoOnPass?: boolean;
  sessionTimeoutMs?: number;
}

export class RunAlreadyActiveError extends Error {
  constructor(runId: string) {
    super(`Lần chạy ${runId} đang được thực thi`);
    this.name = "RunAlreadyActiveError";
  }
}

export class RunExecutor {
  private readonly deps: RunExecutorDeps;
  private readonly semaphore: FifoSemaphore;
  private readonly activeRuns = new Set<string>();
  private readonly pendingSessions = new Map<
    string,
    { resolve: (result: WorkerSessionResult) => void }
  >();
  private readonly orphanResults = new Map<string, WorkerSessionResult>();

  constructor(deps: RunExecutorDeps) {
    this.deps = deps;
    this.semaphore = new FifoSemaphore(deps.maxConcurrentSessions ?? 5);
  }

  /** Worker bao ket qua phien ve (POST /api/internal/sessions/:id/finished). */
  handleSessionFinished(result: WorkerSessionResult): void {
    const pending = this.pendingSessions.get(result.sessionId);
    if (pending) {
      this.pendingSessions.delete(result.sessionId);
      pending.resolve(result);
    } else {
      this.orphanResults.set(result.sessionId, result);
    }
  }

  isActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  /**
   * Bat dau thuc thi mot lan chay. Tra ve promise hoan tat toan bo lan
   * chay (gom ca buoc don); API goi khong cho, test thi cho de xac minh.
   */
  async startRun(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) throw new RunAlreadyActiveError(runId);
    this.activeRuns.add(runId);
    try {
      await this.execute(runId);
    } catch (error) {
      logEvent("run_execute_error", {
        runId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      await this.deps.runService
        .finishRun(runId, "hong")
        .catch(() => undefined);
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private async execute(runId: string): Promise<void> {
    const { config, runService, scenarioService, dataService } = this.deps;
    const run = await runService.getRunWithSteps(runId).then((d) => d?.run ?? null);
    if (!run) throw new Error(`Không tìm thấy lần chạy ${runId}`);

    const scenarioRecord = await scenarioService.getScenario(run.scenarioId);
    if (!scenarioRecord) {
      await runService.finishRun(runId, "hong");
      logEvent("run_scenario_missing", { runId, scenarioId: run.scenarioId });
      return;
    }
    const scenario = scenarioRecord.scenario;

    // Cong chan AD-6 kiem tra lai ngay truoc khi cap phien.
    const evaluation = evaluateTarget(run.targetUrl, config.allowlist);
    if (!evaluation.allowed) {
      await runService.finishRun(runId, "hong");
      logEvent("target_blocked", { runId, origin: evaluation.origin, reason: evaluation.reason });
      return;
    }

    let input = await dataService.getRunInput(runId);
    if (!input) {
      input = await dataService.generateForRun(runId);
    }
    const generated = input.data;

    await runService.markRunning(runId);

    // Gom buoc theo vai, giu nguyen thu tu trong kich ban.
    const stepsByRole = new Map<string, ScenarioStepDef[]>();
    for (const roleId of scenario.cacVai) stepsByRole.set(roleId, []);
    for (const step of scenario.cacBuoc) {
      stepsByRole.get(step.vai)?.push(step);
    }
    for (const roleId of scenario.cacVai) {
      this.deps.roleStatus.set({ runId, roleId, state: "cho" });
    }

    const mode = run.mode === "chay-nhanh" ? "nhanh" : "xem";
    const results = await Promise.all(
      scenario.cacVai.map((roleId) =>
        this.runRole({
          runId,
          roleId,
          mode,
          targetUrl: run.targetUrl,
          steps: stepsByRole.get(roleId) ?? [],
          allSteps: scenario.cacBuoc,
          generated,
        }),
      ),
    );

    const overall = results.some((r) => r.status === "hong") ? "hong" : "qua";

    // Chinh sach video (S3.4 AC-3): lan hong luon giu video; lan qua chi
    // giu khi cau hinh yeu cau, con lai xoa file de tiet kiem dia.
    const videoPaths = results
      .map((r) => r.videoPath)
      .filter((p): p is string => Boolean(p));
    let runVideoPath: string | null = null;
    if (overall === "hong" || this.deps.keepVideoOnPass) {
      runVideoPath = videoPaths[0] ?? null;
    } else {
      for (const path of videoPaths) {
        await rm(path, { force: true }).catch(() => undefined);
      }
    }

    // Buoc don du lieu la mot phan cua lan chay (AD-5): chay ke ca khi
    // lan chay hong, va bao cao don duoc ghi kem ket qua.
    const cleanupReport = await this.deps.cleanupService
      .cleanupRun(runId)
      .catch(() => null);

    // Ban tong hop cua lan chay (nguon cho trang ket qua S5.1).
    let reportPath: string | null = null;
    try {
      const dir = join(this.deps.artifactsRoot, runId);
      await mkdir(dir, { recursive: true });
      reportPath = join(dir, "ket-qua.json");
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            runId,
            scenarioId: run.scenarioId,
            mode: run.mode,
            result: overall,
            roles: results,
            events: this.deps.bus.history(runId),
            cleanup: cleanupReport,
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      // Khong ghi duoc artifact (moi truong han che) - lan chay van co
      // ket qua trong kho lan chay; khong de viec ghi file lam hong ket qua.
      reportPath = null;
    }

    await runService.finishRun(runId, overall, {
      ...(runVideoPath ? { videoPath: runVideoPath } : {}),
      ...(reportPath ? { reportPath } : {}),
    });
    this.deps.bus.clearRun(runId);
    logEvent("run_finished", { runId, result: overall });
  }

  private async runRole(input: {
    runId: string;
    roleId: string;
    mode: "xem" | "nhanh";
    targetUrl: string;
    steps: ScenarioStepDef[];
    allSteps: ScenarioStepDef[];
    generated: GeneratedRunData;
  }): Promise<WorkerSessionResult> {
    const { runId, roleId } = input;
    const fail = async (message: string, stepId?: string): Promise<WorkerSessionResult> => {
      this.deps.roleStatus.set({ runId, roleId, state: "loi" });
      await this.deps.runService
        .recordStep({
          runId,
          stepId: stepId ?? `phien-${roleId}`,
          name: stepId ? "chuan-bi-buoc" : "khoi-tao-phien",
          status: "hong",
          durationMs: null,
          errorCode: message,
        })
        .catch(() => undefined);
      return {
        sessionId: "",
        runId,
        roleId,
        status: "hong",
        steps: [],
        videoPath: null,
        screenshots: [],
        error: message,
      };
    };

    // Giai tham chieu du lieu tung buoc truoc khi gui worker.
    let plans: WorkerStepPlan[];
    try {
      plans = input.steps.map((step) => {
        const emitter = step.choSuKien
          ? input.allSteps.find((b) => b.phatSuKien === step.choSuKien)?.vai
          : undefined;
        return {
          stepId: step.id,
          actionId: step.hanhDong,
          data: resolveStepData(step, input.generated),
          ...(step.choSuKien ? { waitEvent: step.choSuKien } : {}),
          ...(emitter ? { waitFromRole: emitter } : {}),
          ...(step.phatSuKien ? { emitEvent: step.phatSuKien } : {}),
          ...(step.thoiGianChoGiay
            ? { syncTimeoutMs: step.thoiGianChoGiay * 1000 }
            : {}),
        };
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "lỗi giải dữ liệu bước");
    }

    const account = this.deps.config.roles.find((r) => r.id === roleId);
    if (!account?.configured || !account.username || !account.password) {
      return fail(`Chưa cấu hình tài khoản UAT cho vai '${roleId}'`);
    }

    await this.semaphore.acquire();
    let sessionId: string | null = null;
    try {
      const session = await this.deps.worker.createSession({
        runId,
        roleId,
        mode: input.mode,
        targetBaseUrl: input.targetUrl,
        username: account.username,
        password: account.password,
        stream: input.mode === "xem",
        ...(input.mode === "xem" ? { paceMs: this.deps.viewPaceMs ?? 400 } : {}),
        artifactsDir: join(this.deps.artifactsRoot, runId),
      });
      sessionId = session.sessionId;
      this.deps.roleStatus.set({ runId, roleId, sessionId, state: "dang-chay" });
      await this.deps.worker.executeSession(
        sessionId,
        plans,
        this.deps.callbackBaseUrl,
      );
      const result = await this.waitSessionResult(sessionId);
      this.deps.roleStatus.set({
        runId,
        roleId,
        sessionId,
        state: result.status === "qua" ? "xong" : "loi",
      });
      return result;
    } catch (error) {
      if (sessionId) {
        await this.deps.worker.closeSession(sessionId).catch(() => undefined);
      }
      return fail(error instanceof Error ? error.message : "lỗi không rõ khi chạy phiên");
    } finally {
      this.semaphore.release();
    }
  }

  private waitSessionResult(sessionId: string): Promise<WorkerSessionResult> {
    const orphan = this.orphanResults.get(sessionId);
    if (orphan) {
      this.orphanResults.delete(sessionId);
      return Promise.resolve(orphan);
    }
    const timeoutMs = this.deps.sessionTimeoutMs ?? 15 * 60_000;
    return new Promise<WorkerSessionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSessions.delete(sessionId);
        reject(new Error(`Worker không báo kết quả phiên ${sessionId} trong ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingSessions.set(sessionId, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
    });
  }
}
