/**
 * Kho thu vien kich ban (S2.2) - cung mau thiet ke voi run-store (S1.3):
 * moi truy cap qua ScenarioRepository, co ban PostgreSQL va ban in-memory
 * cho test. Validate bang schema S2.1 nam o ScenarioService - repository
 * chi luu kich ban DA hop le.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  convertExcelToYaml,
  parseScenarioYaml,
  type ScenarioDefinition,
  type ValidationIssue,
} from "@autotest/scenario-schema";
import { Pool } from "pg";

export interface ScenarioRecord {
  id: string;
  name: string;
  yaml: string;
  scenario: ScenarioDefinition;
  createdAt: string;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  roles: string[];
  stepCount: number;
  metricCount: number;
  createdAt: string;
}

export function toScenarioSummary(record: ScenarioRecord): ScenarioSummary {
  return {
    id: record.id,
    name: record.name,
    roles: [...record.scenario.cacVai],
    stepCount: record.scenario.cacBuoc.length,
    metricCount: record.scenario.kiemDem?.length ?? 0,
    createdAt: record.createdAt,
  };
}

export interface ScenarioRepository {
  init(): Promise<void>;
  listScenarios(): Promise<ScenarioRecord[]>;
  getScenario(id: string): Promise<ScenarioRecord | null>;
  insertScenario(record: ScenarioRecord): Promise<void>;
  deleteScenario(id: string): Promise<boolean>;
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

interface ScenarioRow {
  id: string;
  name: string;
  yaml: string;
  parsed: ScenarioDefinition;
  created_at: Date;
}

export class PgScenarioRepository implements ScenarioRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await runMigrations(this.pool);
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    const result = await this.pool.query<ScenarioRow>(
      "SELECT * FROM scenarios ORDER BY created_at ASC, id ASC",
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      yaml: row.yaml,
      scenario: row.parsed,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async getScenario(id: string): Promise<ScenarioRecord | null> {
    const result = await this.pool.query<ScenarioRow>("SELECT * FROM scenarios WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      yaml: row.yaml,
      scenario: row.parsed,
      createdAt: row.created_at.toISOString(),
    };
  }

  async insertScenario(record: ScenarioRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO scenarios (id, name, yaml, parsed, created_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.name, record.yaml, JSON.stringify(record.scenario), record.createdAt],
    );
  }

  async deleteScenario(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM scenarios WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemoryScenarioRepository implements ScenarioRepository {
  private readonly scenarios = new Map<string, ScenarioRecord>();

  async init(): Promise<void> {}

  async listScenarios(): Promise<ScenarioRecord[]> {
    return [...this.scenarios.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }

  async getScenario(id: string): Promise<ScenarioRecord | null> {
    const found = this.scenarios.get(id);
    return found ? { ...found } : null;
  }

  async insertScenario(record: ScenarioRecord): Promise<void> {
    this.scenarios.set(record.id, { ...record });
  }

  async deleteScenario(id: string): Promise<boolean> {
    return this.scenarios.delete(id);
  }

  async close(): Promise<void> {}
}

export class ScenarioExistsError extends Error {
  constructor(id: string) {
    super(`Kịch bản '${id}' đã có trong thư viện`);
    this.name = "ScenarioExistsError";
  }
}

export type ImportScenarioResult =
  | { ok: true; record: ScenarioRecord }
  | { ok: false; errors: ValidationIssue[] };

export class ScenarioService {
  constructor(private readonly repo: ScenarioRepository) {}

  /** Nap kich ban tu noi dung file: YAML truc tiep, Excel thi chuyen doi truoc (QD-2). */
  async importScenario(input: {
    filename: string;
    format: "yaml" | "excel";
    contentText?: string;
    contentBase64?: string;
  }): Promise<ImportScenarioResult> {
    let yaml: string;
    let scenario: ScenarioDefinition;
    if (input.format === "excel") {
      if (!input.contentBase64) {
        return {
          ok: false,
          errors: [{ file: input.filename, line: null, field: "(file)", message: "Thiếu nội dung file Excel" }],
        };
      }
      const converted = await convertExcelToYaml(
        Buffer.from(input.contentBase64, "base64"),
        input.filename,
      );
      if (!converted.ok) return { ok: false, errors: converted.errors };
      yaml = converted.yaml;
      scenario = converted.scenario;
    } else {
      if (input.contentText === undefined) {
        return {
          ok: false,
          errors: [{ file: input.filename, line: null, field: "(file)", message: "Thiếu nội dung file YAML" }],
        };
      }
      const parsed = parseScenarioYaml(input.contentText, input.filename);
      if (!parsed.ok) return { ok: false, errors: parsed.errors };
      yaml = input.contentText;
      scenario = parsed.scenario;
    }

    const existing = await this.repo.getScenario(scenario.id);
    if (existing) throw new ScenarioExistsError(scenario.id);
    const record: ScenarioRecord = {
      id: scenario.id,
      name: scenario.ten,
      yaml,
      scenario,
      createdAt: new Date().toISOString(),
    };
    await this.repo.insertScenario(record);
    return { ok: true, record };
  }

  async listSummaries(): Promise<ScenarioSummary[]> {
    const all = await this.repo.listScenarios();
    return all.map(toScenarioSummary);
  }

  async getScenario(id: string): Promise<ScenarioRecord | null> {
    return this.repo.getScenario(id);
  }

  async deleteScenario(id: string): Promise<boolean> {
    return this.repo.deleteScenario(id);
  }

  /** Nap san kich ban mau khi thu vien dang rong (de giao dien co san de chay). */
  async seedIfEmpty(sampleYamlText: string): Promise<void> {
    const all = await this.repo.listScenarios();
    if (all.length > 0) return;
    const parsed = parseScenarioYaml(sampleYamlText, "dat-lich-den-bao-cao.yaml");
    if (!parsed.ok) return;
    await this.repo.insertScenario({
      id: parsed.scenario.id,
      name: parsed.scenario.ten,
      yaml: sampleYamlText,
      scenario: parsed.scenario,
      createdAt: new Date().toISOString(),
    });
  }
}
