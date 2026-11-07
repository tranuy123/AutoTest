import { describe, expect, it } from "vitest";

import { FakePageDriver, locatorKey, type PageDriver } from "./page-driver.js";
import {
  bamNut,
  choPhanTu,
  chupAnhManHinh,
  dienTruong,
  docGiaTriHienThi,
  moTrang,
} from "./steps.js";
import { StepError } from "./types.js";

const EMAIL = { by: "label", text: "Email" } as const;
const SUBMIT = { by: "role", role: "button", name: "Lưu" } as const;

describe("Thu vien buoc co ban (S3.1 AC-2)", () => {
  it("thuc hien duoc mo trang, dien form, bam nut, cho phan tu, doc gia tri, chup anh", async () => {
    const driver = new FakePageDriver();
    driver.setElement(EMAIL, { visible: true });
    driver.setElement(SUBMIT, { visible: true, text: "Lưu" });
    const ctx = { stepId: "buoc-1" };

    await moTrang(driver, ctx, "https://uat.example.invalid/dat-lich");
    await dienTruong(driver, ctx, [EMAIL], "a@example.invalid");
    await bamNut(driver, ctx, [SUBMIT]);
    await choPhanTu(driver, ctx, [SUBMIT]);
    const text = await docGiaTriHienThi(driver, ctx, [SUBMIT]);
    await chupAnhManHinh(driver, ctx, "/tmp/anh.png");

    expect(text).toBe("Lưu");
    expect(driver.ops.map((o) => o.op)).toEqual([
      "goto",
      "fill",
      "click",
      "wait",
      "readText",
      "screenshot",
    ]);
    expect(driver.elements.get(locatorKey(EMAIL))?.value).toBe("a@example.invalid");
  });

  it("loi buoc neu dung ten buoc va ly do khi khong tim thay phan tu", async () => {
    const driver = new FakePageDriver();
    let caught: unknown = null;
    try {
      await dienTruong(driver, { stepId: "dien-email" }, [EMAIL], "x");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StepError);
    expect((caught as StepError).message).toContain("dien-email");
    expect((caught as StepError).message).toContain("Không tìm thấy phần tử");
  });

  it("timeout cua buoc duoc truyen xuong driver", async () => {
    const seen: number[] = [];
    const stub: PageDriver = {
      goto: async (_url, opts) => {
        seen.push(opts.timeoutMs);
      },
      currentUrl: () => "about:blank",
      fillFirst: async () => undefined,
      clickFirst: async () => undefined,
      selectFirst: async () => undefined,
      waitFirstVisible: async () => undefined,
      readFirstText: async () => "",
      readFirstValue: async () => "",
      screenshot: async () => undefined,
    };
    await moTrang(stub, { stepId: "mo-trang", timeoutMs: 4321 }, "https://x.invalid");
    await moTrang(stub, { stepId: "mo-trang" }, "https://x.invalid");
    expect(seen).toEqual([4321, 15_000]);
  });
});
