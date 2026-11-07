import { describe, expect, it } from "vitest";

import { buildRunId, formatRunDay } from "./run-id.js";

describe("run_id (S1.3 AC-1)", () => {
  it("dinh dang dung AUTOTEST_YYYYMMDD_NNN", () => {
    expect(buildRunId("20261107", 1)).toBe("AUTOTEST_20261107_001");
    expect(buildRunId("20261107", 42)).toBe("AUTOTEST_20261107_042");
    expect(buildRunId("20261107", 1000)).toBe("AUTOTEST_20261107_1000");
  });

  it("ngay tinh theo mui gio Asia/Saigon, khong theo UTC", () => {
    // 17:30 UTC = 00:30 sang hom sau tai Saigon
    expect(formatRunDay(new Date("2026-11-07T17:30:00Z"))).toBe("20261108");
    // 10:00 UTC = 17:00 cung ngay tai Saigon
    expect(formatRunDay(new Date("2026-11-07T10:00:00Z"))).toBe("20261107");
  });
});
