/**
 * Dot chay nhanh (S3.4): chay song song nhieu lan chay doc lap cua mot
 * kich ban (moi lan chay co run_id va du lieu sinh rieng - cach ly) va
 * tong hop bao cao dot: tong so, qua/hong theo tung kich ban, lien ket
 * toi chi tiet tung lan chay (AC-4).
 * Dot chi la lop dieu phoi tren RunExecutor - engine va file kich ban
 * dung chung voi che do xem (AD-8).
 */
import { formatRunDay } from "./run-id.js";
import type { RunExecutor } from "./run-executor.js";
import {
  RUN_RESULT_LABELS,
  type RunRecord,
  type RunService,
} from "./run-store.js";

export interface BatchRecord {
  batchId: string;
  scenarioId: string;
  targetUrl: string;
  runIds: string[];
  createdAt: string;
}

export interface BatchRunSummary {
  runId: string;
  status: RunRecord["status"];
  resultLabel: string;
  cleanupStatus: RunRecord["cleanupStatus"];
  detailUrl: string;
}

export interface BatchSummary {
  batch: BatchRecord;
  total: number;
  qua: number;
  hong: number;
  dung: number;
  dangChay: number;
  /** Gom theo kich ban (AC-4: qua/hong theo tung kich ban). */
  theoKichBan: Array<{ scenarioId: string; total: number; qua: number; hong: number }>;
  runs: BatchRunSummary[];
}

export interface BatchDeps {
  runService: RunService;
  executor: RunExecutor;
  /** So lan chay chay dong thoi trong dot (mac dinh 4 - S3.4 AC-2). */
  concurrency?: number;
}

export class BatchService {
  private readonly batches = new Map<string, BatchRecord>();
  private sequence = 0;

  constructor(private readonly deps: BatchDeps) {}

  /**
   * Tao dot va bat dau chay nen. Moi lan chay duoc tao rieng (run_id
   * khac nhau, du lieu sinh theo run_id nen cach ly - AC-2).
   */
  async startBatch(input: {
    scenarioId: string;
    targetUrl: string;
    count: number;
  }): Promise<BatchRecord> {
    const count = Math.max(1, Math.min(50, Math.floor(input.count)));
    this.sequence++;
    const batchId = `BATCH_${formatRunDay(new Date())}_${String(this.sequence).padStart(3, "0")}`;
    const runIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const run = await this.deps.runService.createRun({
        scenarioId: input.scenarioId,
        mode: "chay-nhanh",
        targetUrl: input.targetUrl,
        status: "dang-cho",
      });
      runIds.push(run.runId);
    }
    const batch: BatchRecord = {
      batchId,
      scenarioId: input.scenarioId,
      targetUrl: input.targetUrl,
      runIds,
      createdAt: new Date().toISOString(),
    };
    this.batches.set(batchId, batch);
    // Chay nen theo muc song song cua dot; loi cua mot lan chay khong
    // chan cac lan chay con lai (executor da tu ghi ket qua hong).
    void this.runBatch(batch).catch(() => undefined);
    return batch;
  }

  private async runBatch(batch: BatchRecord): Promise<void> {
    const concurrency = Math.max(1, this.deps.concurrency ?? 4);
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, batch.runIds.length) }, async () => {
      for (;;) {
        const current = index++;
        if (current >= batch.runIds.length) return;
        const runId = batch.runIds[current] as string;
        await this.deps.executor.startRun(runId).catch(() => undefined);
      }
    });
    await Promise.all(workers);
  }

  getBatch(batchId: string): BatchRecord | null {
    return this.batches.get(batchId) ?? null;
  }

  /** Bao cao tong cua dot (AC-4) - doc trang thai that tu kho lan chay. */
  async summary(batchId: string): Promise<BatchSummary | null> {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const runs: BatchRunSummary[] = [];
    for (const runId of batch.runIds) {
      const detail = await this.deps.runService.getRunWithSteps(runId);
      if (!detail) continue;
      runs.push({
        runId,
        status: detail.run.status,
        resultLabel: RUN_RESULT_LABELS[detail.run.status],
        cleanupStatus: detail.run.cleanupStatus,
        detailUrl: `/api/runs/${runId}`,
      });
    }
    const qua = runs.filter((r) => r.status === "qua").length;
    const hong = runs.filter((r) => r.status === "hong").length;
    const dung = runs.filter((r) => r.status === "dung").length;
    const dangChay = runs.filter(
      (r) => r.status === "dang-chay" || r.status === "dang-cho",
    ).length;
    return {
      batch,
      total: runs.length,
      qua,
      hong,
      dung,
      dangChay,
      theoKichBan: [
        { scenarioId: batch.scenarioId, total: runs.length, qua, hong },
      ],
      runs,
    };
  }
}
