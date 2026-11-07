import { describe, expect, it } from "vitest";

import { RunEventBus, SyncTimeoutError } from "./event-bus.js";

describe("RunEventBus — đồng bộ sự kiện theo lần chạy (AD-3)", () => {
  it("sự kiện phát trước vẫn đến được vai chờ sau (dựa trên lịch sử lần chạy)", async () => {
    const bus = new RunEventBus();
    bus.emit({
      runId: "RUN_A",
      name: "lich-da-dat",
      payload: { appointment_id: "LH-1" },
      fromRole: "benh-nhan",
    });
    const event = await bus.waitFor({
      runId: "RUN_A",
      name: "lich-da-dat",
      waitingRole: "le-tan",
      timeoutMs: 500,
    });
    expect(event.payload.appointment_id).toBe("LH-1");
    expect(event.fromRole).toBe("benh-nhan");
  });

  it("vai chờ trước nhận sự kiện khi được phát", async () => {
    const bus = new RunEventBus();
    const waiting = bus.waitFor({
      runId: "RUN_A",
      name: "da-check-in",
      waitingRole: "bac-si",
      timeoutMs: 2_000,
    });
    setTimeout(() => {
      bus.emit({ runId: "RUN_A", name: "da-check-in", payload: {}, fromRole: "le-tan" });
    }, 30);
    const event = await waiting;
    expect(event.name).toBe("da-check-in");
    expect(event.fromRole).toBe("le-tan");
  });

  it("quá hạn chờ: lỗi nêu rõ vai chờ, sự kiện, vai nguồn kỳ vọng và lần chạy", async () => {
    const bus = new RunEventBus();
    const error = await bus
      .waitFor({
        runId: "AUTOTEST_20261107_009",
        name: "lich-da-dat",
        waitingRole: "le-tan",
        timeoutMs: 60,
        expectedFromRole: "benh-nhan",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(SyncTimeoutError);
    const message = (error as Error).message;
    expect(message).toContain("le-tan");
    expect(message).toContain("lich-da-dat");
    expect(message).toContain("benh-nhan");
    expect(message).toContain("AUTOTEST_20261107_009");
  });

  it("cách ly theo run_id: sự kiện của lần chạy khác không đánh thức vai chờ", async () => {
    const bus = new RunEventBus();
    bus.emit({ runId: "RUN_B", name: "su-kien-x", payload: {}, fromRole: "le-tan" });
    const error = await bus
      .waitFor({ runId: "RUN_A", name: "su-kien-x", waitingRole: "bac-si", timeoutMs: 60 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(SyncTimeoutError);
    expect(bus.history("RUN_B")).toHaveLength(1);
    expect(bus.history("RUN_A")).toHaveLength(0);
  });

  it("clearRun từ chối các vai đang chờ của lần chạy đó", async () => {
    const bus = new RunEventBus();
    const waiting = bus.waitFor({
      runId: "RUN_A",
      name: "su-kien-y",
      waitingRole: "thu-ngan",
      timeoutMs: 5_000,
    });
    bus.clearRun("RUN_A");
    await expect(waiting).rejects.toThrow(/đã kết thúc/);
    expect(bus.history("RUN_A")).toHaveLength(0);
  });
});
