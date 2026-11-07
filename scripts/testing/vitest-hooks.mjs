// Resolve hook cho Node test runner:
// - import "vitest" -> vitest-shim.mjs (cung thu muc).
// - specifier "./x.js" -> "./x.ts" khi chi co file .ts (ma nguon dung hau to
//   .js theo chuan NodeNext, chay truc tiep nho type-transform cua Node 24).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHIM_URL = new URL("./vitest-shim.mjs", import.meta.url).href;
// Goi workspace @autotest/scenario-schema: dist cua no khong build duoc tren
// VM (EPERM khi tsc ghi file) nen anh xa thang ve ma nguon src/index.ts.
const SCENARIO_SCHEMA_SRC = new URL(
  "../../packages/scenario-schema/src/index.ts",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vitest") {
    return { url: SHIM_URL, shortCircuit: true };
  }
  if (specifier === "@autotest/scenario-schema") {
    return { url: SCENARIO_SCHEMA_SRC, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js") &&
      context.parentURL
    ) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) {
        return { url: tsUrl.href, shortCircuit: true };
      }
    }
    throw error;
  }
}
