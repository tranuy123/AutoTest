/**
 * Diem vao cua orchestrator.
 * S1.2: nap cau hinh tu .env truoc khi khoi dong - thieu bien bat buoc thi
 * tu choi khoi dong (fail-closed) va liet ke ro bien nao thieu.
 * S1.3: noi kho lan chay - co DATABASE_URL thi dung PostgreSQL (chay
 * migration), khong co thi dung kho tam trong bo nho va canh bao ro rang.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigError, loadConfig } from "./config.js";
import { createRunLogger } from "./run-logger.js";
import { InMemoryRunRepository, PgRunRepository, RunService } from "./run-store.js";
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

const server = createOrchestratorServer({
  config,
  runService: new RunService(repository),
  runLogger: createRunLogger(),
});
server.listen(config.port, () => {
  console.log(`[orchestrator] dang nghe tai cong ${config.port}`);
});
