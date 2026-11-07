/** Ho tro test: cau hinh mau hop le dung cho cac test cua orchestrator. */
import { loadConfig, type AppConfig } from "./config.js";

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
