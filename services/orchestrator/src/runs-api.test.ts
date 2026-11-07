import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryRunRepository, RunService } from "./run-store.js";
import { createOrchestratorServer } from "./server.js";
import { makeTestConfig } from "./testing.js";

describe("API lan chay (S1.3 AC-2, AC-4 + cong chan S1.2)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createOrchestratorServer({
      config: makeTestConfig(),
      runService: new RunService(new InMemoryRunRepository()),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("POST /api/runs tao lan chay 201 voi run_id dung dinh dang", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "doanh-thu", mode: "xem-truc-tiep" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string; resultLabel: string; modeLabel: string };
    expect(body.runId).toMatch(/^AUTOTEST_\d{8}_\d{3}$/);
    expect(body.resultLabel).toBe("Đang chạy");
    expect(body.modeLabel).toBe("Xem trực tiếp");
  });

  it("URL production van bi chan 403 ke ca khi da co kho lan chay", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "doanh-thu",
        targetUrl: "https://crm.phongkham-that.vn",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("ghi buoc, ket thuc, liet ke va loc theo ket qua", async () => {
    const create = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "check-in", mode: "chay-nhanh" }),
    });
    const { runId } = (await create.json()) as { runId: string };

    const step = await fetch(`${baseUrl}/api/runs/${runId}/steps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stepId: "quet-qr",
        name: "Quét QR check-in",
        status: "qua",
        durationMs: 800,
      }),
    });
    expect(step.status).toBe(201);

    const finish = await fetch(`${baseUrl}/api/runs/${runId}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result: "qua", reportPath: "runs/bao-cao.md" }),
    });
    expect(finish.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/runs/${runId}`);
    const detailBody = (await detail.json()) as {
      resultLabel: string;
      steps: Array<{ stepId: string }>;
    };
    expect(detailBody.resultLabel).toBe("Qua");
    expect(detailBody.steps).toHaveLength(1);

    const listQua = await fetch(`${baseUrl}/api/runs?result=qua`);
    const listQuaBody = (await listQua.json()) as { runs: Array<{ runId: string }> };
    expect(listQuaBody.runs.some((r) => r.runId === runId)).toBe(true);

    const listHong = await fetch(`${baseUrl}/api/runs?result=hong`);
    const listHongBody = (await listHong.json()) as { runs: Array<{ runId: string }> };
    expect(listHongBody.runs.some((r) => r.runId === runId)).toBe(false);

    const listScenario = await fetch(`${baseUrl}/api/runs?scenarioId=check-in`);
    const listScenarioBody = (await listScenario.json()) as { runs: Array<{ runId: string }> };
    expect(listScenarioBody.runs.some((r) => r.runId === runId)).toBe(true);
  });
});
