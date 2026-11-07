/**
 * Kho lan chay (S1.3) - DB noi bo cua AutoTest.
 * Moi truy cap du lieu deu qua giao dien RunRepository (Dev Notes S1.3):
 * doi cong nghe luu tru chi sua o file nay.
 * - PgRunRepository: PostgreSQL that (migration trong thu muc migrations/).
 * - InMemoryRunRepository: dung cho test va che do khong co DB.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { buildRunId, formatRunDay } from "./run-id.js";

export type RunStatus = "dang-cho" | "dang-chay" | "qua" | "hong" | "dung";
export type RunResult = "qua" | "hong" | "dung";
/** Trang thai don du lieu cua lan chay (S2.4): null = chua don/chua chay don. */
export type CleanupStatus = "sach" | "chua-sach";

export interface RunRecord {
  runId: string;
  scenarioId: string;
  mode: string;
  targetUrl: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  videoPath: string | null;
  reportPath: string | null;
  cleanupStatus: CleanupStatus | null;
}

export interface RunStepRecord {
  runId: string;
  stepId: string;
  name: string;
  status: string;
  durationMs: number | null;
  errorCode: string | null;
}

export interface RunFilter {
  scenarioId?: string;
  status?: RunStatus;
}

export interface RunRepository {
  /** Ap dung migration chua chay (idempotent). */
  init(): Promise<void>;
  /** Tang va tra so thu tu cua ngay - phai nguyen tu/duy nhat khi song song. */
  nextRunSequence(day: string): Promise<number>;
  insertRun(run: RunRecord): Promise<void>;
  updateRun(
    runId: string,
    patch: Partial<
      Pick<RunRecord, "status" | "finishedAt" | "videoPath" | "reportPath" | "cleanupStatus">
    >,
  ): Promise<void>;
  insertStep(step: RunStepRecord): Promise<void>;
  listSteps(runId: string): Promise<RunStepRecord[]>;
  listRuns(filter: RunFilter): Promise<RunRecord[]>;
  getRun(runId: string): Promise<RunRecord | null>;
  close(): Promise<void>;
}

/* ------------------------- PostgreSQL ------------------------- */

interface RunRow {
  run_id: string;
  scenario_id: string;
  mode: string;
  target_url: string;
  status: RunStatus;
  started_at: Date;
  finished_at: Date | null;
  video_path: string | null;
  report_path: string | null;
  cleanup_status: CleanupStatus | null;
}

interface StepRow {
  run_id: string;
  step_id: string;
  name: string;
  status: string;
  duration_ms: number | null;
  error_code: string | null;
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    scenarioId: row.scenario_id,
    mode: row.mode,
    targetUrl: row.target_url,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    videoPath: row.video_path,
    reportPath: row.report_path,
    cleanupStatus: row.cleanup_status ?? null,
  };
}

export class PgRunRepository implements RunRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const existing = await this.pool.query(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (existing.rowCount && existing.rowCount > 0) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async nextRunSequence(day: string): Promise<number> {
    const result = await this.pool.query<{ seq: number }>(
      `INSERT INTO run_counters (day, seq) VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE SET seq = run_counters.seq + 1
       RETURNING seq`,
      [day],
    );
    return result.rows[0]?.seq ?? 1;
  }

  async insertRun(run: RunRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO runs (run_id, scenario_id, mode, target_url, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [run.runId, run.scenarioId, run.mode, run.targetUrl, run.status, run.startedAt],
    );
  }

  async updateRun(
    runId: string,
    patch: Partial<
      Pick<RunRecord, "status" | "finishedAt" | "videoPath" | "reportPath" | "cleanupStatus">
    >,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE runs SET
         status = COALESCE($2, status),
         finished_at = COALESCE($3, finished_at),
         video_path = COALESCE($4, video_path),
         report_path = COALESCE($5, report_path),
         cleanup_status = COALESCE($6, cleanup_status)
       WHERE run_id = $1`,
      [
        runId,
        patch.status ?? null,
        patch.finishedAt ?? null,
        patch.videoPath ?? null,
        patch.reportPath ?? null,
        patch.cleanupStatus ?? null,
      ],
    );
  }

  async insertStep(step: RunStepRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_steps (run_id, step_id, name, status, duration_ms, error_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id, step_id) DO UPDATE SET
         name = EXCLUDED.name, status = EXCLUDED.status,
         duration_ms = EXCLUDED.duration_ms, error_code = EXCLUDED.error_code`,
      [step.runId, step.stepId, step.name, step.status, step.durationMs, step.errorCode],
    );
  }

  async listSteps(runId: string): Promise<RunStepRecord[]> {
    const result = await this.pool.query<StepRow>(
      "SELECT * FROM run_steps WHERE run_id = $1 ORDER BY created_at, step_id",
      [runId],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      stepId: row.step_id,
      name: row.name,
      status: row.status,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
    }));
  }

  async listRuns(filter: RunFilter): Promise<RunRecord[]> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM runs
       WHERE ($1::text IS NULL OR scenario_id = $1)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY started_at DESC, run_id DESC`,
      [filter.scenarioId ?? null, filter.status ?? null],
    );
    return result.rows.map(toRunRecord);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<RunRow>("SELECT * FROM runs WHERE run_id = $1", [
      runId,
    ]);
    return result.rows[0] ? toRunRecord(result.rows[0]) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* ------------------------- In-memory ------------------------- */

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();
  private readonly steps = new Map<string, RunStepRecord[]>();
  private readonly counters = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    // Khong co migration - kho nho tam.
  }

  nextRunSequence(day: string): Promise<number> {
    // Khoa bang hang doi promise de cac luot song song khong trung so.
    const task = this.chain.then(() => {
      const next = (this.counters.get(day) ?? 0) + 1;
      this.counters.set(day, next);
      return next;
    });
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async insertRun(run: RunRecord): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async updateRun(
    runId: string,
    patch: Partial<
      Pick<RunRecord, "status" | "finishedAt" | "videoPath" | "reportPath" | "cleanupStatus">
    >,
  ): Promise<void> {
    const current = this.runs.get(runId);
    if (!current) return;
    this.runs.set(runId, {
      ...current,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      ...(patch.videoPath !== undefined ? { videoPath: patch.videoPath } : {}),
      ...(patch.reportPath !== undefined ? { reportPath: patch.reportPath } : {}),
      ...(patch.cleanupStatus !== undefined ? { cleanupStatus: patch.cleanupStatus } : {}),
    });
  }

  async insertStep(step: RunStepRecord): Promise<void> {
    const list = this.steps.get(step.runId) ?? [];
    const index = list.findIndex((s) => s.stepId === step.stepId);
    if (index >= 0) list[index] = { ...step };
    else list.push({ ...step });
    this.steps.set(step.runId, list);
  }

  async listSteps(runId: string): Promise<RunStepRecord[]> {
    return [...(this.steps.get(runId) ?? [])];
  }

  async listRuns(filter: RunFilter): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => !filter.scenarioId || run.scenarioId === filter.scenarioId)
      .filter((run) => !filter.status || run.status === filter.status)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId))
      .map((run) => ({ ...run }));
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  async close(): Promise<void> {
    // Khong co tai nguyen can dong.
  }
}

/* ------------------------- Service ------------------------- */

export class RunService {
  constructor(private readonly repo: RunRepository) {}

  async createRun(input: {
    scenarioId: string;
    mode: string;
    targetUrl: string;
    /** Trang thai khoi tao: mac dinh "dang-chay"; giao dien S2.2 dung "dang-cho" (hang doi, Epic 3 moi thuc thi). */
    status?: RunStatus;
  }): Promise<RunRecord> {
    const now = new Date();
    const day = formatRunDay(now);
    const sequence = await this.repo.nextRunSequence(day);
    const run: RunRecord = {
      runId: buildRunId(day, sequence),
      scenarioId: input.scenarioId,
      mode: input.mode,
      targetUrl: input.targetUrl,
      status: input.status ?? "dang-chay",
      startedAt: now.toISOString(),
      finishedAt: null,
      videoPath: null,
      reportPath: null,
      cleanupStatus: null,
    };
    await this.repo.insertRun(run);
    return run;
  }

  async recordStep(step: RunStepRecord): Promise<void> {
    await this.repo.insertStep(step);
  }

  /** Chuyen lan chay tu trang thai cho sang dang chay khi executor bat dau (Epic 3). */
  async markRunning(runId: string): Promise<void> {
    await this.repo.updateRun(runId, { status: "dang-chay" });
  }

  /** Cap nhat trang thai don du lieu sau buoc don cua lan chay (S2.4). */
  async updateCleanupStatus(runId: string, cleanupStatus: CleanupStatus): Promise<void> {
    await this.repo.updateRun(runId, { cleanupStatus });
  }

  async finishRun(
    runId: string,
    result: RunResult,
    paths: { videoPath?: string; reportPath?: string } = {},
  ): Promise<void> {
    await this.repo.updateRun(runId, {
      status: result,
      finishedAt: new Date().toISOString(),
      ...(paths.videoPath !== undefined ? { videoPath: paths.videoPath } : {}),
      ...(paths.reportPath !== undefined ? { reportPath: paths.reportPath } : {}),
    });
  }

  async listRuns(filter: RunFilter): Promise<RunRecord[]> {
    return this.repo.listRuns(filter);
  }

  async getRunWithSteps(
    runId: string,
  ): Promise<{ run: RunRecord; steps: RunStepRecord[] } | null> {
    const run = await this.repo.getRun(runId);
    if (!run) return null;
    return { run, steps: await this.repo.listSteps(runId) };
  }
}

export const RUN_RESULT_LABELS: Record<RunStatus, string> = {
  "dang-cho": "Đang chờ chạy",
  "dang-chay": "Đang chạy",
  qua: "Qua",
  hong: "Hỏng",
  dung: "Đã dừng",
};

export const RUN_MODE_LABELS: Record<string, string> = {
  "xem-truc-tiep": "Xem trực tiếp",
  "chay-nhanh": "Chạy nhanh",
};
