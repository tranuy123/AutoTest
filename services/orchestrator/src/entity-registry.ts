/**
 * So dang ky thuc the da tao theo run_id (S2.4, AD-5).
 * Cac buoc thuc thi o Epic 3 dang ky moi thuc the vua tao tren CRM
 * (lich hen, hoa don...) vao day; buoc don o cuoi lan chay chi dua vao
 * so nay ma don - khong quet tim du lieu la tren UAT.
 * Truy cap du lieu qua EntityRepository (Pg that / InMemory cho test).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

/**
 * Thu tu don: gia tri cang cao don cang truoc (nguoc phu thuoc):
 * hoa don -> lich hen -> chien dich -> benh nhan -> phu tro.
 */
export const ENTITY_CLEANUP_PRIORITY: Record<string, number> = {
  "hoa-don": 50,
  "lich-hen": 40,
  "chien-dich": 30,
  "benh-nhan": 20,
  "phu-tro": 10,
};

export function cleanupPriority(type: string): number {
  return ENTITY_CLEANUP_PRIORITY[type] ?? 0;
}

export interface CreatedEntity {
  runId: string;
  type: string;
  entityId: string;
  createdByStepId: string | null;
  createdAt: string;
  cleanedAt: string | null;
}

export interface EntityRepository {
  init(): Promise<void>;
  register(entity: CreatedEntity): Promise<void>;
  listByRun(runId: string): Promise<CreatedEntity[]>;
  markCleaned(runId: string, type: string, entityId: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------- PostgreSQL ------------------------- */

interface EntityRow {
  run_id: string;
  entity_type: string;
  entity_id: string;
  created_by_step_id: string | null;
  created_at: Date;
  cleaned_at: Date | null;
}

export class PgEntityRepository implements EntityRepository {
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

  async register(entity: CreatedEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO created_entities (run_id, entity_type, entity_id, created_by_step_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id, entity_type, entity_id) DO NOTHING`,
      [entity.runId, entity.type, entity.entityId, entity.createdByStepId],
    );
  }

  async listByRun(runId: string): Promise<CreatedEntity[]> {
    const result = await this.pool.query<EntityRow>(
      "SELECT * FROM created_entities WHERE run_id = $1 ORDER BY created_at, entity_type, entity_id",
      [runId],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      type: row.entity_type,
      entityId: row.entity_id,
      createdByStepId: row.created_by_step_id,
      createdAt: row.created_at.toISOString(),
      cleanedAt: row.cleaned_at ? row.cleaned_at.toISOString() : null,
    }));
  }

  async markCleaned(runId: string, type: string, entityId: string): Promise<void> {
    await this.pool.query(
      "UPDATE created_entities SET cleaned_at = now() WHERE run_id = $1 AND entity_type = $2 AND entity_id = $3",
      [runId, type, entityId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* ------------------------- In-memory ------------------------- */

export class InMemoryEntityRepository implements EntityRepository {
  private readonly entities = new Map<string, CreatedEntity>();

  async init(): Promise<void> {
    // Khong co migration.
  }

  private key(runId: string, type: string, entityId: string): string {
    return `${runId}\u0000${type}\u0000${entityId}`;
  }

  async register(entity: CreatedEntity): Promise<void> {
    const key = this.key(entity.runId, entity.type, entity.entityId);
    if (!this.entities.has(key)) {
      this.entities.set(key, { ...entity });
    }
  }

  async listByRun(runId: string): Promise<CreatedEntity[]> {
    return [...this.entities.values()]
      .filter((e) => e.runId === runId)
      .map((e) => ({ ...e }));
  }

  async markCleaned(runId: string, type: string, entityId: string): Promise<void> {
    const entity = this.entities.get(this.key(runId, type, entityId));
    if (entity) entity.cleanedAt = new Date().toISOString();
  }

  async close(): Promise<void> {
    // Khong co tai nguyen.
  }
}

/* ------------------------- Service ------------------------- */

export class EntityRegistry {
  constructor(private readonly repo: EntityRepository) {}

  async init(): Promise<void> {
    await this.repo.init();
  }

  async register(input: {
    runId: string;
    type: string;
    entityId: string;
    createdByStepId?: string | null;
  }): Promise<void> {
    if (!input.runId || !input.type || !input.entityId) {
      throw new Error("Đăng ký thực thể thiếu runId/type/entityId");
    }
    await this.repo.register({
      runId: input.runId,
      type: input.type,
      entityId: input.entityId,
      createdByStepId: input.createdByStepId ?? null,
      createdAt: new Date().toISOString(),
      cleanedAt: null,
    });
  }

  async listByRun(runId: string): Promise<CreatedEntity[]> {
    return this.repo.listByRun(runId);
  }

  async markCleaned(runId: string, type: string, entityId: string): Promise<void> {
    await this.repo.markCleaned(runId, type, entityId);
  }

  async close(): Promise<void> {
    await this.repo.close();
  }
}
