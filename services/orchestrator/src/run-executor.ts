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
import type { EffectiveConfigResolver } from "./effective-config.js";
import type { RunEventBus } from "./event-bus.js";
import type { KiemDemService } from "./kiem-dem.js";
import { logEvent } from "./log.js";
import type { BangDoiChieu } from "./reconciler.js";
import type { RoleStatusStore } from "./role-status.js";
import type { DataService } from "./run-data-store.js";
import type {
  RunResult,
  RunResultDetailData,
  RunService,
} from "./run-store.js";
import type { SandboxCheckRecord, SandboxGate } from "./sandbox-gate.js";
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

/**
 * Hang doi lan chay (S5.2 AC-1/AC-3): gioi han so lan chay thuc thi
 * dong thoi (cau hinh duoc); lan chay vuot gioi han xep hang FIFO, xem
 * duoc vi tri hang doi qua queuePosition()/snapshot(). Khi mot lan chay
 * ket thuc, lan cho dau hang tu duoc nhan vao (AC-3). Lan chay bi dung
 * khi dang xep hang duoc huy khoi hang bang cancel() - acquire() tra
 * false thay vi nem loi de nhanh startRun chot trang thai "dung".
 */
export class RunQueue {
  private activeCount = 0;
  private readonly waiters: Array<{
    runId: string;
    resolve: (admitted: boolean) => void;
  }> = [];

  constructor(private readonly maxConcurrent: number) {}

  get limit(): number {
    return this.maxConcurrent;
  }

  acquire(runId: string): Promise<boolean> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this.waiters.push({ runId, resolve });
    });
  }

  /** Huy mot lan chay dang xep hang (phuc vu Dung an toan). */
  cancel(runId: string): boolean {
    const index = this.waiters.findIndex((w) => w.runId === runId);
    if (index < 0) return false;
    const [waiter] = this.waiters.splice(index, 1);
    waiter?.resolve(false);
    return true;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Giu nguyen so slot dang dung: lan cho dau hang vao thay cho.
      next.resolve(true);
    } else {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  /** Vi tri 1-based trong hang doi; null neu khong xep hang. */
  position(runId: string): number | null {
    const index = this.waiters.findIndex((w) => w.runId === runId);
    return index < 0 ? null : index + 1;
  }

  snapshot(): {
    activeCount: number;
    maxConcurrent: number;
    queued: Array<{ runId: string; position: number }>;
  } {
    return {
      activeCount: this.activeCount,
      maxConcurrent: this.maxConcurrent,
      queued: this.waiters.map((w, i) => ({ runId: w.runId, position: i + 1 })),
    };
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
  /**
   * S5.2 AC-1: so lan chay thuc thi dong thoi toi da (hang doi lan
   * chay). Mac dinh 2 - vuot qua thi xep hang "Dang cho phien trong".
   */
  maxConcurrentRuns?: number;
  /**
   * S5.2 Dev Notes: thoi gian an han khi dung - phien dang chay duoc
   * cho bao ket qua tu nhien toi da bay lau; qua han moi dong phien
   * (duong DELETE cua worker) va ghi ro vao bao cao. Mac dinh 30s.
   */
  stopGraceMs?: number;
  viewPaceMs?: number;
  /** S3.4 AC-3: true = luu video ca lan chay qua; mac dinh false. */
  keepVideoOnPass?: boolean;
  sessionTimeoutMs?: number;
  /**
   * S4.2: dich vu kiem dem doi chieu 3 chieu. Co kich ban khai bao
   * kiemDem ma khoi nay hong/khong kiem chung duoc thi lan chay hong
   * du cac buoc thao tac deu qua (AC-2/AC-4 cua S4.2).
   */
  kiemDemService?: KiemDemService;
  /**
   * S5.3: cong kiem tra sandbox kenh ngoai. Kich ban khai bao kenhNgoai
   * ma khong xac nhan duoc sandbox thi lan chay bi chan truoc khi sinh
   * du lieu/cap phien (fail-closed, NFR-4).
   */
  sandboxGate?: SandboxGate;
  /**
   * S5.5: bo giai cau hinh hieu luc (settings khai bao qua giao dien ghi
   * de env). Co thi cong chan AD-6 va tai khoan theo vai deu doc qua bo
   * giai nay - doc truc tiep moi lan dung nen ap dung ngay sau khi luu.
   * Vang mat thi giu hanh vi cu: doc thang tu config (.env).
   */
  effectiveConfig?: EffectiveConfigResolver;
}

export class RunAlreadyActiveError extends Error {
  constructor(runId: string) {
    super(`Lần chạy ${runId} đang được thực thi`);
    this.name = "RunAlreadyActiveError";
  }
}

interface StopRequest {
  requestedAt: number;
  /** sessionId cac phien bi dong sau khi qua thoi gian an han. */
  forcedSessions: string[];
}

export class RunExecutor {
  private readonly deps: RunExecutorDeps;
  private readonly semaphore: FifoSemaphore;
  private readonly runQueue: RunQueue;
  private readonly activeRuns = new Set<string>();
  private readonly pendingSessions = new Map<
    string,
    { resolve: (result: WorkerSessionResult) => void }
  >();
  private readonly orphanResults = new Map<string, WorkerSessionResult>();
  /** S5.2: yeu cau dung dang hieu luc theo run_id. */
  private readonly stopRequests = new Map<string, StopRequest>();
  /** S5.2: cac vai dang cho ket qua phien, can bao khi co yeu cau dung. */
  private readonly stopWaiters = new Map<
    string,
    Array<(entry: StopRequest) => void>
  >();

  constructor(deps: RunExecutorDeps) {
    this.deps = deps;
    this.semaphore = new FifoSemaphore(deps.maxConcurrentSessions ?? 5);
    this.runQueue = new RunQueue(deps.maxConcurrentRuns ?? 2);
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

  /** S5.2 AC-1: vi tri hang doi cua lan chay (null = khong xep hang). */
  queuePosition(runId: string): number | null {
    return this.runQueue.position(runId);
  }

  /** S5.2: anh chup hang doi lan chay cho API/giao dien. */
  queueSnapshot(): ReturnType<RunQueue["snapshot"]> {
    return this.runQueue.snapshot();
  }

  /**
   * S5.2 AC-2: yeu cau dung an toan mot lan chay.
   * - Dang xep hang: huy khoi hang doi, nhanh startRun se chot "dung"
   *   kem buoc don du lieu (khong mo phien nao).
   * - Dang thuc thi: ghi yeu cau dung; cac vai chua mo phien se khong
   *   mo nua, phien dang chay duoc cho het thoi gian an han roi moi
   *   dong (xem waitSessionResultWithStop). Buoc don van chay va ket
   *   qua chot la "dung" o nhanh execute().
   * Tra false neu lan chay khong con hoat dong (da ket thuc/khong co).
   */
  requestStop(runId: string): { accepted: boolean; state: "dang-cho" | "dang-chay" } {
    if (this.runQueue.cancel(runId)) {
      return { accepted: true, state: "dang-cho" };
    }
    if (this.activeRuns.has(runId)) {
      if (!this.stopRequests.has(runId)) {
        const entry: StopRequest = { requestedAt: Date.now(), forcedSessions: [] };
        this.stopRequests.set(runId, entry);
        const waiters = this.stopWaiters.get(runId) ?? [];
        this.stopWaiters.delete(runId);
        for (const resolve of waiters) resolve(entry);
        logEvent("run_stop_requested", { runId });
      }
      return { accepted: true, state: "dang-chay" };
    }
    return { accepted: false, state: "dang-chay" };
  }

  /** Cho den khi lan chay co yeu cau dung (tra ngay neu da co). */
  private whenStopRequested(runId: string): Promise<StopRequest> {
    const existing = this.stopRequests.get(runId);
    if (existing) return Promise.resolve(existing);
    return new Promise<StopRequest>((resolve) => {
      const list = this.stopWaiters.get(runId) ?? [];
      list.push(resolve);
      this.stopWaiters.set(runId, list);
    });
  }

  /**
   * Bat dau thuc thi mot lan chay. Tra ve promise hoan tat toan bo lan
   * chay (gom ca buoc don); API goi khong cho, test thi cho de xac minh.
   * Vuot gioi han lan chay dong thoi thi xep hang o RunQueue (S5.2).
   */
  async startRun(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) throw new RunAlreadyActiveError(runId);
    this.activeRuns.add(runId);
    let admitted = false;
    try {
      admitted = await this.runQueue.acquire(runId);
      if (!admitted) {
        // Bi dung khi dang xep hang: khong mo phien nao, van don du
        // lieu va chot "Da dung theo yeu cau" (S5.2 AC-2/AC-3).
        await this.finalizeStoppedWhileQueued(runId);
        return;
      }
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
      if (admitted) this.runQueue.release();
      this.activeRuns.delete(runId);
      this.stopRequests.delete(runId);
      this.stopWaiters.delete(runId);
    }
  }

  /** Chot lan chay bi dung ngay khi con dang xep hang phien trong. */
  private async finalizeStoppedWhileQueued(runId: string): Promise<void> {
    const { runService } = this.deps;
    const note = "Đã dừng theo yêu cầu khi đang chờ phiên trống — chưa mở phiên nào";
    await runService
      .recordStep({
        runId,
        stepId: "dung-lan-chay",
        name: "dung-lan-chay-theo-yeu-cau",
        status: "bo-qua",
        durationMs: 0,
        errorCode: note,
      })
      .catch(() => undefined);
    const cleanupReport = await this.deps.cleanupService
      .cleanupRun(runId)
      .catch(() => null);
    await runService
      .saveResultDetail(runId, {
        kiemDem: null,
        roles: [],
        sandboxCheck: null,
        stop: { requestedAt: new Date().toISOString(), forcedSessions: 0, note },
      })
      .catch(() => undefined);
    const runDetail = await runService.getRunWithSteps(runId).catch(() => null);
    const reportPath = await this.writeReportFile({
      runId,
      scenarioId: runDetail?.run.scenarioId ?? "",
      mode: runDetail?.run.mode ?? "",
      result: "dung",
      roles: [],
      kiemDem: null,
      cleanup: cleanupReport,
      sandboxCheck: null,
    });
    await runService.finishRun(runId, "dung", {
      ...(reportPath ? { reportPath } : {}),
    });
    logEvent("run_stopped_while_queued", { runId });
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

    // Cong chan AD-6 kiem tra lai ngay truoc khi cap phien (allowlist
    // hieu luc neu co bo giai S5.5, doc truc tiep tai thoi diem chay).
    const allowlist = this.deps.effectiveConfig
      ? (await this.deps.effectiveConfig.getTarget()).allowlist
      : config.allowlist;
    const evaluation = evaluateTarget(run.targetUrl, allowlist);
    if (!evaluation.allowed) {
      await runService.finishRun(runId, "hong");
      logEvent("target_blocked", { runId, origin: evaluation.origin, reason: evaluation.reason });
      return;
    }

    // Cong sandbox kenh ngoai (S5.3): kich ban khai bao kenhNgoai thi
    // bat buoc xac nhan dich dang o sandbox truoc khi sinh du lieu/cap
    // phien. Khong xac nhan duoc = chan (fail-closed); ket qua kiem tra
    // ghi vao ho so lan chay lam buoc "kiem-tra-sandbox" + ban ghi cua
    // cong (AC-3). Kich ban khong khai bao kenh ngoai -> gate tra null,
    // khong bi kiem tra nay chan (AC-2).
    let sandboxRecord: SandboxCheckRecord | null = null;
    if (this.deps.sandboxGate) {
      const batDauKiemTra = Date.now();
      sandboxRecord = await this.deps.sandboxGate.checkForRun({
        runId,
        scenario,
        targetBaseUrl: run.targetUrl,
      });
      if (sandboxRecord) {
        await runService
          .recordStep({
            runId,
            stepId: "kiem-tra-sandbox",
            name: "kiem-tra-sandbox-kenh-ngoai",
            status: sandboxRecord.allowed ? "qua" : "hong",
            durationMs: Date.now() - batDauKiemTra,
            errorCode: sandboxRecord.allowed ? null : sandboxRecord.reason,
          })
          .catch(() => undefined);
        if (!sandboxRecord.allowed) {
          logEvent("sandbox_blocked", { runId, reason: sandboxRecord.reason });
          await runService
            .saveResultDetail(runId, {
              kiemDem: null,
              roles: [],
              sandboxCheck: sandboxRecord,
            })
            .catch(() => undefined);
          const reportPath = await this.writeReportFile({
            runId,
            scenarioId: run.scenarioId,
            mode: run.mode,
            result: "hong",
            roles: [],
            kiemDem: null,
            cleanup: null,
            sandboxCheck: sandboxRecord,
          });
          await runService.finishRun(runId, "hong", {
            ...(reportPath ? { reportPath } : {}),
          });
          return;
        }
      }
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

    // Dung theo yeu cau (S5.2 AC-2): ket luan la "dung" du co vai chua
    // chay xong; bo qua khoi kiem dem vi so lieu cua lan chay do dang
    // khong con y nghia doi chieu. Buoc don du lieu van chay o duoi.
    const stopEntry = this.stopRequests.get(runId);
    let overall: RunResult = stopEntry
      ? "dung"
      : results.some((r) => r.status === "hong")
        ? "hong"
        : "qua";

    // Khoi kiem dem (S4.2): doi chieu UI/API/DB voi ky vong Oracle ngay
    // sau khi cac vai chay xong, truoc moi ket luan khac. Chi tieu lech
    // hoac khong kiem chung duoc -> lan chay hong o khoi kiem dem du
    // moi buoc thao tac deu qua.
    let bangKiemDem: BangDoiChieu | null = null;
    if (!stopEntry && (scenario.kiemDem?.length ?? 0) > 0 && this.deps.kiemDemService) {
      const batDauKiemDem = Date.now();
      try {
        bangKiemDem = await this.deps.kiemDemService.kiemDem({
          run,
          scenario,
          generated,
          sessionResults: results,
        });
      } catch (error) {
        logEvent("run_reconcile_error", {
          runId,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
      if (!bangKiemDem || bangKiemDem.ketQua === "hong") {
        overall = "hong";
      }
      await runService
        .recordStep({
          runId,
          stepId: "kiem-dem",
          name: "kiem-dem-doi-chieu",
          status: bangKiemDem?.ketQua === "qua" ? "qua" : "hong",
          durationMs: Date.now() - batDauKiemDem,
          errorCode: bangKiemDem
            ? bangKiemDem.ketQua === "qua"
              ? null
              : `Kiểm đếm: ${bangKiemDem.soLech} chỉ tiêu lệch, ${bangKiemDem.soKhongKiemChung} không kiểm chứng được`
            : "Khối kiểm đếm gặp lỗi khi đối chiếu",
        })
        .catch(() => undefined);
    }

    // Chinh sach video (S3.4 AC-3): lan hong/dung luon giu video de xem
    // lai phan da chay; lan qua chi giu khi cau hinh yeu cau, con lai
    // xoa file de tiet kiem dia.
    const videoPaths = results
      .map((r) => r.videoPath)
      .filter((p): p is string => Boolean(p));
    let runVideoPath: string | null = null;
    if (overall === "hong" || overall === "dung" || this.deps.keepVideoOnPass) {
      runVideoPath = videoPaths[0] ?? null;
    } else {
      for (const path of videoPaths) {
        await rm(path, { force: true }).catch(() => undefined);
      }
    }

    // Buoc don du lieu la mot phan cua lan chay (AD-5): chay ke ca khi
    // lan chay hong/bi dung, va bao cao don duoc ghi kem ket qua.
    const cleanupReport = await this.deps.cleanupService
      .cleanupRun(runId)
      .catch(() => null);

    // Ghi nhan viec dung vao ho so lan chay (S5.2 AC-2 + Dev Notes):
    // so phien bi dong sau an han phai lo ro trong bao cao, khong am tham.
    let stopDetail: RunResultDetailData["stop"] = null;
    if (stopEntry) {
      const graceMs = this.deps.stopGraceMs ?? 30_000;
      const forced = stopEntry.forcedSessions.length;
      const note =
        forced > 0
          ? `Đã dừng theo yêu cầu; ${forced} phiên quá thời gian ân hạn ${graceMs}ms nên đã bị đóng để dừng hẳn`
          : "Đã dừng theo yêu cầu; các phiên đang chạy đóng an toàn, vai chưa mở phiên không mở nữa";
      await runService
        .recordStep({
          runId,
          stepId: "dung-lan-chay",
          name: "dung-lan-chay-theo-yeu-cau",
          status: "bo-qua",
          durationMs: Date.now() - stopEntry.requestedAt,
          errorCode: note,
        })
        .catch(() => undefined);
      stopDetail = {
        requestedAt: new Date(stopEntry.requestedAt).toISOString(),
        forcedSessions: forced,
        note,
      };
      logEvent("run_stopped", { runId, forcedSessions: forced });
    }

    // Chi tiet ket qua luu vao kho lan chay (S5.1): trang ket qua doc
    // tu day, khong phu thuoc file artifact ghi tot nhat ben duoi.
    await runService
      .saveResultDetail(runId, {
        kiemDem: bangKiemDem,
        roles: results,
        sandboxCheck: sandboxRecord,
        stop: stopDetail,
      })
      .catch(() => undefined);

    // Ban tong hop cua lan chay (nguon cho trang ket qua S5.1).
    const reportPath = await this.writeReportFile({
      runId,
      scenarioId: run.scenarioId,
      mode: run.mode,
      result: overall,
      roles: results,
      kiemDem: bangKiemDem,
      cleanup: cleanupReport,
      sandboxCheck: sandboxRecord,
      stop: stopDetail,
    });

    await runService.finishRun(runId, overall, {
      ...(runVideoPath ? { videoPath: runVideoPath } : {}),
      ...(reportPath ? { reportPath } : {}),
    });
    this.deps.bus.clearRun(runId);
    logEvent("run_finished", { runId, result: overall });
  }

  /**
   * Ghi ban tong hop ket-qua.json vao thu muc artifact cua lan chay.
   * Ghi khong duoc (moi truong han che) thi tra null - ket qua lan chay
   * van nam trong kho lan chay, khong de viec ghi file lam hong ket qua.
   */
  private async writeReportFile(input: {
    runId: string;
    scenarioId: string;
    mode: string;
    result: RunResult;
    roles: WorkerSessionResult[];
    kiemDem: BangDoiChieu | null;
    cleanup: unknown;
    sandboxCheck: SandboxCheckRecord | null;
    stop?: RunResultDetailData["stop"];
  }): Promise<string | null> {
    try {
      const dir = join(this.deps.artifactsRoot, input.runId);
      await mkdir(dir, { recursive: true });
      const reportPath = join(dir, "ket-qua.json");
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            runId: input.runId,
            scenarioId: input.scenarioId,
            mode: input.mode,
            result: input.result,
            roles: input.roles,
            events: this.deps.bus.history(input.runId),
            kiemDem: input.kiemDem,
            cleanup: input.cleanup,
            sandboxCheck: input.sandboxCheck,
            stop: input.stop ?? null,
          },
          null,
          2,
        ),
        "utf8",
      );
      return reportPath;
    } catch {
      return null;
    }
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

    // Tai khoan theo vai: uu tien cau hinh khai bao qua giao dien (S5.5,
    // doc truc tiep tu kho settings) - fallback ve .env khi chua khai bao.
    const account = this.deps.effectiveConfig
      ? await this.deps.effectiveConfig.getRoleAccount(roleId)
      : this.deps.config.roles.find((r) => r.id === roleId);
    if (!account?.configured || !account.username || !account.password) {
      return fail(`Chưa cấu hình tài khoản UAT cho vai '${roleId}'`);
    }

    await this.semaphore.acquire();
    // Dung theo yeu cau (S5.2 AC-2): vai chua mo phien thi khong mo
    // nua - tra ket qua "dung" tong hop, khong ghi buoc hong gia.
    if (this.stopRequests.has(runId)) {
      this.semaphore.release();
      return {
        sessionId: "",
        runId,
        roleId,
        status: "hong",
        steps: [],
        videoPath: null,
        screenshots: [],
        error: "Đã dừng theo yêu cầu — vai này chưa mở phiên",
      };
    }
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
      const outcome = await this.waitSessionResultWithStop(runId, sessionId);
      if (!outcome.result) {
        // Phien bi dong sau khi qua thoi gian an han cua lenh dung:
        // viec nay da duoc ghi vao bao cao o nhanh execute() (Dev Notes).
        this.deps.roleStatus.set({ runId, roleId, sessionId, state: "loi" });
        return {
          sessionId,
          runId,
          roleId,
          status: "hong",
          steps: [],
          videoPath: null,
          screenshots: [],
          error: `Phiên bị đóng sau thời gian ân hạn ${this.deps.stopGraceMs ?? 30_000}ms khi dừng lần chạy`,
        };
      }
      const result = outcome.result;
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

  /**
   * Cho ket qua phien co y thuc dung (S5.2 AC-2): binh thuong cho den
   * khi phien bao ket qua; neu co yeu cau dung thi chuyen sang che do
   * an han - phien duoc cho bao ket qua tu nhien them stopGraceMs,
   * qua han moi dong bang duong DELETE cua worker (dong phien la muc
   * cuoi, khong phai kill tien trinh) va tra result = null de nhanh
   * tren ghi nhan phien bi dong ep.
   */
  private async waitSessionResultWithStop(
    runId: string,
    sessionId: string,
  ): Promise<{ result: WorkerSessionResult | null }> {
    const base = this.waitSessionResult(sessionId);
    const winner = await Promise.race([
      base.then((result) => ({ kind: "ket-qua" as const, result })),
      this.whenStopRequested(runId).then((entry) => ({
        kind: "dung" as const,
        entry,
      })),
    ]);
    if (winner.kind === "ket-qua") return { result: winner.result };

    const graceMs = this.deps.stopGraceMs ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hetAnHan = new Promise<"het">((resolve) => {
      timer = setTimeout(() => resolve("het"), graceMs);
    });
    const raced = await Promise.race([
      base.then((result) => ({ kind: "ket-qua" as const, result })),
      hetAnHan.then(() => ({ kind: "het" as const })),
    ]);
    if (timer) clearTimeout(timer);
    if (raced.kind === "ket-qua") return { result: raced.result };

    await this.deps.worker.closeSession(sessionId).catch(() => undefined);
    winner.entry.forcedSessions.push(sessionId);
    logEvent("run_stop_forced_close", { runId, sessionId, graceMs });
    return { result: null };
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
