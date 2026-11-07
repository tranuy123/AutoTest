/** Ho tro test: cau hinh mau hop le dung cho cac test cua orchestrator. */
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BatchService } from "./batch.js";
import {
  CleanupService,
  type CrmCleanupClient,
  type CleanupDeleteInput,
  type CleanupDeleteResult,
} from "./cleanup.js";
import { loadConfig, type AppConfig } from "./config.js";
import { EMPTY_BANNED_LIST } from "./data-generator.js";
import { EntityRegistry, InMemoryEntityRepository } from "./entity-registry.js";
import { RunEventBus } from "./event-bus.js";
import type { KiemDemService } from "./kiem-dem.js";
import { RoleStatusStore } from "./role-status.js";
import { RunExecutor } from "./run-executor.js";
import { DataService, InMemoryRunDataRepository } from "./run-data-store.js";
import { InMemoryRunRepository, RunService } from "./run-store.js";
import { InMemoryScenarioRepository, ScenarioService } from "./scenario-store.js";
import type {
  WorkerClient,
  WorkerSessionRequest,
  WorkerSessionResult,
  WorkerStepPlan,
  WorkerStreamInfo,
} from "./worker-client.js";

export function makeTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    TARGET_BASE_URL: "https://uat.example.invalid",
    TARGET_ALLOWLIST: "https://uat.example.invalid",
    TEST_TENANT: "autotest-tenant-mau",
    CHANNELS_SANDBOX: "true",
    ROLE_LE_TAN_USERNAME: "le-tan-mau@example.invalid",
    ROLE_LE_TAN_PASSWORD: "mat-khau-gia-test",
    ...overrides,
  });
}

export function makeFullRoleConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return makeTestConfig({
    ROLE_BENH_NHAN_USERNAME: "benh-nhan-mau@example.invalid",
    ROLE_BENH_NHAN_PASSWORD: "mat-khau-gia-test",
    ROLE_LE_TAN_USERNAME: "le-tan-mau@example.invalid",
    ROLE_LE_TAN_PASSWORD: "mat-khau-gia-test",
    ROLE_BAC_SI_USERNAME: "bac-si-mau@example.invalid",
    ROLE_BAC_SI_PASSWORD: "mat-khau-gia-test",
    ROLE_THU_NGAN_USERNAME: "thu-ngan-mau@example.invalid",
    ROLE_THU_NGAN_PASSWORD: "mat-khau-gia-test",
    ROLE_QUAN_LY_USERNAME: "quan-ly-mau@example.invalid",
    ROLE_QUAN_LY_PASSWORD: "mat-khau-gia-test",
    ...overrides,
  });
}

/**
 * Worker gia lap cho test cua orchestrator: mo phong dung nghia cua
 * worker that (cho/phat su kien qua bus, ghi buoc vao kho lan chay, dang
 * ky thuc the, bao ket qua phien) nhung khong co trinh duyet.
 */
export class FakeWorkerClient implements WorkerClient {
  readonly sessions = new Map<
    string,
    { req: WorkerSessionRequest; steps: WorkerStepPlan[] }
  >();
  /** stepId -> buoc do se hong. */
  readonly failStepIds = new Set<string>();
  /** Vai khong tao duoc phien. */
  failCreateForRole: string | null = null;
  /** Co ghi file video gia vao artifactsDir khong (de test chinh sach video). */
  writeVideoFiles = false;
  /**
   * Outputs tra ve cho buoc xem-bao-cao-doanh-thu (S4.2/S4.3): test dat
   * san so lieu "CRM gia lap" dang van ban tho de khoi kiem dem phan
   * tich bang bo phan tich dung chung.
   */
  reportOutputs: Record<string, string | number> = {};
  onSessionFinished: ((result: WorkerSessionResult) => void) | null = null;
  activeSessions = 0;
  maxActiveSessions = 0;
  private sequence = 0;

  constructor(
    private readonly deps: {
      bus: RunEventBus;
      runService: RunService;
      registry: EntityRegistry;
    },
  ) {}

  async createSession(req: WorkerSessionRequest) {
    if (this.failCreateForRole === req.roleId) {
      throw new Error(`Không mở được Chromium cho vai ${req.roleId} (giả lập)`);
    }
    const sessionId = `fake-ses-${++this.sequence}`;
    this.sessions.set(sessionId, { req, steps: [] });
    return {
      sessionId,
      stream: req.stream ? { vncPort: 5901, wsPath: `/stream/${sessionId}` } : null,
    };
  }

  async executeSession(
    sessionId: string,
    steps: WorkerStepPlan[],
    _orchestratorUrl: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Không thấy phiên ${sessionId}`);
    session.steps = steps;
    this.activeSessions++;
    this.maxActiveSessions = Math.max(this.maxActiveSessions, this.activeSessions);
    void (async () => {
      const { req } = session;
      const outcomes: WorkerSessionResult["steps"] = [];
      let failed = false;
      for (const step of steps) {
        if (step.waitEvent) {
          try {
            await this.deps.bus.waitFor({
              runId: req.runId,
              name: step.waitEvent,
              waitingRole: req.roleId,
              timeoutMs: step.syncTimeoutMs ?? 1_500,
              ...(step.waitFromRole ? { expectedFromRole: step.waitFromRole } : {}),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "quá hạn chờ sự kiện";
            outcomes.push({
              stepId: step.stepId,
              actionId: step.actionId,
              status: "hong",
              durationMs: 1,
              error: `Bước '${step.stepId}': ${message}`,
              outputs: {},
            });
            await this.deps.runService.recordStep({
              runId: req.runId,
              stepId: step.stepId,
              name: step.actionId,
              status: "hong",
              durationMs: 1,
              errorCode: message,
            });
            failed = true;
            break;
          }
        }
        if (this.failStepIds.has(step.stepId)) {
          const message = `Bước '${step.stepId}': lỗi giả lập tại bước`;
          outcomes.push({
            stepId: step.stepId,
            actionId: step.actionId,
            status: "hong",
            durationMs: 1,
            error: message,
            outputs: {},
          });
          await this.deps.runService.recordStep({
            runId: req.runId,
            stepId: step.stepId,
            name: step.actionId,
            status: "hong",
            durationMs: 1,
            errorCode: message,
          });
          failed = true;
          break;
        }
        const outputs: Record<string, string | number> =
          step.actionId === "dat-lich-hen"
            ? { appointment_id: `LH-${sessionId}` }
            : step.actionId === "thanh-toan"
              ? { invoice_id: `HD-${sessionId}` }
              : step.actionId === "check-in"
                ? { check_in: 1 }
                : step.actionId === "xem-bao-cao-doanh-thu"
                  ? { ...this.reportOutputs }
                  : {};
        if (step.actionId === "dat-lich-hen") {
          await this.deps.registry.register({
            runId: req.runId,
            type: "lich-hen",
            entityId: String(outputs.appointment_id),
            createdByStepId: step.stepId,
          });
        }
        if (step.actionId === "thanh-toan") {
          await this.deps.registry.register({
            runId: req.runId,
            type: "hoa-don",
            entityId: String(outputs.invoice_id),
            createdByStepId: step.stepId,
          });
        }
        outcomes.push({
          stepId: step.stepId,
          actionId: step.actionId,
          status: "qua",
          durationMs: 1,
          outputs,
        });
        await this.deps.runService.recordStep({
          runId: req.runId,
          stepId: step.stepId,
          name: step.actionId,
          status: "qua",
          durationMs: 1,
          errorCode: null,
        });
        if (step.emitEvent) {
          this.deps.bus.emit({
            runId: req.runId,
            name: step.emitEvent,
            payload: { ...(step.data ?? {}), ...outputs, run_id: req.runId },
            fromRole: req.roleId,
          });
        }
      }
      let videoPath: string | null = null;
      if (this.writeVideoFiles) {
        const dir = join(req.artifactsDir, "video", req.roleId);
        videoPath = join(dir, "video.webm");
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(videoPath, "video-gia-lap", "utf8");
        } catch {
          // Moi truong han che ghi file (sandbox VM): phien van phai bao
          // ket qua - duong dan video la thu executor dung de quyet dinh
          // chinh sach giu/xoa.
        }
      } else {
        videoPath = join(req.artifactsDir, "video", req.roleId, "video.webm");
      }
      this.activeSessions--;
      this.onSessionFinished?.({
        sessionId,
        runId: req.runId,
        roleId: req.roleId,
        status: failed ? "hong" : "qua",
        steps: outcomes,
        videoPath,
        screenshots: [],
      });
    })();
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listStreams(): Promise<WorkerStreamInfo[]> {
    return [...this.sessions.keys()].map((sessionId) => ({
      sessionId,
      state: "dang-phat" as const,
      viewers: 1,
      bytesFromVnc: 100,
      bytesToVnc: 10,
      lastError: null,
    }));
  }
}

/** Client don CRM gia lap: ghi lai cac lan xoa, cho phep chi dinh that bai. */
export class FakeCleanupClient implements CrmCleanupClient {
  readonly calls: CleanupDeleteInput[] = [];
  readonly failEntityIds = new Set<string>();

  async deleteEntity(input: CleanupDeleteInput): Promise<CleanupDeleteResult> {
    this.calls.push({ ...input });
    if (this.failEntityIds.has(input.entityId)) {
      return { ok: false, reason: `CRM trả HTTP 500 khi xoá ${input.type} ${input.entityId} (giả lập)` };
    }
    return { ok: true, via: "api" };
  }
}

export interface ExecutionStack {
  config: AppConfig;
  runService: RunService;
  scenarioService: ScenarioService;
  dataService: DataService;
  bus: RunEventBus;
  roleStatus: RoleStatusStore;
  registry: EntityRegistry;
  cleanupClient: FakeCleanupClient;
  cleanupService: CleanupService;
  worker: FakeWorkerClient;
  executor: RunExecutor;
  batchService: BatchService;
  artifactsRoot: string;
}

/** Dung toan bo stack thuc thi bang kho InMemory (khong DB, khong trinh duyet). */
export async function makeExecutionStack(
  configOverrides: NodeJS.ProcessEnv = {},
  executorOverrides: {
    maxConcurrentSessions?: number;
    keepVideoOnPass?: boolean;
    kiemDemService?: KiemDemService;
  } = {},
): Promise<ExecutionStack> {
  const config = makeFullRoleConfig(configOverrides);
  const runService = new RunService(new InMemoryRunRepository());
  const scenarioService = new ScenarioService(new InMemoryScenarioRepository());
  const dataService = new DataService(
    new InMemoryRunDataRepository(),
    runService,
    scenarioService,
    EMPTY_BANNED_LIST,
  );
  const bus = new RunEventBus();
  const roleStatus = new RoleStatusStore();
  const registry = new EntityRegistry(new InMemoryEntityRepository());
  const cleanupClient = new FakeCleanupClient();
  const cleanupService = new CleanupService({
    registry,
    client: cleanupClient,
    runService,
    targetBaseUrlOf: async (runId) => {
      const detail = await runService.getRunWithSteps(runId);
      return detail?.run.targetUrl ?? null;
    },
    tenant: config.testTenant,
  });
  const worker = new FakeWorkerClient({ bus, runService, registry });
  const artifactsRoot = await mkdtemp(join(tmpdir(), "autotest-runs-"));
  const executor = new RunExecutor({
    config,
    runService,
    scenarioService,
    dataService,
    worker,
    bus,
    roleStatus,
    cleanupService,
    artifactsRoot,
    callbackBaseUrl: "http://localhost:3101",
    sessionTimeoutMs: 30_000,
    ...executorOverrides,
  });
  worker.onSessionFinished = (result) => executor.handleSessionFinished(result);
  const batchService = new BatchService({ runService, executor });
  return {
    config,
    runService,
    scenarioService,
    dataService,
    bus,
    roleStatus,
    registry,
    cleanupClient,
    cleanupService,
    worker,
    executor,
    batchService,
    artifactsRoot,
  };
}
