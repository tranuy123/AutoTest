/**
 * Diem vao cua orchestrator.
 * S1.2: nap cau hinh tu .env truoc khi khoi dong - thieu bien bat buoc thi
 * tu choi khoi dong (fail-closed) va liet ke ro bien nao thieu.
 * S1.3: noi kho lan chay - co DATABASE_URL thi dung PostgreSQL (chay
 * migration), khong co thi dung kho tam trong bo nho va canh bao ro rang.
 * S2.2: noi thu vien kich ban + nap san kich ban mau khi thu vien rong.
 * S2.3: noi dich vu sinh du lieu theo run_id; danh sach du lieu that bi cam
 * doc tu BANNED_DATA_FILE (JSON {names, phones}) neu duoc khai bao.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BatchService } from "./batch.js";
import { CleanupService, HttpCrmCleanupClient } from "./cleanup.js";
import { ConfigError, loadConfig } from "./config.js";
import { EMPTY_BANNED_LIST, type BannedDataList } from "./data-generator.js";
import {
  EntityRegistry,
  InMemoryEntityRepository,
  PgEntityRepository,
} from "./entity-registry.js";
import { RunEventBus } from "./event-bus.js";
import { taoKiemDemService } from "./kiem-dem.js";
import { RoleStatusStore } from "./role-status.js";
import { createRunLogger } from "./run-logger.js";
import { RunExecutor } from "./run-executor.js";
import {
  DataService,
  InMemoryRunDataRepository,
  PgRunDataRepository,
} from "./run-data-store.js";
import { InMemoryRunRepository, PgRunRepository, RunService } from "./run-store.js";
import { SandboxGate } from "./sandbox-gate.js";
import {
  InMemoryScenarioRepository,
  PgScenarioRepository,
  ScenarioService,
} from "./scenario-store.js";
import { createOrchestratorServer } from "./server.js";
import { HttpWorkerClient } from "./worker-client.js";

// Tim .env o thu muc hien tai hoac goc repo (khi chay bang pnpm tu thu muc goi).
for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[orchestrator] Tu choi khoi dong: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const repository = config.databaseUrl
  ? new PgRunRepository(config.databaseUrl)
  : new InMemoryRunRepository();
if (!config.databaseUrl) {
  console.warn(
    "[orchestrator] Khong co DATABASE_URL - dung kho lan chay tam trong bo nho (du lieu mat khi tat).",
  );
}
await repository.init();
const runService = new RunService(repository);

const scenarioRepository = config.databaseUrl
  ? new PgScenarioRepository(config.databaseUrl)
  : new InMemoryScenarioRepository();
await scenarioRepository.init();
const scenarioService = new ScenarioService(scenarioRepository);

// Nap san cac kich ban mau mac dinh cua goi scenario-schema: kich ban
// luong day du (S2.2) va kich ban chuan vang 29.1/29.2 (S4.3).
try {
  const pkgJsonUrl = import.meta.resolve("@autotest/scenario-schema/package.json");
  const samplesDir = resolve(dirname(fileURLToPath(pkgJsonUrl)), "samples");
  for (const file of ["dat-lich-den-bao-cao.yaml", "dat-lich-den-bao-cao-29.yaml"]) {
    const samplePath = resolve(samplesDir, file);
    if (existsSync(samplePath)) {
      await scenarioService.seedSampleIfAbsent(readFileSync(samplePath, "utf8"), file);
    }
  }
} catch (error) {
  console.warn(
    `[orchestrator] Khong nap duoc kich ban mau: ${error instanceof Error ? error.message : "loi khong ro"}`,
  );
}

const dataRepository = config.databaseUrl
  ? new PgRunDataRepository(config.databaseUrl)
  : new InMemoryRunDataRepository();
await dataRepository.init();

let bannedList: BannedDataList = EMPTY_BANNED_LIST;
const bannedFile = process.env.BANNED_DATA_FILE;
if (bannedFile && existsSync(bannedFile)) {
  try {
    const parsed = JSON.parse(readFileSync(bannedFile, "utf8")) as Partial<BannedDataList>;
    bannedList = {
      names: Array.isArray(parsed.names) ? parsed.names : [],
      phones: Array.isArray(parsed.phones) ? parsed.phones : [],
    };
  } catch {
    console.warn("[orchestrator] BANNED_DATA_FILE khong doc duoc - dung danh sach cam rong.");
  }
}
const dataService = new DataService(dataRepository, runService, scenarioService, bannedList);

/* ---------------- Epic 3: thuc thi nhieu vai + stream ---------------- */

const bus = new RunEventBus();
const roleStatus = new RoleStatusStore();

const entityRepository = config.databaseUrl
  ? new PgEntityRepository(config.databaseUrl)
  : new InMemoryEntityRepository();
const registry = new EntityRegistry(entityRepository);
await registry.init();

const cleanupService = new CleanupService({
  registry,
  client: new HttpCrmCleanupClient({
    ...(process.env.CRM_CLEANUP_PATH_TEMPLATE
      ? { pathTemplate: process.env.CRM_CLEANUP_PATH_TEMPLATE }
      : {}),
    ...(process.env.CRM_CLEANUP_TOKEN ? { token: process.env.CRM_CLEANUP_TOKEN } : {}),
  }),
  runService,
  targetBaseUrlOf: async (runId) => {
    const detail = await runService.getRunWithSteps(runId);
    return detail?.run.targetUrl ?? null;
  },
  tenant: config.testTenant,
});

const runnerUrl = process.env.RUNNER_URL ?? "http://localhost:3102";
const worker = new HttpWorkerClient(runnerUrl);
// Khoi kiem dem Epic 4: nguon DB chua cau hinh thi chi tieu co nguon db
// se "khong kiem chung duoc" (S4.2 AC-4) thay vi im lang bo qua.
const kiemDemService = taoKiemDemService(config);
// Cong sandbox kenh ngoai (S5.3): chi kich ban khai bao kenhNgoai moi bi
// kiem tra; fail-closed khi khong xac nhan duoc sandbox.
const sandboxGate = new SandboxGate({
  channelsSandboxConfig: config.channelsSandbox,
  healthPath: config.crmHealthPath,
});
const artifactsRoot = resolve(process.env.AUTOTEST_DATA_DIR ?? "runs-data");
const executor = new RunExecutor({
  config,
  runService,
  scenarioService,
  dataService,
  worker,
  bus,
  roleStatus,
  cleanupService,
  kiemDemService,
  sandboxGate,
  artifactsRoot,
  callbackBaseUrl:
    process.env.ORCHESTRATOR_CALLBACK_URL ?? `http://localhost:${config.port}`,
  ...(process.env.MAX_PARALLEL_SESSIONS
    ? { maxConcurrentSessions: Number(process.env.MAX_PARALLEL_SESSIONS) }
    : {}),
  ...(process.env.MAX_CONCURRENT_RUNS
    ? { maxConcurrentRuns: Number(process.env.MAX_CONCURRENT_RUNS) }
    : {}),
  ...(process.env.STOP_GRACE_MS
    ? { stopGraceMs: Number(process.env.STOP_GRACE_MS) }
    : {}),
  ...(process.env.VIEW_PACE_MS ? { viewPaceMs: Number(process.env.VIEW_PACE_MS) } : {}),
  keepVideoOnPass: process.env.VIDEO_KEEP_ON_PASS === "true",
});

const batchService = new BatchService({
  runService,
  executor,
  ...(process.env.BATCH_CONCURRENCY
    ? { concurrency: Number(process.env.BATCH_CONCURRENCY) }
    : {}),
});

const server = createOrchestratorServer({
  config,
  runService,
  runLogger: createRunLogger(),
  scenarioService,
  dataService,
  executor,
  bus,
  roleStatus,
  registry,
  cleanupService,
  batchService,
  worker,
  sandboxGate,
  artifactsRoot,
  keepVideoOnPass: process.env.VIDEO_KEEP_ON_PASS === "true",
  streamGatewayWsUrl: process.env.STREAM_GATEWAY_WS_URL ?? "ws://localhost:3102",
});
server.listen(config.port, () => {
  console.log(`[orchestrator] dang nghe tai cong ${config.port}`);
});
