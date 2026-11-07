import { describe, expect, it } from "vitest";

import { createRunLogger, redactText, sanitizeLogEntry } from "./run-logger.js";

describe("redactText (S1.3 AC-3)", () => {
  it("che so dien thoai Viet Nam va email", () => {
    const out = redactText("Loi khi gui cho 0901234567 / +84901234567, email a.b@example.com");
    expect(out).not.toContain("0901234567");
    expect(out).not.toContain("84901234567");
    expect(out).not.toContain("a.b@example.com");
    expect(out).toContain("[da-che]");
  });

  it("che gia tri secret dang khoa=gia-tri", () => {
    const out = redactText("password=abc123 token: xyz-789");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("xyz-789");
  });
});

describe("sanitizeLogEntry (S1.3 AC-3)", () => {
  it("chi giu truong trong danh sach trang, loai bo du lieu ca nhan gui thua", () => {
    const clean = sanitizeLogEntry({
      event: "run_step",
      runId: "AUTOTEST_20261107_001",
      stepId: "dat-lich",
      durationMs: 1200,
      // Cac truong la duoi day phai bi loai bo hoan toan:
      patientName: "Nguyen Van A",
      phone: "0901234567",
      examResult: "noi dung kham bi mat",
    } as Parameters<typeof sanitizeLogEntry>[0]);
    const text = JSON.stringify(clean);
    expect(text).not.toContain("Nguyen Van A");
    expect(text).not.toContain("0901234567");
    expect(text).not.toContain("noi dung kham");
    expect(clean.runId).toBe("AUTOTEST_20261107_001");
    expect(clean.durationMs).toBe(1200);
  });

  it("nhat ky ghi ra khong chua du lieu nhay cam trong thong diep loi", () => {
    const lines: string[] = [];
    const logger = createRunLogger((line) => lines.push(line));
    logger.log({
      event: "run_step",
      runId: "AUTOTEST_20261107_002",
      stepId: "nhac-hen",
      errorCode: "GUI_THAT_BAI",
      errorMessage: "Khong gui duoc toi 0912345678, password=sai-roi",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("0912345678");
    expect(lines[0]).not.toContain("sai-roi");
    expect(lines[0]).toContain("AUTOTEST_20261107_002");
  });
});
