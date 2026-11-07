/**
 * Test S5.3 - cong kiem tra sandbox kenh ngoai.
 * AC-4: dich gia lap qua HTTP that o 3 trang thai: sandbox bat -> chay,
 * sandbox tat -> chan, khong tra loi -> chan (fail-closed).
 */
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { docCoSandboxTuHealth, probeSandbox, SandboxGate } from "./sandbox-gate.js";
import { makeExecutionStack } from "./testing.js";

const servers: Server[] = [];

async function startFakeTarget(handler: (url: string) => { status: number; body: unknown }): Promise<string> {
  const server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("khong lay duoc cong server gia lap");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("probeSandbox - doc co sandbox tu health/cau hinh", () => {
  it("docCoSandboxTuHealth: khoa phang, khoa long nhau, khong co co", () => {
    expect(docCoSandboxTuHealth({ sandbox: true })).toBe(true);
    expect(docCoSandboxTuHealth({ kenhNgoaiSandbox: false })).toBe(false);
    expect(docCoSandboxTuHealth({ channelsSandbox: true })).toBe(true);
    expect(docCoSandboxTuHealth({ kenhNgoai: { sandbox: false } })).toBe(false);
    expect(docCoSandboxTuHealth({ status: "ok" })).toBeNull();
    expect(docCoSandboxTuHealth(null)).toBeNull();
    expect(docCoSandboxTuHealth("sandbox")).toBeNull();
  });

  it("AC-4 trang thai 1: health bao sandbox=true -> cho chay", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { status: "ok", sandbox: true } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: null, healthPath: "/api/health" });
    expect(r.outcome).toBe("sandbox");
    expect(r.signals.some((s) => s.includes("sandbox=true"))).toBe(true);
  });

  it("AC-4 trang thai 2: health bao sandbox=false -> chan", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { sandbox: false } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: true, healthPath: "/api/health" });
    expect(r.outcome).toBe("khong-sandbox");
    expect(r.reason).toContain("fail-closed");
  });

  it("AC-4 trang thai 3: dich khong tra loi + cau hinh chua khai bao -> chan", async () => {
    // Cong 1 tren localhost gan nhu chac chan khong co server nghe.
    const r = await probeSandbox("http://127.0.0.1:1", {
      channelsSandboxConfig: null,
      healthPath: "/api/health",
      timeoutMs: 500,
    });
    expect(r.outcome).toBe("khong-xac-dinh");
    expect(r.signals.some((s) => s.includes("không trả lời"))).toBe(true);
  });

  it("health khong co co + CHANNELS_SANDBOX=true -> cho chay bang tin hieu cau hinh", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { status: "ok" } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: true, healthPath: "/api/health" });
    expect(r.outcome).toBe("sandbox");
    expect(r.reason).toContain("CHANNELS_SANDBOX=true");
  });

  it("health khong co co + cau hinh chua khai bao -> chan (khong xac dinh duoc)", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { status: "ok" } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: null, healthPath: "/api/health" });
    expect(r.outcome).toBe("khong-xac-dinh");
  });

  it("cau hinh CHANNELS_SANDBOX=false -> chan ke ca khi health noi sandbox", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { sandbox: true } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: false, healthPath: "/api/health" });
    expect(r.outcome).toBe("khong-sandbox");
  });

  it("health tra HTTP 500 + khong tin hieu cau hinh -> chan", async () => {
    const url = await startFakeTarget(() => ({ status: 500, body: { error: "boom" } }));
    const r = await probeSandbox(url, { channelsSandboxConfig: null, healthPath: "/api/health" });
    expect(r.outcome).toBe("khong-xac-dinh");
    expect(r.signals.some((s) => s.includes("HTTP 500"))).toBe(true);
  });
});

const YAML_CO_KENH_NGOAI = `schemaVersion: 2
id: nhac-hen-zalo
ten: Nhắc hẹn qua Zalo
kenhNgoai: [zalo]
cacVai: [le-tan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
`;

const YAML_KHONG_KENH_NGOAI = `schemaVersion: 2
id: chi-dang-nhap
ten: Chỉ đăng nhập
cacVai: [le-tan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
`;

describe("SandboxGate + RunExecutor - cong truoc lan chay (AC-1/AC-2/AC-3)", () => {
  it("sandbox bat: lan chay chay binh thuong, buoc kiem-tra-sandbox QUA va co ban ghi (AC-3)", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { sandbox: true } }));
    const gate = new SandboxGate({ channelsSandboxConfig: null, healthPath: "/api/health" });
    const stack = await makeExecutionStack(
      { TARGET_BASE_URL: url, TARGET_ALLOWLIST: url },
      { sandboxGate: gate },
    );
    await stack.scenarioService.importScenario({
      filename: "nhac-hen-zalo.yaml",
      format: "yaml",
      contentText: YAML_CO_KENH_NGOAI,
    });
    const run = await stack.runService.createRun({
      scenarioId: "nhac-hen-zalo",
      mode: "chay-nhanh",
      targetUrl: url,
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("qua");
    expect(stack.worker.sessions.size).toBeGreaterThan(0);
    const step = detail?.steps.find((s) => s.stepId === "kiem-tra-sandbox");
    expect(step?.status).toBe("qua");
    const record = gate.getRecord(run.runId);
    expect(record?.outcome).toBe("sandbox");
    expect(record?.channels).toEqual(["zalo"]);
    expect(record?.checkedAt).toBeTruthy();
    expect(record?.signals.length).toBeGreaterThan(0);
  });

  it("sandbox tat: lan chay bi chan truoc khi cap phien, ly do ghi vao buoc kiem tra (AC-1/AC-3)", async () => {
    const url = await startFakeTarget(() => ({ status: 200, body: { sandbox: false } }));
    const gate = new SandboxGate({ channelsSandboxConfig: true, healthPath: "/api/health" });
    const stack = await makeExecutionStack(
      { TARGET_BASE_URL: url, TARGET_ALLOWLIST: url },
      { sandboxGate: gate },
    );
    await stack.scenarioService.importScenario({
      filename: "nhac-hen-zalo.yaml",
      format: "yaml",
      contentText: YAML_CO_KENH_NGOAI,
    });
    const run = await stack.runService.createRun({
      scenarioId: "nhac-hen-zalo",
      mode: "chay-nhanh",
      targetUrl: url,
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    // Khong mot phien worker nao duoc tao - chan truoc khi chay that.
    expect(stack.worker.sessions.size).toBe(0);
    const step = detail?.steps.find((s) => s.stepId === "kiem-tra-sandbox");
    expect(step?.status).toBe("hong");
    expect(step?.errorCode).toContain("sandbox");
    expect(gate.getRecord(run.runId)?.allowed).toBe(false);
  });

  it("dich khong tra loi + chua khai bao cau hinh: chan (AC-4 trang thai 3 o muc executor)", async () => {
    const gate = new SandboxGate({ channelsSandboxConfig: null, healthPath: "/api/health", timeoutMs: 500 });
    const stack = await makeExecutionStack(
      { TARGET_BASE_URL: "http://127.0.0.1:1", TARGET_ALLOWLIST: "http://127.0.0.1:1" },
      { sandboxGate: gate },
    );
    await stack.scenarioService.importScenario({
      filename: "nhac-hen-zalo.yaml",
      format: "yaml",
      contentText: YAML_CO_KENH_NGOAI,
    });
    const run = await stack.runService.createRun({
      scenarioId: "nhac-hen-zalo",
      mode: "chay-nhanh",
      targetUrl: "http://127.0.0.1:1",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    expect(stack.worker.sessions.size).toBe(0);
    expect(gate.getRecord(run.runId)?.outcome).toBe("khong-xac-dinh");
  });

  it("AC-2: kich ban KHONG khai bao kenh ngoai khong bi kiem tra nay chan", async () => {
    const gate = new SandboxGate({ channelsSandboxConfig: null, healthPath: "/api/health", timeoutMs: 500 });
    const stack = await makeExecutionStack(
      { TARGET_BASE_URL: "http://127.0.0.1:1", TARGET_ALLOWLIST: "http://127.0.0.1:1" },
      { sandboxGate: gate },
    );
    await stack.scenarioService.importScenario({
      filename: "chi-dang-nhap.yaml",
      format: "yaml",
      contentText: YAML_KHONG_KENH_NGOAI,
    });
    const run = await stack.runService.createRun({
      scenarioId: "chi-dang-nhap",
      mode: "chay-nhanh",
      targetUrl: "http://127.0.0.1:1",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("qua");
    expect(detail?.steps.some((s) => s.stepId === "kiem-tra-sandbox")).toBe(false);
    expect(gate.getRecord(run.runId)).toBeNull();
  });
});
