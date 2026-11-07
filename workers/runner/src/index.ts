/**
 * @autotest/runner - khung (S1.1).
 * Worker thuc thi Playwright se duoc xay dung o Epic 3 (S3.1 tro di).
 * Ban khung chi lam hai viec: ghi file "san sang" de healthcheck cua
 * docker-compose nhan biet, va giu tien trinh song trong khi cho viec.
 * Ten goi "runner" trung lap theo AD-8 (khong dat theo che do Xem/Nhanh).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface RunnerInfo {
  name: string;
  state: "idle";
  engine: "playwright";
}

export function describeRunner(): RunnerInfo {
  return { name: "@autotest/runner", state: "idle", engine: "playwright" };
}

export function startRunner(): void {
  const readyFile = process.env.RUNNER_READY_FILE ?? "/tmp/runner-ready";
  const info = describeRunner();
  writeFileSync(readyFile, `${info.name} ${new Date().toISOString()}\n`, "utf8");
  console.log(`[runner] san sang (che do cho viec), ready file: ${readyFile}`);
  // Giu tien trinh song; Epic 3 se thay vong cho nay bang hang doi viec that.
  setInterval(() => {
    // heartbeat: khong lam gi, chi giu event loop
  }, 30_000);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) {
  startRunner();
}
