import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { afterEach, describe, expect, it } from "vitest";

import { createOrchestratorServer } from "./server.js";
import { makeExecutionStack } from "./testing.js";

const SAMPLE_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "scenario-schema",
  "samples",
  "dat-lich-den-bao-cao.yaml",
);

interface RunningServer {
  base: string;
  close: () => Promise<void>;
}

let running: RunningServer | null = null;

async function startServer(stack: Awaited<ReturnType<typeof makeExecutionStack>>) {
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
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  running = {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return running;
}

afterEach(async () => {
  await running?.close();
  running = null;
});

async function postJson(base: string, path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function pollRun(base: string, runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(`${base}/api/runs/${runId}`);
    const body = (await response.json()) as Record<string, unknown>;
    if (body.status === "qua" || body.status === "hong") return body;
    if (Date.now() > deadline) throw new Error(`Lần chạy ${runId} không kết thúc sau ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("API thực thi nhiều vai (Epic 3) + dọn (S2.4) + đợt (S3.4)", () => {
  it("luồng đầy đủ qua HTTP: tạo lần chạy → start → qua → streams/chi tiết có cleanup sạch", async () => {
    const stack = await makeExecutionStack();
    const { base } = await startServer(stack);
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    const scenario = parsed.scenario;
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });

    const create = await postJson(base, "/api/runs", {
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
    });
    expect(create.status).toBe(201);
    const runId = create.body.runId as string;

    const start = await postJson(base, `/api/runs/${runId}/start`, {});
    expect(start.status).toBe(202);

    const detail = await pollRun(base, runId);
    expect(detail.status).toBe("qua");
    expect(detail.cleanupStatus).toBe("sach");
    expect(detail.cleanup).not.toBeNull();

    // Luoi stream: 5 vai, che do xem -> fastMode=false, moi vai co stream info.
    const streamsResponse = await fetch(`${base}/api/runs/${runId}/streams`);
    const streams = (await streamsResponse.json()) as {
      fastMode: boolean;
      roles: Array<{ roleId: string; state: string; stream: { wsUrl: string | null } | null }>;
    };
    expect(streams.fastMode).toBe(false);
    expect(streams.roles).toHaveLength(5);
    expect(streams.roles.every((r) => r.state === "xong")).toBe(true);
    expect(streams.roles[0]?.stream?.wsUrl).toContain("/stream/");

    // Don thu cong qua API (S2.4 AC-4): idempotent, van sach.
    const cleanupAgain = await postJson(base, `/api/runs/${runId}/cleanup`, {});
    expect(cleanupAgain.status).toBe(200);
    expect(cleanupAgain.body.sach).toBe(true);
  });

  it("sự kiện nội bộ: phát rồi chờ qua HTTP; chờ quá hạn trả 408 nêu rõ ngữ cảnh", async () => {
    const stack = await makeExecutionStack();
    const { base } = await startServer(stack);
    const emit = await postJson(base, "/api/internal/runs/RUN_API/events", {
      name: "lich-da-dat",
      payload: { appointment_id: "LH-API-1" },
      fromRole: "benh-nhan",
    });
    expect(emit.status).toBe(201);
    const waited = await fetch(
      `${base}/api/internal/runs/RUN_API/events/wait?name=lich-da-dat&role=le-tan&timeoutMs=1000`,
    );
    expect(waited.status).toBe(200);
    const waitedBody = (await waited.json()) as { payload: { appointment_id: string } };
    expect(waitedBody.payload.appointment_id).toBe("LH-API-1");

    const timeout = await fetch(
      `${base}/api/internal/runs/RUN_API/events/wait?name=chua-bao-gio&role=bac-si&timeoutMs=1000&expectedFromRole=le-tan`,
    );
    expect(timeout.status).toBe(408);
    const timeoutBody = (await timeout.json()) as { message: string };
    expect(timeoutBody.message).toContain("bac-si");
    expect(timeoutBody.message).toContain("chua-bao-gio");
    expect(timeoutBody.message).toContain("le-tan");
  });

  it("đợt chạy nhanh qua API: tạo đợt → báo cáo tổng qua hết (S3.4 AC-4)", async () => {
    const stack = await makeExecutionStack();
    const { base } = await startServer(stack);
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    const scenario = parsed.scenario;
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });

    const create = await postJson(base, "/api/batches", {
      scenarioId: scenario.id,
      count: 3,
    });
    expect(create.status).toBe(201);
    const batchId = create.body.batchId as string;

    const deadline = Date.now() + 20_000;
    let summary: Record<string, unknown> | null = null;
    for (;;) {
      const response = await fetch(`${base}/api/batches/${batchId}`);
      summary = (await response.json()) as Record<string, unknown>;
      if (summary.dangChay === 0) break;
      if (Date.now() > deadline) throw new Error("Đợt không hoàn tất");
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(summary.total).toBe(3);
    expect(summary.qua).toBe(3);
    const runs = summary.runs as Array<{ detailUrl: string }>;
    expect(runs[0]?.detailUrl).toContain("/api/runs/");

    // Luoi stream cua lan chay nhanh: fastMode=true, khong co stream (S3.4 AC-1).
    const runId = (create.body.runIds as string[])[0] as string;
    const streamsResponse = await fetch(`${base}/api/runs/${runId}/streams`);
    const streams = (await streamsResponse.json()) as {
      fastMode: boolean;
      roles: Array<{ stream: unknown }>;
    };
    expect(streams.fastMode).toBe(true);
    expect(streams.roles.every((r) => r.stream === null)).toBe(true);
  });

  it("start trên đích ngoài allowlist: API báo chặn 403, không thực thi (AD-6)", async () => {
    const stack = await makeExecutionStack();
    const { base } = await startServer(stack);
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    const scenario = parsed.scenario;
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://production.example.invalid",
      status: "dang-cho",
    });
    const start = await postJson(base, `/api/runs/${run.runId}/start`, {});
    expect(start.status).toBe(403);
    expect(start.body.message).toBe("Không phải UAT — đã chặn");
  });
});
