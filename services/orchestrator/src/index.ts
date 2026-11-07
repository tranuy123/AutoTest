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

import { ConfigError, loadConfig } from "./config.js";
import { EMPTY_BANNED_LIST, type BannedDataList } from "./data-generator.js";
import { createRunLogger } from "./run-logger.js";
import {
  DataService,
  InMemoryRunDataRepository,
  PgRunDataRepository,
} from "./run-data-store.js";
import { InMemoryRunRepository, PgRunRepository, RunService } from "./run-store.js";
import {
  InMemoryScenarioRepository,
  PgScenarioRepository,
  ScenarioService,
} from "./scenario-store.js";
import { createOrchestratorServer } from "./server.js";

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

// Nap san kich ban mau cua goi scenario-schema khi thu vien dang rong.
try {
  const pkgJsonUrl = import.meta.resolve("@autotest/scenario-schema/package.json");
  const samplePath = resolve(
    dirname(fileURLToPath(pkgJsonUrl)),
    "samples/dat-lich-den-bao-cao.yaml",
  );
  if (existsSync(samplePath)) {
    await scenarioService.seedIfEmpty(readFileSync(samplePath, "utf8"));
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

const server = createOrchestratorServer({
  config,
  runService,
  runLogger: createRunLogger(),
  scenarioService,
  dataService,
});
server.listen(config.port, () => {
  console.log(`[orchestrator] dang nghe tai cong ${config.port}`);
});
