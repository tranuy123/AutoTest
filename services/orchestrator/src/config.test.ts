import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, toEnvironmentStatus } from "./config.js";

const ENV_DAY_DU: NodeJS.ProcessEnv = {
  TARGET_BASE_URL: "https://uat.example.invalid",
  TARGET_ALLOWLIST: "https://uat.example.invalid",
  TEST_TENANT: "autotest-tenant-mau",
  CHANNELS_SANDBOX: "true",
  ROLE_BAC_SI_USERNAME: "bac-si-mau@example.invalid",
  ROLE_BAC_SI_PASSWORD: "mat-khau-gia-test",
};

describe("loadConfig (S1.2 AC-1)", () => {
  it("thieu bien bat buoc thi nem ConfigError liet ke ro bien thieu", () => {
    let caught: unknown;
    try {
      loadConfig({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).missing).toEqual([
      "TARGET_BASE_URL",
      "TARGET_ALLOWLIST",
      "TEST_TENANT",
    ]);
  });

  it("thieu mot bien thi chi liet ke bien do", () => {
    let caught: unknown;
    try {
      loadConfig({ TARGET_BASE_URL: "https://uat.example.invalid" });
    } catch (error) {
      caught = error;
    }
    expect((caught as ConfigError).missing).toEqual(["TARGET_ALLOWLIST", "TEST_TENANT"]);
  });

  it("TARGET_BASE_URL khong phai URL hop le cung bi tu choi", () => {
    expect(() =>
      loadConfig({ ...ENV_DAY_DU, TARGET_BASE_URL: "khong-phai-url" }),
    ).toThrow(ConfigError);
  });

  it("doc dung allowlist nhieu muc va trang thai tung vai", () => {
    const config = loadConfig({
      ...ENV_DAY_DU,
      TARGET_ALLOWLIST: "https://uat.example.invalid, https://uat2.example.invalid",
    });
    expect(config.allowlist).toEqual([
      "https://uat.example.invalid",
      "https://uat2.example.invalid",
    ]);
    const bacSi = config.roles.find((r) => r.id === "bac-si");
    expect(bacSi?.configured).toBe(true);
    const benhNhan = config.roles.find((r) => r.id === "benh-nhan");
    expect(benhNhan?.configured).toBe(false);
    expect(config.channelsSandbox).toBe(true);
  });

  it("trang thai moi truong khong chua mat khau o bat ky dau (AC-3)", () => {
    const status = toEnvironmentStatus(loadConfig(ENV_DAY_DU));
    expect(JSON.stringify(status)).not.toContain("mat-khau-gia-test");
    const bacSi = status.roles.find((r) => r.id === "bac-si");
    expect(bacSi).toEqual({
      id: "bac-si",
      label: "Bác sĩ",
      username: "bac-si-mau@example.invalid",
      configured: true,
    });
  });
});
