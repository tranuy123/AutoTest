/**
 * Test S5.6: trang nhat ky lan chay (luu log theo run + xem/tai log).
 * - Executor gia lap chay xong -> GET /api/runs/:id/logs dung thu tu
 *   seq, dung run, co entry theo vai/buoc; run chua chay -> rong;
 *   run la -> 404 kem message tieng Viet.
 * - GET .../logs.txt dung dinh dang gui ho tro (header + dong
 *   "HH:mm:ss | vai | buoc | LEVEL | message").
 * - Quet ro ri DAU-CUOI: entry chua SDT/mat khau dang khoa=gia-tri
 *   phai bi redact TRUOC khi luu - khong xuat hien o ca JSON lan .txt;
 *   toan than phan hoi cua lan chay that khong chua mat khau cau hinh.
 * - Gioi han cat 5.000 entry/lan chay hoat dong (entry canh bao + co).
 */
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRunLogger } from "./run-logger.js";
import {
  buildRunLogText,
  InMemoryRunLogRepository,
  MAX_RUN_LOG_ENTRIES,
  RunLogService,
  type StoredRunLogEntry,
} from "./run-log-store.js";
import { createOrchestratorServer, type OrchestratorDeps } from "./server.js";
import { makeExecutionStack, type ExecutionStack } from "./testing.js";

async function bootServer(deps: OrchestratorDeps): Promise<{ server: Server; baseUrl: string }> {
  const server = createOrchestratorServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

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

interface LogsBody {
  runId: string;
  scenarioId: string;
  truncated: boolean;
  entries: Array<{
    seq: number;
    ts: string;
    roleId?: string;
    stepId?: string;
    level: string;
    event: string;
    message: string;
  }>;
}

describe("API nhat ky lan chay — executor gia lap + GET logs/logs.txt (S5.6)", () => {
  let stack: ExecutionStack;
  let server: Server;
  let baseUrl: string;
  let runId: string;
  let scenarioId: string;

  beforeAll(async () => {
    stack = await makeExecutionStack();
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    scenarioId = parsed.scenario.id;
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });
    ({ server, baseUrl } = await bootServer({
      config: stack.config,
      runService: stack.runService,
      runLogService: stack.runLogService,
    }));
    const run = await stack.runService.createRun({
      scenarioId,
      mode: "chay-nhanh",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    runId = run.runId;
    await stack.executor.startRun(runId);
    await stack.runLogService.flush();
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("GET logs: dung run, seq tang dan tu 1, co entry run_finished + theo vai/buoc", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}/logs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LogsBody;
    expect(body.runId).toBe(runId);
    expect(body.scenarioId).toBe(scenarioId);
    expect(body.truncated).toBe(false);
    expect(body.entries.length).toBeGreaterThan(0);
    body.entries.forEach((entry, index) => {
      expect(entry.seq).toBe(index + 1);
    });
    const finished = body.entries.find((e) => e.event === "run_finished");
    expect(finished?.level).toBe("info");
    expect(finished?.message).toContain("Kết quả");
    const roleFinished = body.entries.find(
      (e) => e.event === "role_finished" && e.roleId === "le-tan",
    );
    expect(roleFinished).toBeDefined();
    const roleStep = body.entries.find((e) => e.event === "role_step" && e.roleId);
    expect(roleStep?.stepId).toBeTruthy();
  });

  it("GET logs: quet ro ri toan than — khong chua mat khau cau hinh cua cac vai", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}/logs`);
    const text = await res.text();
    expect(text).not.toContain("mat-khau-gia-test");
    expect(text).not.toContain('"password":');
  });

  it("GET logs.txt: header co run_id + kich ban, dong dung dinh dang cot", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}/logs.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toContain(runId);
    expect(lines[1]).toContain(scenarioId);
    expect(text).toMatch(/^\d{2}:\d{2}:\d{2} \| /m);
    expect(text).not.toContain("mat-khau-gia-test");
  });

  it("run ton tai nhung chua chay -> entries rong, truncated=false", async () => {
    const runMoi = await stack.runService.createRun({
      scenarioId,
      mode: "chay-nhanh",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    const res = await fetch(`${baseUrl}/api/runs/${runMoi.runId}/logs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LogsBody;
    expect(body.entries).toEqual([]);
    expect(body.truncated).toBe(false);
    const resTxt = await fetch(`${baseUrl}/api/runs/${runMoi.runId}/logs.txt`);
    expect(resTxt.status).toBe(200);
    expect(await resTxt.text()).toContain(runMoi.runId);
  });

  it("run la -> 404 kem message tieng Viet o ca hai dinh dang", async () => {
    const res = await fetch(`${baseUrl}/api/runs/AUTOTEST_19990101_999/logs`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("Không tìm thấy lần chạy");
    const resTxt = await fetch(`${baseUrl}/api/runs/AUTOTEST_19990101_999/logs.txt`);
    expect(resTxt.status).toBe(404);
  });

  it("chua noi kho nhat ky -> 501", async () => {
    const { server: serverLo, baseUrl: baseLo } = await bootServer({
      config: stack.config,
      runService: stack.runService,
    });
    try {
      const res = await fetch(`${baseLo}/api/runs/${runId}/logs`);
      expect(res.status).toBe(501);
    } finally {
      await closeServer(serverLo);
    }
  });
});

describe("RunLogService — sanitize truoc khi luu + gioi han cat (S5.6)", () => {
  it("entry chua SDT/mat khau/email bi redact truoc khi luu — sach o ca list lan .txt", async () => {
    const service = new RunLogService(new InMemoryRunLogRepository());
    await service.capture({
      event: "role_step",
      runId: "RUN-LEAK-1",
      roleId: "le-tan",
      stepId: "b1",
      errorMessage:
        "Lỗi gửi tới 0901234567, password=mat-khau-bi-mat, email a.b@example.com",
    });
    const { entries } = await service.list("RUN-LEAK-1");
    expect(entries).toHaveLength(1);
    const entry = entries[0] as StoredRunLogEntry;
    expect(entry.level).toBe("error");
    const json = JSON.stringify(entries);
    const txt = buildRunLogText({ runId: "RUN-LEAK-1", entries, truncated: false });
    for (const surface of [json, txt]) {
      expect(surface).not.toContain("0901234567");
      expect(surface).not.toContain("mat-khau-bi-mat");
      expect(surface).not.toContain("a.b@example.com");
    }
    expect(entry.message).toContain("[da-che]");
  });

  it("duong sink cua createRunLogger (server) cung chi luu ban da sanitize", async () => {
    const service = new RunLogService(new InMemoryRunLogRepository());
    const logger = createRunLogger((line) => service.captureSanitizedLine(line));
    logger.log({
      event: "run_step",
      runId: "RUN-LEAK-2",
      stepId: "nhac-hen",
      errorCode: "GUI_THAT_BAI",
      errorMessage: "Không gửi được tới 0912345678, token: bi-mat-ne",
    });
    await service.flush();
    const { entries } = await service.list("RUN-LEAK-2");
    expect(entries).toHaveLength(1);
    const json = JSON.stringify(entries);
    expect(json).not.toContain("0912345678");
    expect(json).not.toContain("bi-mat-ne");
    expect(entries[0]?.event).toBe("run_step");
    expect(entries[0]?.level).toBe("error");
  });

  it("entry khong co runId bi bo qua, khong ghi vao bat ky lan chay nao", async () => {
    const service = new RunLogService(new InMemoryRunLogRepository());
    await service.capture({ event: "settings_updated" });
    const { entries } = await service.list("RUN-LEAK-1");
    expect(entries).toEqual([]);
  });

  it(`vuot ${MAX_RUN_LOG_ENTRIES} entry: cat dung cho, entry cuoi la canh bao, co truncated bat`, async () => {
    const service = new RunLogService(new InMemoryRunLogRepository());
    for (let i = 0; i < MAX_RUN_LOG_ENTRIES + 5; i++) {
      await service.capture({
        event: "role_step",
        runId: "RUN-CAP",
        stepId: `s${i}`,
        result: "qua",
      });
    }
    const { entries, truncated } = await service.list("RUN-CAP");
    expect(truncated).toBe(true);
    expect(entries).toHaveLength(MAX_RUN_LOG_ENTRIES + 1);
    expect(entries[MAX_RUN_LOG_ENTRIES - 1]?.seq).toBe(MAX_RUN_LOG_ENTRIES);
    const canhBao = entries[entries.length - 1];
    expect(canhBao?.event).toBe("run_log_truncated");
    expect(canhBao?.level).toBe("warn");
  });
});
