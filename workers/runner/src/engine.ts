/**
 * Engine thuc thi phien cua mot vai (S3.1 + S3.3).
 * Dung chung cho ca hai che do Xem/Nhanh (AD-8): che do chi anh huong cau
 * hinh phien (factory) va nhip thao tac (paceMs), logic buoc khong doi.
 *
 * Dong bo theo su kien (AD-3): buoc co waitEvent thi cho qua SyncClient
 * (bo dieu phoi su kien cua orchestrator), het timeout la fail dung buoc do
 * voi ly do neu vai cho / su kien / nguon phat. Cam sleep co dinh thay cho
 * dong bo; paceMs chi la nhip xem, khong phai co che cho su kien.
 */
import { join } from "node:path";

import type { BrowserSessionHandle } from "./browser.js";
import { CRM_ACTIONS, DEFAULT_CRM_PATHS, type ActionContext, type CrmAction, type CrmPaths } from "./crm-actions.js";
import {
  DEFAULT_SYNC_TIMEOUT_MS,
  DEFAULT_VIEW_PACE_MS,
  StepError,
  type SessionRequest,
  type SessionResult,
  type StepOutcome,
  type StepPlan,
} from "./types.js";
import type { DisplayHandle } from "./xvnc.js";

export interface SyncEvent {
  name: string;
  payload: Record<string, string | number | boolean>;
  fromRole: string;
}

export interface SyncClient {
  /** Cho mot su kien trong lan chay; qua han thi nem loi co ngu canh. */
  waitForEvent: (input: {
    runId: string;
    roleId: string;
    name: string;
    timeoutMs: number;
    expectedFromRole?: string;
  }) => Promise<SyncEvent>;
  emitEvent: (input: {
    runId: string;
    roleId: string;
    name: string;
    payload: Record<string, string | number | boolean>;
  }) => Promise<void>;
}

export interface StepReporter {
  /** Bao trang thai phien cua vai (phuc vu o stream tren giao dien). */
  roleStatus?: (input: {
    runId: string;
    roleId: string;
    sessionId: string;
    state: "dang-chay" | "xong" | "loi";
    currentStepId?: string;
  }) => Promise<void>;
  stepFinished?: (input: {
    runId: string;
    roleId: string;
    outcome: StepOutcome;
  }) => Promise<void>;
  /** Bao thuc the vua tao tren CRM de orchestrator ghi so dang ky (S2.4). */
  entityCreated?: (input: {
    runId: string;
    roleId: string;
    type: string;
    entityId: string;
    stepId: string;
  }) => Promise<void>;
}

export interface EngineDeps {
  sync: SyncClient;
  reporter?: StepReporter;
  actions?: Record<string, CrmAction>;
  paths?: CrmPaths;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ExecuteInput {
  sessionId: string;
  req: SessionRequest;
  steps: StepPlan[];
  handle: BrowserSessionHandle;
  display: DisplayHandle | null;
}

export class SessionEngine {
  private readonly sync: SyncClient;
  private readonly reporter: StepReporter | undefined;
  private readonly actions: Record<string, CrmAction>;
  private readonly paths: CrmPaths;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: EngineDeps) {
    this.sync = deps.sync;
    this.reporter = deps.reporter;
    this.actions = deps.actions ?? CRM_ACTIONS;
    this.paths = deps.paths ?? DEFAULT_CRM_PATHS;
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  /** Bao cao phu: loi bao cao khong duoc lam hong lan chay. */
  private async safeReport(fn: () => Promise<void> | undefined): Promise<void> {
    try {
      await fn();
    } catch {
      // Co tinh nuot loi: kenh bao cao la phu (tinh than AD-7).
    }
  }

  private async reportRoleStatus(input: {
    runId: string;
    roleId: string;
    sessionId: string;
    state: "dang-chay" | "xong" | "loi";
    currentStepId?: string;
  }): Promise<void> {
    if (!this.reporter?.roleStatus) return;
    await this.safeReport(() => this.reporter!.roleStatus!(input));
  }

  private async reportStepFinished(input: {
    runId: string;
    roleId: string;
    outcome: StepOutcome;
  }): Promise<void> {
    if (!this.reporter?.stepFinished) return;
    await this.safeReport(() => this.reporter!.stepFinished!(input));
  }

  async execute(input: ExecuteInput): Promise<SessionResult> {
    const { sessionId, req, steps, handle, display } = input;
    const outcomes: StepOutcome[] = [];
    const screenshots: string[] = [];
    let failure: string | undefined;
    let videoPath: string | null = null;

    await this.reportRoleStatus({
      runId: req.runId,
      roleId: req.roleId,
      sessionId,
      state: "dang-chay",
    });

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i] as StepPlan;
        const startedAt = this.now();
        await this.reportRoleStatus({
          runId: req.runId,
          roleId: req.roleId,
          sessionId,
          state: "dang-chay",
          currentStepId: step.stepId,
        });
        try {
          // Diem dong bo (AD-3): cho su kien truoc khi thao tac.
          if (step.waitEvent) {
            await this.sync.waitForEvent({
              runId: req.runId,
              roleId: req.roleId,
              name: step.waitEvent,
              timeoutMs: step.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
              ...(step.waitFromRole ? { expectedFromRole: step.waitFromRole } : {}),
            });
          }
          // Nhip xem nhu nguoi that (S3.2 AC-4): chi o che do xem, giua cac buoc.
          if (req.mode === "xem" && i > 0) {
            const pace = req.paceMs ?? DEFAULT_VIEW_PACE_MS;
            if (pace > 0) await this.sleep(pace);
          }
          const action = this.actions[step.actionId];
          if (!action) {
            throw new StepError(
              step.stepId,
              `Hành động '${step.actionId}' chưa có bản cài đặt trong worker`,
            );
          }
          const ctx: ActionContext = {
            driver: handle.driver,
            baseUrl: req.targetBaseUrl,
            paths: this.paths,
            credentials: { username: req.username, password: req.password },
            data: step.data ?? {},
            registerEntity: async (type, entityId) => {
              if (!this.reporter?.entityCreated) return;
              await this.safeReport(() =>
                this.reporter!.entityCreated!({
                  runId: req.runId,
                  roleId: req.roleId,
                  type,
                  entityId,
                  stepId: step.stepId,
                }),
              );
            },
            step: {
              stepId: step.stepId,
              ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
            },
            artifactsDir: req.artifactsDir,
          };
          const { outputs } = await action(ctx);
          const outcome: StepOutcome = {
            stepId: step.stepId,
            actionId: step.actionId,
            status: "qua",
            durationMs: this.now() - startedAt,
            outputs,
          };
          outcomes.push(outcome);
          await this.reportStepFinished({ runId: req.runId, roleId: req.roleId, outcome });
          // Phat su kien sau buoc (AD-3): payload = du lieu buoc + outputs,
          // kem run_id de cac vai khac doi chieu. Khong chua thong tin dang nhap.
          if (step.emitEvent) {
            await this.sync.emitEvent({
              runId: req.runId,
              roleId: req.roleId,
              name: step.emitEvent,
              payload: { ...(step.data ?? {}), ...outputs, run_id: req.runId },
            });
          }
        } catch (error) {
          const message =
            error instanceof StepError
              ? error.message
              : `Bước '${step.stepId}': ${error instanceof Error ? error.message : "lỗi không rõ"}`;
          const outcome: StepOutcome = {
            stepId: step.stepId,
            actionId: step.actionId,
            status: "hong",
            durationMs: this.now() - startedAt,
            error: message,
            outputs: {},
          };
          outcomes.push(outcome);
          await this.reportStepFinished({ runId: req.runId, roleId: req.roleId, outcome });
          failure = message;
          break;
        }
      }
      // Anh cuoi phien (S3.1 AC-3): chup duoc thi tot, khong duoc thi bo qua.
      try {
        const shot = join(req.artifactsDir, `cuoi-phien-${req.roleId}.png`);
        await handle.driver.screenshot(shot);
        screenshots.push(shot);
      } catch {
        // Trang co the da dong - khong lam hong ket qua.
      }
    } finally {
      // Dong sach phien (S3.1 AC-4): context/browser truoc, display sau.
      try {
        const closed = await handle.close();
        videoPath = closed.videoPath;
      } catch {
        videoPath = null;
      }
      if (display) {
        await display.stop().catch(() => undefined);
      }
    }

    const status = failure ? "hong" : "qua";
    await this.reportRoleStatus({
      runId: req.runId,
      roleId: req.roleId,
      sessionId,
      state: failure ? "loi" : "xong",
    });

    return {
      sessionId,
      runId: req.runId,
      roleId: req.roleId,
      status,
      steps: outcomes,
      videoPath,
      screenshots,
      ...(failure ? { error: failure } : {}),
    };
  }
}
