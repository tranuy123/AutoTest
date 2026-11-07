/**
 * @autotest/runner - worker thuc thi Playwright (Epic 3).
 * Diem vao: khoi dong may chu worker (API phien + Stream Gateway noVNC)
 * tren cong RUNNER_PORT (mac dinh 3102), ghi file "san sang" cho
 * healthcheck cua docker-compose va giu tien trinh song.
 * Logic nam o cac module: server.ts (API), engine.ts (thuc thi buoc),
 * browser.ts (phien Chromium), xvnc.ts (man hinh ao), stream-gateway.ts.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { PlaywrightSessionFactory } from "./browser.js";
import { createRunnerServer } from "./server.js";
import { StreamGateway } from "./stream-gateway.js";
import { XvncManager } from "./xvnc.js";

export interface RunnerInfo {
  name: string;
  state: "idle";
  engine: "playwright";
}

export function describeRunner(): RunnerInfo {
  return { name: "@autotest/runner", state: "idle", engine: "playwright" };
}

export function startRunner(): void {
  const port = Number(process.env.RUNNER_PORT ?? 3102);
  const gateway = new StreamGateway((message) => console.log(`[runner] ${message}`));
  const server = createRunnerServer({
    factory: new PlaywrightSessionFactory(),
    xvnc: new XvncManager(),
    gateway,
  });
  server.listen(port, () => {
    console.log(`[runner] dang nghe tai cong ${port}`);
    const readyFile = process.env.RUNNER_READY_FILE ?? "/tmp/runner-ready";
    const info = describeRunner();
    writeFileSync(readyFile, `${info.name} ${new Date().toISOString()}\n`, "utf8");
    console.log(`[runner] san sang, ready file: ${readyFile}`);
  });
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) {
  startRunner();
}
