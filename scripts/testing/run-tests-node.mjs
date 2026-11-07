// Chay bo test .test.ts cua cac goi bang Node test runner + shim vitest.
// Dung tren Muse VM (noi vitest CLI bi chan ghi file - xem
// spikes/stream/BAO-CAO-SPIKE.md muc 5). Tren may that dung "pnpm test".
//
// Cach dung:
//   node scripts/testing/run-tests-node.mjs                 # tat ca cac goi
//   node scripts/testing/run-tests-node.mjs services/orchestrator workers/runner
//
// Moi goi chay trong tien trinh con voi cwd = thu muc goi. Test PG
// (*.pg.test.ts) tu skip khi khong co TEST_DATABASE_URL.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTER = join(ROOT, "scripts/testing/vitest-register.mjs");
const ALL_PACKAGES = [
  "packages/scenario-schema",
  "packages/oracle",
  "services/orchestrator",
  "workers/runner",
  "apps/control",
];

const packages = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL_PACKAGES;
let failed = 0;

for (const pkg of packages) {
  const pkgDir = join(ROOT, pkg);
  const files = globSync("src/**/*.test.ts", { cwd: pkgDir }).sort();
  if (files.length === 0) {
    console.log(`== ${pkg}: khong co test trong src/ - bo qua`);
    continue;
  }
  console.log(`== ${pkg}: ${files.length} file test`);
  const result = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--import", REGISTER, "--test", ...files],
    { cwd: pkgDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    failed++;
    console.log(`== ${pkg}: THAT BAI (exit ${result.status})`);
  }
}

if (failed > 0) {
  console.log(`Tong ket: ${failed} goi that bai`);
  process.exit(1);
}
console.log("Tong ket: tat ca cac goi dat");
