import { describe, expect, it } from "vitest";

import { assertTargetAllowed, evaluateTarget, TargetBlockedError } from "./target-guard.js";

const ALLOWLIST = ["https://uat.example.invalid"];

describe("evaluateTarget (S1.2 AC-4)", () => {
  it("URL UAT trong allowlist duoc chap nhan", () => {
    expect(evaluateTarget("https://uat.example.invalid", ALLOWLIST).allowed).toBe(true);
    expect(evaluateTarget("https://uat.example.invalid/trang-chu", ALLOWLIST).allowed).toBe(
      true,
    );
  });

  it("URL production mau bi tu choi", () => {
    const ketQua = evaluateTarget("https://crm.phongkham-that.vn", ALLOWLIST);
    expect(ketQua.allowed).toBe(false);
    expect(ketQua.reason).toContain("allowlist");
  });

  it("URL la bi tu choi", () => {
    expect(evaluateTarget("https://trang-la.example.com", ALLOWLIST).allowed).toBe(false);
  });

  it("URL gia mao hau to cua UAT bi tu choi", () => {
    expect(evaluateTarget("https://uat.example.invalid.evil.com", ALLOWLIST).allowed).toBe(
      false,
    );
    expect(evaluateTarget("https://evil-uat.example.invalid", ALLOWLIST).allowed).toBe(false);
  });

  it("URL chua thong tin dang nhap bi tu choi", () => {
    expect(evaluateTarget("https://user:pass@uat.example.invalid", ALLOWLIST).allowed).toBe(
      false,
    );
  });

  it("URL khong hop le bi tu choi (fail-closed)", () => {
    expect(evaluateTarget("khong phai url", ALLOWLIST).allowed).toBe(false);
    expect(evaluateTarget("ftp://uat.example.invalid", ALLOWLIST).allowed).toBe(false);
  });

  it("allowlist co tien to duong dan thi chi chap nhan trong tien to do", () => {
    const list = ["https://uat.example.invalid/uat"];
    expect(evaluateTarget("https://uat.example.invalid/uat/trang", list).allowed).toBe(true);
    expect(evaluateTarget("https://uat.example.invalid/prod/trang", list).allowed).toBe(false);
  });

  it("assertTargetAllowed nem TargetBlockedError khi bi chan", () => {
    expect(() => assertTargetAllowed("https://crm.phongkham-that.vn", ALLOWLIST)).toThrow(
      TargetBlockedError,
    );
    expect(() => assertTargetAllowed("https://uat.example.invalid", ALLOWLIST)).not.toThrow();
  });
});
