import { describe, expect, it } from "vitest";

import { FakeSessionFactory } from "./browser.js";
import { SessionEngine, type StepReporter, type SyncClient, type SyncEvent } from "./engine.js";
import { FakePageDriver, type LocatorSpec } from "./page-driver.js";
import type { SessionRequest, StepOutcome, StepPlan } from "./types.js";

const USERNAME_FIELD: LocatorSpec = { by: "label", text: "Tên đăng nhập" };
const PASSWORD_FIELD: LocatorSpec = { by: "label", text: "Mật khẩu" };
const LOGIN_BUTTON: LocatorSpec = { by: "role", role: "button", name: "Đăng nhập" };
const APP_SHELL: LocatorSpec = { by: "testid", id: "app-shell" };
const PATIENT_NAME: LocatorSpec = { by: "label", text: "Họ tên bệnh nhân" };
const PATIENT_PHONE: LocatorSpec = { by: "label", text: "Số điện thoại" };
const SERVICE_FIELD: LocatorSpec = { by: "label", text: "Dịch vụ" };
const SUBMIT_BOOKING: LocatorSpec = { by: "role", role: "button", name: "Đặt lịch" };
const TOAST: LocatorSpec = { by: "testid", id: "toast-success" };
const APPT_ID: LocatorSpec = { by: "testid", id: "lich-hen-id" };

function setupCrm(driver: FakePageDriver): void {
  for (const spec of [
    USERNAME_FIELD,
    PASSWORD_FIELD,
    LOGIN_BUTTON,
    APP_SHELL,
    PATIENT_NAME,
    PATIENT_PHONE,
    SERVICE_FIELD,
    SUBMIT_BOOKING,
    TOAST,
  ]) {
    driver.setElement(spec, { visible: true });
  }
  driver.setElement(APPT_ID, { visible: true, text: "LH-2026-001" });
}

class FakeSync implements SyncClient {
  readonly events = new Map<string, SyncEvent>();
  readonly waits: string[] = [];
  timeoutEvents = new Set<string>();

  async waitForEvent(input: {
    runId: string;
    roleId: string;
    name: string;
    timeoutMs: number;
  }): Promise<SyncEvent> {
    this.waits.push(input.name);
    if (this.timeoutEvents.has(input.name)) {
      throw new Error(
        `Vai '${input.roleId}' chờ sự kiện '${input.name}' quá hạn ${input.timeoutMs}ms`,
      );
    }
    const event = this.events.get(input.name);
    if (!event) throw new Error(`Chưa có sự kiện '${input.name}'`);
    return event;
  }

  async emitEvent(input: {
    runId: string;
    roleId: string;
    name: string;
    payload: Record<string, string | number | boolean>;
  }): Promise<void> {
    this.events.set(input.name, {
      name: input.name,
      payload: input.payload,
      fromRole: input.roleId,
    });
  }
}

const REQ: SessionRequest = {
  runId: "AUTOTEST_20261107_001",
  roleId: "benh-nhan",
  mode: "xem",
  targetBaseUrl: "https://uat.example.invalid",
  username: "bn@example.invalid",
  password: "mat-khau-gia",
  stream: true,
  paceMs: 0,
  artifactsDir: "/tmp/autotest-artifacts",
};

async function runEngine(
  steps: StepPlan[],
  options: { sync?: SyncClient; reporter?: StepReporter; req?: SessionRequest } = {},
) {
  const factory = new FakeSessionFactory();
  factory.setupDriver = (driver) => setupCrm(driver);
  const handle = await factory.launch(options.req ?? REQ, null);
  const engine = new SessionEngine({
    sync: options.sync ?? new FakeSync(),
    ...(options.reporter ? { reporter: options.reporter } : {}),
    sleep: async () => undefined,
  });
  const result = await engine.execute({
    sessionId: "ses-1",
    req: options.req ?? REQ,
    steps,
    handle,
    display: null,
  });
  return { factory, result, driver: factory.launches[0]?.driver as FakePageDriver };
}

describe("SessionEngine - kich ban 1 vai toi thieu (S3.1 AC-3, AC-4)", () => {
  it("dang nhap -> dat lich chay qua, co video va anh cuoi phien, phien dong sach", async () => {
    const entities: Array<{ type: string; entityId: string }> = [];
    const reporter: StepReporter = {
      entityCreated: async (input) => {
        entities.push({ type: input.type, entityId: input.entityId });
      },
    };
    const { factory, result, driver } = await runEngine(
      [
        { stepId: "dang-nhap", actionId: "dang-nhap", emitEvent: "san-sang" },
        {
          stepId: "dat-lich",
          actionId: "dat-lich-hen",
          waitEvent: "san-sang",
          emitEvent: "lich-da-dat",
          data: {
            "benhNhan.hoTen": "Nguyen Van A",
            "benhNhan.soDienThoai": "0112345678",
            dichVu: "DV-KHAM-TQ",
          },
        },
      ],
      { reporter },
    );

    expect(result.status).toBe("qua");
    expect(result.steps.map((s) => s.status)).toEqual(["qua", "qua"]);
    expect(result.steps[1]?.outputs.appointment_id).toBe("LH-2026-001");
    expect(entities).toEqual([{ type: "lich-hen", entityId: "LH-2026-001" }]);
    expect(result.videoPath).toContain("video");
    expect(result.screenshots).toHaveLength(1);
    // Thong tin dang nhap den tu phien, khong phai du lieu buoc.
    const fills = driver.ops.filter((o) => o.op === "fill");
    expect(fills.map((f) => f.value)).toContain("bn@example.invalid");
    expect(fills.map((f) => f.value)).toContain("Nguyen Van A");
    // AC-4: phien dong sach sau lan chay.
    expect(factory.openCount).toBe(0);
  });

  it("chay lai tao phien moi hoan toan, khong dinh phien cu (AC-4)", async () => {
    const factory = new FakeSessionFactory();
    factory.setupDriver = (driver) => setupCrm(driver);
    const engine = new SessionEngine({ sync: new FakeSync(), sleep: async () => undefined });
    const steps: StepPlan[] = [{ stepId: "dang-nhap", actionId: "dang-nhap" }];
    const h1 = await factory.launch(REQ, null);
    await engine.execute({ sessionId: "s1", req: REQ, steps, handle: h1, display: null });
    const h2 = await factory.launch(REQ, null);
    await engine.execute({ sessionId: "s2", req: REQ, steps, handle: h2, display: null });
    expect(factory.launches).toHaveLength(2);
    expect(factory.launches[0]?.driver).not.toBe(factory.launches[1]?.driver);
    expect(factory.openCount).toBe(0);
  });
});

describe("SessionEngine - loi buoc va dong bo (S3.1 AC-2, S3.3 AC-2/AC-3)", () => {
  it("buoc hong thi dung chuoi, bao loi dung ten buoc, phien van dong sach", async () => {
    const factory = new FakeSessionFactory();
    // Khong dang ky phan tu dang nhap -> buoc dang-nhap hong.
    const handle = await factory.launch(REQ, null);
    const engine = new SessionEngine({ sync: new FakeSync(), sleep: async () => undefined });
    const result = await engine.execute({
      sessionId: "ses-x",
      req: REQ,
      handle,
      display: null,
      steps: [
        { stepId: "dang-nhap", actionId: "dang-nhap" },
        { stepId: "dat-lich", actionId: "dat-lich-hen" },
      ],
    });
    expect(result.status).toBe("hong");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.error).toContain("dang-nhap");
    expect(factory.openCount).toBe(0);
  });

  it("cho su kien truoc khi chay buoc va phat su kien kem outputs sau buoc", async () => {
    const sync = new FakeSync();
    sync.events.set("le-tan-san-sang", {
      name: "le-tan-san-sang",
      payload: {},
      fromRole: "le-tan",
    });
    const order: string[] = [];
    const spySync: SyncClient = {
      waitForEvent: async (input) => {
        order.push(`wait:${input.name}`);
        return sync.waitForEvent(input);
      },
      emitEvent: async (input) => {
        order.push(`emit:${input.name}`);
        return sync.emitEvent(input);
      },
    };
    const { result } = await runEngine(
      [
        {
          stepId: "dat-lich",
          actionId: "dat-lich-hen",
          waitEvent: "le-tan-san-sang",
          emitEvent: "lich-da-dat",
          data: { "benhNhan.hoTen": "Tran Thi B", "benhNhan.soDienThoai": "0119876543" },
        },
      ],
      { sync: spySync },
    );
    expect(result.status).toBe("qua");
    expect(order).toEqual(["wait:le-tan-san-sang", "emit:lich-da-dat"]);
    expect(sync.events.get("lich-da-dat")?.payload.appointment_id).toBe("LH-2026-001");
    expect(sync.events.get("lich-da-dat")?.payload.run_id).toBe(REQ.runId);
  });

  it("qua han diem dong bo thi fail tai dung buoc do va neu ro su kien", async () => {
    const sync = new FakeSync();
    sync.timeoutEvents.add("khong-bao-gio-den");
    const { result } = await runEngine(
      [
        {
          stepId: "xac-nhan",
          actionId: "xac-nhan-lich",
          waitEvent: "khong-bao-gio-den",
          syncTimeoutMs: 5000,
        },
      ],
      { sync },
    );
    expect(result.status).toBe("hong");
    const failed = result.steps[0] as StepOutcome;
    expect(failed.error).toContain("xac-nhan");
    expect(failed.error).toContain("khong-bao-gio-den");
  });
});

describe("SessionEngine - nhip xem (S3.2 AC-4)", () => {
  it("che do xem co do tre giua cac buoc, che do nhanh thi khong", async () => {
    const sleeps: number[] = [];
    const factory = new FakeSessionFactory();
    factory.setupDriver = (driver) => setupCrm(driver);
    const steps: StepPlan[] = [
      { stepId: "dang-nhap", actionId: "dang-nhap" },
      { stepId: "mo-trang-chu", actionId: "mo-trang-chu" },
      { stepId: "mo-trang-chu-2", actionId: "mo-trang-chu" },
    ];
    const engineXem = new SessionEngine({
      sync: new FakeSync(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const h1 = await factory.launch({ ...REQ, paceMs: 250 }, null);
    await engineXem.execute({
      sessionId: "s-xem",
      req: { ...REQ, paceMs: 250 },
      steps,
      handle: h1,
      display: null,
    });
    expect(sleeps).toEqual([250, 250]);

    const engineNhanh = new SessionEngine({
      sync: new FakeSync(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const h2 = await factory.launch({ ...REQ, mode: "nhanh" }, null);
    await engineNhanh.execute({
      sessionId: "s-nhanh",
      req: { ...REQ, mode: "nhanh" },
      steps,
      handle: h2,
      display: null,
    });
    expect(sleeps).toEqual([250, 250]);
  });
});
