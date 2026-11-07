/**
 * Test S5.2 - hang doi lan chay + dung an toan:
 * - AC-1: vuot gioi han lan chay dong thoi -> xep hang co vi tri;
 *   gioi han phien cau hinh duoc (test tai AC-4 dung chung).
 * - AC-2: Dung khi dang chay (trong an han va qua an han) va khi dang
 *   xep hang: chot "Da dung theo yeu cau", van chay buoc don, khong
 *   phien mo coi, phien bi dong ep phai ghi ro vao bao cao.
 * - AC-3: lan chay dang cho tu bat dau sau khi lan chay truoc ket thuc
 *   hoac bi dung.
 * - AC-4: tai gap doi gioi han phien: khong sap, khong mat trang thai.
 */
import { afterEach, describe, expect, it } from "vitest";

import { RunQueue } from "./run-executor.js";
import { createOrchestratorServer } from "./server.js";
import { makeExecutionStack } from "./testing.js";

const ONE_ROLE_YAML = `schemaVersion: 2
id: chi-dang-nhap
ten: Chỉ đăng nhập
cacVai: [le-tan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
`;

type Stack = Awaited<ReturnType<typeof makeExecutionStack>>;

async function seedScenario(stack: Stack) {
  await stack.scenarioService.importScenario({
    filename: "chi-dang-nhap.yaml",
    format: "yaml",
    contentText: ONE_ROLE_YAML,
  });
}

async function makeRun(stack: Stack) {
  const run = await stack.runService.createRun({
    scenarioId: "chi-dang-nhap",
    mode: "chay-nhanh",
    targetUrl: "https://uat.example.invalid",
    status: "dang-cho",
  });
  return run.runId;
}

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error("waitFor: quá hạn chờ điều kiện");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function runStatus(stack: Stack, runId: string) {
  const detail = await stack.runService.getRunWithSteps(runId);
  return detail?.run.status;
}

describe("S5.2 - RunQueue (AC-1)", () => {
  it("FIFO + vi tri hang doi + huy khoi hang", async () => {
    const queue = new RunQueue(1);
    await expect(queue.acquire("A")).resolves.toBe(true);
    const bPromise = queue.acquire("B");
    const cPromise = queue.acquire("C");
    expect(queue.position("B")).toBe(1);
    expect(queue.position("C")).toBe(2);
    expect(queue.snapshot().queued).toEqual([
      { runId: "B", position: 1 },
      { runId: "C", position: 2 },
    ]);
    expect(queue.cancel("C")).toBe(true);
    await expect(cPromise).resolves.toBe(false);
    expect(queue.position("C")).toBeNull();
    queue.release();
    await expect(bPromise).resolves.toBe(true);
    expect(queue.snapshot().activeCount).toBe(1);
    queue.release();
    expect(queue.snapshot().activeCount).toBe(0);
  });
});

describe("S5.2 - hang doi lan chay (AC-1/AC-3)", () => {
  it("lan chay vuot gioi han xep hang kem vi tri; lan truoc xong thi lan cho tu chay", async () => {
    const stack = await makeExecutionStack({}, { maxConcurrentRuns: 1 });
    await seedScenario(stack);
    stack.worker.holdSessions = true;
    const run1 = await makeRun(stack);
    const run2 = await makeRun(stack);

    const p1 = stack.executor.startRun(run1);
    await waitFor(() => stack.worker.sessions.size === 1);
    const p2 = stack.executor.startRun(run2);
    await waitFor(() => stack.executor.queuePosition(run2) === 1);
    expect(await runStatus(stack, run2)).toBe("dang-cho");

    stack.worker.releaseHolds();
    await p1;
    expect(await runStatus(stack, run1)).toBe("qua");
    // AC-3: run2 tu bat dau sau khi run1 giai phong slot.
    await p2;
    expect(await runStatus(stack, run2)).toBe("qua");
    expect(stack.executor.queuePosition(run2)).toBeNull();
  });
});

describe("S5.2 - dung an toan (AC-2)", () => {
  it("dung khi dang chay, phien bao ket qua trong an han: chot 'dung', van don, khong dong ep phien", async () => {
    const stack = await makeExecutionStack({}, { stopGraceMs: 5_000 });
    await seedScenario(stack);
    stack.worker.holdSessions = true;
    const runId = await makeRun(stack);

    const p = stack.executor.startRun(runId);
    await waitFor(() => stack.worker.sessions.size === 1);
    const sessionId = [...stack.worker.sessions.keys()][0]!;

    const outcome = stack.executor.requestStop(runId);
    expect(outcome).toEqual({ accepted: true, state: "dang-chay" });
    stack.worker.releaseHolds();
    await p;

    const detail = await stack.runService.getRunWithSteps(runId);
    expect(detail?.run.status).toBe("dung");
    // Buoc don du lieu van chay (AC-2) va bao cao don sach.
    const cleanup = stack.cleanupService.getReport(runId);
    expect(cleanup).not.toBeNull();
    expect(cleanup?.sach).toBe(true);
    // Khong phien nao bi dong ep: closeSession khong duoc goi.
    expect(stack.worker.closedSessionIds).not.toContain(sessionId);
    // Ho so ghi ro viec dung, 0 phien bi dong sau an han.
    expect(detail?.run.resultDetail?.stop?.forcedSessions).toBe(0);
    const stopStep = detail?.steps.find((s) => s.stepId === "dung-lan-chay");
    expect(stopStep?.status).toBe("bo-qua");
    // Dung lai lan da ket thuc -> khong chap nhan.
    expect(stack.executor.requestStop(runId).accepted).toBe(false);
  });

  it("dung khi dang chay, phien khong bao ket qua sau an han: dong phien va ghi ro vao bao cao", async () => {
    const stack = await makeExecutionStack({}, { stopGraceMs: 150 });
    await seedScenario(stack);
    stack.worker.holdSessions = true;
    const runId = await makeRun(stack);

    const p = stack.executor.startRun(runId);
    await waitFor(() => stack.worker.sessions.size === 1);
    const sessionId = [...stack.worker.sessions.keys()][0]!;

    expect(stack.executor.requestStop(runId).accepted).toBe(true);
    await p;

    const detail = await stack.runService.getRunWithSteps(runId);
    expect(detail?.run.status).toBe("dung");
    // Phien bi dong qua duong closeSession (DELETE cua worker).
    expect(stack.worker.closedSessionIds).toContain(sessionId);
    // Dev Notes: truong hop dong ep phai ghi ro vao bao cao.
    expect(detail?.run.resultDetail?.stop?.forcedSessions).toBe(1);
    expect(detail?.run.resultDetail?.stop?.note).toContain("ân hạn");
    const stopStep = detail?.steps.find((s) => s.stepId === "dung-lan-chay");
    expect(stopStep?.errorCode).toContain("ân hạn");
    // Van chay buoc don du lieu.
    expect(stack.cleanupService.getReport(runId)).not.toBeNull();
    stack.worker.releaseHolds();
  });

  it("dung khi dang xep hang: khong mo phien nao, van don du lieu, chot 'dung'", async () => {
    const stack = await makeExecutionStack({}, { maxConcurrentRuns: 1 });
    await seedScenario(stack);
    stack.worker.holdSessions = true;
    const run1 = await makeRun(stack);
    const run2 = await makeRun(stack);

    const p1 = stack.executor.startRun(run1);
    await waitFor(() => stack.worker.sessions.size === 1);
    const p2 = stack.executor.startRun(run2);
    await waitFor(() => stack.executor.queuePosition(run2) === 1);

    const outcome = stack.executor.requestStop(run2);
    expect(outcome).toEqual({ accepted: true, state: "dang-cho" });
    await p2;

    expect(await runStatus(stack, run2)).toBe("dung");
    // Chi co phien cua run1 - run2 chua he mo phien.
    expect(stack.worker.sessions.size).toBe(1);
    expect(stack.cleanupService.getReport(run2)).not.toBeNull();
    const detail2 = await stack.runService.getRunWithSteps(run2);
    expect(detail2?.run.resultDetail?.stop?.note).toContain("chờ phiên trống");

    stack.worker.releaseHolds();
    await p1;
    expect(await runStatus(stack, run1)).toBe("qua");
  });
});

describe("S5.2 - test tai (AC-4)", () => {
  it("so phien dong thoi gap doi gioi han: khong vuot gioi han, khong lan chay nao mat trang thai", async () => {
    const stack = await makeExecutionStack(
      {},
      { maxConcurrentRuns: 4, maxConcurrentSessions: 2 },
    );
    await seedScenario(stack);
    const runIds = [
      await makeRun(stack),
      await makeRun(stack),
      await makeRun(stack),
      await makeRun(stack),
    ];
    await Promise.all(runIds.map((id) => stack.executor.startRun(id)));
    // 4 lan chay x 1 vai = 4 yeu cau phien, gioi han 2: semaphore xep
    // hang tang phien, khong bao gio vuot 2 phien chay cung luc.
    expect(stack.worker.maxActiveSessions).toBe(2);
    for (const runId of runIds) {
      expect(await runStatus(stack, runId)).toBe("qua");
    }
    expect(stack.executor.queueSnapshot().activeCount).toBe(0);
  });
});

describe("S5.2 - API dung + hang doi", () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it("POST /stop + queuePosition trong chi tiet + GET /api/queue", async () => {
    const stack = await makeExecutionStack({}, { maxConcurrentRuns: 1 });
    await seedScenario(stack);
    stack.worker.holdSessions = true;
    const server = createOrchestratorServer({
      config: stack.config,
      runService: stack.runService,
      scenarioService: stack.scenarioService,
      dataService: stack.dataService,
      executor: stack.executor,
      bus: stack.bus,
      roleStatus: stack.roleStatus,
      registry: stack.registry,
      cleanupService: stack.cleanupService,
      batchService: stack.batchService,
      worker: stack.worker,
      streamGatewayWsUrl: "ws://localhost:3102",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = () =>
      new Promise<void>((resolve) => server.close(() => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const run1 = await makeRun(stack);
    const run2 = await makeRun(stack);
    await fetch(`${base}/api/runs/${run1}/start`, { method: "POST" });
    await waitFor(() => stack.worker.sessions.size === 1);
    await fetch(`${base}/api/runs/${run2}/start`, { method: "POST" });
    await waitFor(() => stack.executor.queuePosition(run2) === 1);

    const detail2 = (await (
      await fetch(`${base}/api/runs/${run2}`)
    ).json()) as { queuePosition: number | null; status: string };
    expect(detail2.queuePosition).toBe(1);
    expect(detail2.status).toBe("dang-cho");

    const queueRes = (await (await fetch(`${base}/api/queue`)).json()) as {
      queue: { queued: { runId: string; position: number }[] } | null;
    };
    expect(queueRes.queue?.queued).toEqual([{ runId: run2, position: 1 }]);

    const stopRes = await fetch(`${base}/api/runs/${run2}/stop`, { method: "POST" });
    expect(stopRes.status).toBe(202);
    const stopBody = (await stopRes.json()) as { state: string };
    expect(stopBody.state).toBe("dang-cho");
    await waitFor(async () => (await runStatus(stack, run2)) === "dung");

    // Dung lan nua khi da ket thuc -> 409.
    const stopAgain = await fetch(`${base}/api/runs/${run2}/stop`, { method: "POST" });
    expect(stopAgain.status).toBe(409);
    // Dung lan chay khong ton tai -> 404.
    const stopMissing = await fetch(`${base}/api/runs/AUTOTEST_19990101_999/stop`, {
      method: "POST",
    });
    expect(stopMissing.status).toBe(404);

    stack.worker.releaseHolds();
    await waitFor(async () => (await runStatus(stack, run1)) === "qua");
  });
});
