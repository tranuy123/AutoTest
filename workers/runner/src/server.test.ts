import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeSessionFactory } from "./browser.js";
import { FakePageDriver, type LocatorSpec } from "./page-driver.js";
import { createRunnerServer } from "./server.js";
import { StreamGateway } from "./stream-gateway.js";
import type { DisplayHandle } from "./xvnc.js";

const ELEMENTS: LocatorSpec[] = [
  { by: "label", text: "Tên đăng nhập" },
  { by: "label", text: "Mật khẩu" },
  { by: "role", role: "button", name: "Đăng nhập" },
  { by: "testid", id: "app-shell" },
  { by: "label", text: "Họ tên bệnh nhân" },
  { by: "label", text: "Số điện thoại" },
  { by: "label", text: "Dịch vụ" },
  { by: "role", role: "button", name: "Đặt lịch" },
  { by: "testid", id: "toast-success" },
];

function setupCrm(driver: FakePageDriver): void {
  for (const spec of ELEMENTS) driver.setElement(spec, { visible: true });
  driver.setElement({ by: "testid", id: "lich-hen-id" }, { visible: true, text: "LH-9" });
}

/** Orchestrator gia lap: giu su kien, ghi lai callback cua worker. */
class FakeOrchestrator {
  readonly events = new Map<string, { payload: unknown; fromRole: string }>();
  readonly steps: unknown[] = [];
  readonly entities: unknown[] = [];
  finished: unknown = null;
  private finishedWaiters: Array<() => void> = [];
  server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as string));
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
        : {};
      const json = (code: number, data: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "POST" && /\/events$/.test(url.pathname)) {
        this.events.set(String(body.name), {
          payload: body.payload,
          fromRole: String(body.fromRole),
        });
        json(201, { ok: true });
        return;
      }
      if (req.method === "GET" && /\/events\/wait$/.test(url.pathname)) {
        const name = url.searchParams.get("name") ?? "";
        const event = this.events.get(name);
        if (event) {
          json(200, { name, payload: event.payload, fromRole: event.fromRole });
        } else {
          json(408, { message: `Vai chờ sự kiện '${name}' quá hạn` });
        }
        return;
      }
      if (req.method === "POST" && /\/steps$/.test(url.pathname)) {
        this.steps.push(body);
        json(201, { ok: true });
        return;
      }
      if (req.method === "POST" && /\/entities$/.test(url.pathname)) {
        this.entities.push(body);
        json(201, { ok: true });
        return;
      }
      if (req.method === "POST" && /\/finished$/.test(url.pathname)) {
        this.finished = body;
        for (const waiter of this.finishedWaiters) waiter();
        json(200, { ok: true });
        return;
      }
      json(200, { ok: true });
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  waitFinished(): Promise<void> {
    if (this.finished) return Promise.resolve();
    return new Promise((resolve) => this.finishedWaiters.push(resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

describe("Runner server - API phien (S3.1, S3.2)", () => {
  const factory = new FakeSessionFactory();
  factory.setupDriver = (driver) => setupCrm(driver);
  const gateway = new StreamGateway();
  const displayStub: DisplayHandle = {
    display: ":91",
    displayNumber: 91,
    vncPort: 5901,
    stop: async () => undefined,
  };
  const server = createRunnerServer({
    factory,
    xvnc: { start: async () => displayStub },
    gateway,
    log: () => undefined,
  });
  const orchestrator = new FakeOrchestrator();
  let base = "";

  beforeAll(async () => {
    await orchestrator.start();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await orchestrator.stop();
  });

  it("tao phien -> chay ke hoach -> bao ket qua ve orchestrator, co dang ky stream khi o che do xem", async () => {
    // Phien co stream: gateway phai co dang ky va /streams thay duoc.
    const createRes = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "AUTOTEST_20261107_777",
        roleId: "benh-nhan",
        mode: "xem",
        targetBaseUrl: "https://uat.example.invalid",
        username: "bn@example.invalid",
        password: "mat-khau-gia",
        artifactsDir: "/tmp/autotest-artifacts",
        stream: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      sessionId: string;
      stream: { vncPort: number; wsPath: string } | null;
    };
    expect(created.stream?.vncPort).toBe(5901);
    expect(created.stream?.wsPath).toBe(`/stream/${created.sessionId}`);
    expect(gateway.has(created.sessionId)).toBe(true);

    const execRes = await fetch(`${base}/sessions/${created.sessionId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orchestratorUrl: orchestrator.url,
        steps: [
          { stepId: "dang-nhap", actionId: "dang-nhap", emitEvent: "san-sang" },
          {
            stepId: "dat-lich",
            actionId: "dat-lich-hen",
            waitEvent: "san-sang",
            data: { "benhNhan.hoTen": "A", "benhNhan.soDienThoai": "0112" },
          },
        ],
      }),
    });
    expect(execRes.status).toBe(202);
    await orchestrator.waitFinished();
    const finished = orchestrator.finished as { status: string; steps: unknown[] };
    expect(finished.status).toBe("qua");
    expect(orchestrator.steps).toHaveLength(2);
    expect(orchestrator.entities).toHaveLength(1);

    const stateRes = await fetch(`${base}/sessions/${created.sessionId}`);
    const state = (await stateRes.json()) as { state: string };
    expect(state.state).toBe("xong");
    // Phien xong thi huy dang ky stream.
    expect(gateway.has(created.sessionId)).toBe(false);
  });

  it("dong phien bang DELETE thi browser duoc dong sach", async () => {
    const createRes = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "AUTOTEST_20261107_778",
        roleId: "le-tan",
        mode: "nhanh",
        targetBaseUrl: "https://uat.example.invalid",
        username: "lt@example.invalid",
        password: "mat-khau-gia",
        artifactsDir: "/tmp/autotest-artifacts",
        stream: false,
      }),
    });
    const created = (await createRes.json()) as { sessionId: string; stream: null };
    expect(created.stream).toBeNull();
    const before = factory.openCount;
    const delRes = await fetch(`${base}/sessions/${created.sessionId}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    expect(factory.openCount).toBe(before - 1);
  });

  it("yeu cau tao phien thieu truong thi bi tu choi 400", async () => {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "X" }),
    });
    expect(res.status).toBe(400);
  });
});
