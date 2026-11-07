import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { describe, expect, it } from "vitest";

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

async function seedSampleScenario(stack: Awaited<ReturnType<typeof makeExecutionStack>>) {
  const yaml = await readFile(SAMPLE_YAML, "utf8");
  const parsed = parseScenarioYaml(yaml);
  if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
  await stack.scenarioService.importScenario({
    filename: "dat-lich-den-bao-cao.yaml",
    format: "yaml",
    contentText: yaml,
  });
  return parsed.scenario;
}

async function waitBatchDone(
  stack: Awaited<ReturnType<typeof makeExecutionStack>>,
  batchId: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const summary = await stack.batchService.summary(batchId);
    if (summary && summary.dangChay === 0) return summary;
    if (Date.now() > deadline) throw new Error(`Đợt ${batchId} không hoàn tất sau ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("S3.4 — đợt chạy nhanh song song", () => {
  it("AC-2/AC-4: 4 lần chạy song song, run_id riêng, dữ liệu cách ly; báo cáo tổng đúng", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    const created: Array<{ mode: string; stream: boolean }> = [];
    const original = stack.worker.createSession.bind(stack.worker);
    stack.worker.createSession = async (req) => {
      created.push({ mode: req.mode, stream: req.stream });
      return original(req);
    };

    const batch = await stack.batchService.startBatch({
      scenarioId: scenario.id,
      targetUrl: "https://uat.example.invalid",
      count: 4,
    });
    expect(new Set(batch.runIds).size).toBe(4);

    const summary = await waitBatchDone(stack, batch.batchId);
    expect(summary.total).toBe(4);
    expect(summary.qua).toBe(4);
    expect(summary.hong).toBe(0);
    expect(summary.theoKichBan).toEqual([
      { scenarioId: scenario.id, total: 4, qua: 4, hong: 0 },
    ]);
    for (const run of summary.runs) {
      expect(run.detailUrl).toBe(`/api/runs/${run.runId}`);
      expect(run.cleanupStatus).toBe("sach");
    }

    // Che do nhanh: session mode nhanh, khong stream (AC-1).
    expect(created.length).toBe(4 * scenario.cacVai.length);
    expect(created.every((c) => c.mode === "nhanh" && !c.stream)).toBe(true);

    // Cach ly du lieu: moi lan chay co input rieng va khac nhau.
    const inputs = await Promise.all(
      batch.runIds.map((runId) => stack.dataService.getRunInput(runId)),
    );
    expect(inputs.every((i) => i !== null)).toBe(true);
    const patientIds = new Set(inputs.flatMap((i) => i?.data.benhNhan.map((b) => b.id) ?? []));
    expect(patientIds.size).toBe(batch.runIds.length * 2);

    // AC-3: lan chay QUA -> video bi xoa (khong giu mac dinh).
    for (const runId of batch.runIds) {
      const detail = await stack.runService.getRunWithSteps(runId);
      expect(detail?.run.videoPath).toBeNull();
    }
  });

  it("AC-3/AC-4: lần chạy HỎNG giữ video + hiện trong báo cáo tổng là hỏng", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    // Lam hong buoc dat lich o moi lan chay cua dot.
    stack.worker.failStepIds.add("dat-lich");
    const batch = await stack.batchService.startBatch({
      scenarioId: scenario.id,
      targetUrl: "https://uat.example.invalid",
      count: 2,
    });
    const summary = await waitBatchDone(stack, batch.batchId);
    expect(summary.hong).toBe(2);
    expect(summary.qua).toBe(0);
    for (const run of summary.runs) {
      const detail = await stack.runService.getRunWithSteps(run.runId);
      // Chinh sach video: lan hong GIU duong dan video (executor khong
      // xoa). File video vat ly do worker that ghi - nghiem thu tren may
      // that (sandbox VM chan ghi file tu tien trinh test).
      expect(detail?.run.videoPath).not.toBeNull();
      expect(detail?.run.videoPath).toContain(run.runId);
      expect(detail?.run.videoPath).toContain("video");
    }
  });
});
