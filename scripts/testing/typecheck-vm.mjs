// Typecheck tren Muse VM: dist cua @autotest/scenario-schema khong build
// duoc tren VM (tsc bi chan ghi - EPERM), nen moi goi co mot file
// tsconfig.vm-check.json (extends tsconfig.json, them paths tro thang ve
// ma nguon packages/scenario-schema/src/index.ts). Script nay chi chay tsc
// --noEmit bang file do - khong tu ghi file (tien trinh Node tren VM bi
// chan ghi sau khi nap ma lon). Tren may that dung "pnpm typecheck".
//
//   node scripts/testing/typecheck-vm.mjs [pkgDir ...]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ALL_PACKAGES = [
  "packages/scenario-schema",
  "services/orchestrator",
  "workers/runner",
  "apps/control",
];

const packages = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL_PACKAGES;
let failed = 0;

for (const pkg of packages) {
  const pkgDir = join(ROOT, pkg);
  if (!existsSync(join(pkgDir, "tsconfig.vm-check.json"))) {
    console.log(`== typecheck ${pkg}: thieu tsconfig.vm-check.json - bo qua`);
    failed++;
    continue;
  }
  const tscBin = join(pkgDir, "node_modules/.bin/tsc");
  const bin = existsSync(tscBin) ? tscBin : join(ROOT, "node_modules/.bin/tsc");
  console.log(`== typecheck ${pkg}`);
  const result = spawnSync(bin, ["--noEmit", "-p", "tsconfig.vm-check.json"], {
    cwd: pkgDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed++;
    console.log(`== typecheck ${pkg}: THAT BAI`);
  }
}

if (failed > 0) {
  console.log(`Tong ket typecheck: ${failed} goi that bai`);
  process.exit(1);
}
console.log("Tong ket typecheck: tat ca cac goi dat");
