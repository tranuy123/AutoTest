/**
 * Kho bo du lieu da sinh cua lan chay (S2.3 AC-3) + DataService.
 * Cung mau voi run-store/scenario-store: Pg + InMemory qua 1 giao dien.
 * DataService noi: kho lan chay (lay scenarioId) -> thu vien kich ban
 * (lay khoi sinhDuLieu) -> bo sinh du lieu -> luu kem lan chay.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  generateRunData,
  type BannedDataList,
  type GeneratedRunData,
} from "./data-generator.js";
import type { RunService } from "./run-store.js";
import type { ScenarioService } from "./scenario-store.js";

export interface RunInputRecord {
  runId: string;
  seed: string;
  data: GeneratedRunData;
  createdAt: string;
}

export interface RunDataRepository {
  init(): Promise<void>;
  saveRunInput(record: RunInputRecord): Promise<void>;
  getRunInput(runId: string): Promise<RunInputRecord | null>;
  close(): Promise<void>;
}

async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const existing = await pool.query("SELECT version FROM schema_migrations WHERE version = $1", [
      version,
    ]);
    if (existing.rowCount && existing.rowCount > 0) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
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

interface RunInputRow {
  run_id: string;
  seed: string;
  data: GeneratedRunData;
  created_at: Date;
}

export class PgRunDataRepository implements RunDataRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await runMigrations(this.pool);
  }

  async saveRunInput(record: RunInputRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_inputs (run_id, seed, data, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id) DO UPDATE SET seed = EXCLUDED.seed, data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
      [record.runId, record.seed, JSON.stringify(record.data), record.createdAt],
    );
  }

  async getRunInput(runId: string): Promise<RunInputRecord | null> {
    const result = await this.pool.query<RunInputRow>(
      "SELECT * FROM run_inputs WHERE run_id = $1",
      [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      seed: row.seed,
      data: row.data,
      createdAt: row.created_at.toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemoryRunDataRepository implements RunDataRepository {
  private readonly inputs = new Map<string, RunInputRecord>();

  async init(): Promise<void> {}

  async saveRunInput(record: RunInputRecord): Promise<void> {
    this.inputs.set(record.runId, { ...record });
  }

  async getRunInput(runId: string): Promise<RunInputRecord | null> {
    const found = this.inputs.get(runId);
    return found ? { ...found } : null;
  }

  async close(): Promise<void> {}
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Không tìm thấy lần chạy ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export class ScenarioMissingError extends Error {
  constructor(scenarioId: string) {
    super(`Kịch bản '${scenarioId}' của lần chạy không còn trong thư viện`);
    this.name = "ScenarioMissingError";
  }
}

export class DataService {
  constructor(
    private readonly repo: RunDataRepository,
    private readonly runService: RunService,
    private readonly scenarioService: ScenarioService,
    private readonly banned: BannedDataList,
  ) {}

  /** Sinh du lieu cho 1 lan chay tu khoi sinhDuLieu cua kich ban va luu lai. */
  async generateForRun(runId: string, seed?: string): Promise<RunInputRecord> {
    const detail = await this.runService.getRunWithSteps(runId);
    if (!detail) throw new RunNotFoundError(runId);
    const scenarioRecord = await this.scenarioService.getScenario(detail.run.scenarioId);
    if (!scenarioRecord) throw new ScenarioMissingError(detail.run.scenarioId);
    const data = generateRunData({
      runId,
      ...(seed ? { seed } : {}),
      ...(scenarioRecord.scenario.sinhDuLieu
        ? { dataGen: scenarioRecord.scenario.sinhDuLieu }
        : {}),
      banned: this.banned,
    });
    const record: RunInputRecord = {
      runId,
      seed: data.seed,
      data,
      createdAt: new Date().toISOString(),
    };
    await this.repo.saveRunInput(record);
    return record;
  }

  async getRunInput(runId: string): Promise<RunInputRecord | null> {
    return this.repo.getRunInput(runId);
  }
}
