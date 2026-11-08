/**
 * Kho nhat ky theo lan chay (S5.6) - cung mau thiet ke voi
 * run-store/settings-store: moi truy cap qua RunLogRepository, co ban
 * PostgreSQL (migration 008) va ban in-memory cho test/khong DB.
 *
 * NGUYEN TAC AN TOAN (ke thua S1.3 AC-3): kho nay CHI nhan entry da qua
 * sanitizeLogEntry cua run-logger.ts (danh sach trang + redact SDT,
 * email, secret). Hai duong vao deu bao dam dieu do:
 * - RunLogService.capture(entry tho) -> sanitizeLogEntry truoc khi luu.
 * - RunLogService.captureSanitizedLine(line) -> dong JSON do
 *   createRunLogger phat ra (da sanitize ngay trong createRunLogger).
 * Khong co duong nao ghi thang entry tho vao kho.
 *
 * Gioi han chong phinh: toi da MAX_RUN_LOG_ENTRIES entry/lan chay; vuot
 * qua thi ghi 1 entry canh bao run_log_truncated va bo cac entry sau.
 * Cac lan ghi cua mot lan chay duoc xep hang bang chuoi promise trong
 * RunLogService (orchestrator la tien trinh don - cung gia dinh voi
 * InMemoryRunRepository.nextRunSequence).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { sanitizeLogEntry, type RunLogEntry } from "./run-logger.js";

export const MAX_RUN_LOG_ENTRIES = 5000;

export type RunLogLevel = "info" | "warn" | "error";

export interface StoredRunLogEntry {
  seq: number;
  /** Thoi diem dang ISO 8601 (UTC) nhu trong ban ghi da sanitize. */
  ts: string;
  runId: string;
  roleId?: string;
  stepId?: string;
  level: RunLogLevel;
  event: string;
  message: string;
}

export interface RunLogState {
  count: number;
  truncated: boolean;
}

export interface RunLogRepository {
  init(): Promise<void>;
  getState(runId: string): Promise<RunLogState>;
  append(runId: string, entry: StoredRunLogEntry): Promise<void>;
  markTruncated(runId: string): Promise<void>;
  list(runId: string): Promise<StoredRunLogEntry[]>;
  close(): Promise<void>;
}

/* ------------------------- PostgreSQL ------------------------- */

interface RunLogRow {
  seq: number;
  ts: Date;
  role_id: string | null;
  step_id: string | null;
  level: RunLogLevel;
  event: string;
  message: string;
}

export class PgRunLogRepository implements RunLogRepository {
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

  async getState(runId: string): Promise<RunLogState> {
    const result = await this.pool.query<{ entry_count: number; truncated: boolean }>(
      "SELECT entry_count, truncated FROM run_log_state WHERE run_id = $1",
      [runId],
    );
    const row = result.rows[0];
    return row
      ? { count: row.entry_count, truncated: row.truncated }
      : { count: 0, truncated: false };
  }

  async append(runId: string, entry: StoredRunLogEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO run_log_entries (run_id, seq, ts, role_id, step_id, level, event, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          runId,
          entry.seq,
          entry.ts,
          entry.roleId ?? null,
          entry.stepId ?? null,
          entry.level,
          entry.event,
          entry.message,
        ],
      );
      await client.query(
        `INSERT INTO run_log_state (run_id, entry_count, truncated) VALUES ($1, $2, false)
         ON CONFLICT (run_id) DO UPDATE
           SET entry_count = GREATEST(run_log_state.entry_count, EXCLUDED.entry_count)`,
        [runId, entry.seq],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markTruncated(runId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_log_state (run_id, entry_count, truncated) VALUES ($1, 0, true)
       ON CONFLICT (run_id) DO UPDATE SET truncated = true`,
      [runId],
    );
  }

  async list(runId: string): Promise<StoredRunLogEntry[]> {
    const result = await this.pool.query<RunLogRow>(
      `SELECT seq, ts, role_id, step_id, level, event, message
         FROM run_log_entries WHERE run_id = $1 ORDER BY seq ASC`,
      [runId],
    );
    return result.rows.map((row) => ({
      seq: row.seq,
      ts: row.ts.toISOString(),
      runId,
      ...(row.role_id ? { roleId: row.role_id } : {}),
      ...(row.step_id ? { stepId: row.step_id } : {}),
      level: row.level,
      event: row.event,
      message: row.message,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* ------------------------- In-memory ------------------------- */

export class InMemoryRunLogRepository implements RunLogRepository {
  private readonly byRun = new Map<
    string,
    { entries: StoredRunLogEntry[]; truncated: boolean }
  >();

  async init(): Promise<void> {}

  async getState(runId: string): Promise<RunLogState> {
    const data = this.byRun.get(runId);
    return {
      count: data?.entries.length ?? 0,
      truncated: data?.truncated ?? false,
    };
  }

  async append(runId: string, entry: StoredRunLogEntry): Promise<void> {
    const data = this.byRun.get(runId) ?? { entries: [], truncated: false };
    data.entries.push({ ...entry });
    this.byRun.set(runId, data);
  }

  async markTruncated(runId: string): Promise<void> {
    const data = this.byRun.get(runId) ?? { entries: [], truncated: false };
    data.truncated = true;
    this.byRun.set(runId, data);
  }

  async list(runId: string): Promise<StoredRunLogEntry[]> {
    return [...(this.byRun.get(runId)?.entries ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async close(): Promise<void> {}
}

/* ------------------------- Service ------------------------- */

const ERROR_EVENTS = new Set([
  "run_execute_error",
  "run_scenario_missing",
  "target_blocked",
  "sandbox_blocked",
  "run_reconcile_error",
  "request_error",
]);

const WARN_EVENTS = new Set([
  "run_stop_requested",
  "run_stop_forced_close",
  "run_stopped",
  "run_stopped_while_queued",
]);

/** Suy ra muc do hien thi tu ban ghi da sanitize (khong them du lieu moi). */
export function deriveRunLogLevel(record: Record<string, unknown>): RunLogLevel {
  const event = typeof record.event === "string" ? record.event : "";
  if (typeof record.errorMessage === "string" && record.errorMessage !== "") return "error";
  if (typeof record.errorCode === "string" && record.errorCode !== "") return "error";
  if (ERROR_EVENTS.has(event)) return "error";
  if (
    (event === "run_finished" || event === "role_finished" || event === "role_step") &&
    record.result === "hong"
  ) {
    return "error";
  }
  if (WARN_EVENTS.has(event)) return "warn";
  if (
    (event === "run_finished" || event === "role_finished") &&
    record.result === "dung"
  ) {
    return "warn";
  }
  return "info";
}

/** Ghep thong diep hien thi tu cac truong da sanitize (loi/ma loi/ket qua). */
export function deriveRunLogMessage(record: Record<string, unknown>): string {
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : "";
  const errorCode = typeof record.errorCode === "string" ? record.errorCode : "";
  if (errorMessage && errorCode) return `${errorMessage} (mã lỗi: ${errorCode})`;
  if (errorMessage) return errorMessage;
  if (errorCode) return `Mã lỗi: ${errorCode}`;
  if (typeof record.result === "string" && record.result !== "") {
    return `Kết quả: ${record.result}`;
  }
  return "";
}

export class RunLogService {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly repo: RunLogRepository) {}

  /**
   * Duong vao cho entry THO (executor): sanitize truoc, chi ban ghi da
   * sanitize moi duoc ghi vao kho. Tra promise de test cho duoc; phia
   * san xuat cu goi va bo qua (loi ghi log khong duoc lam hong lan chay).
   */
  capture(entry: RunLogEntry): Promise<void> {
    return this.storeSanitized(sanitizeLogEntry(entry));
  }

  /**
   * Duong vao cho sink cua createRunLogger (server): dong JSON nhan duoc
   * DA qua sanitizeLogEntry ngay trong createRunLogger nen chi parse va
   * luu; parse loi thi bo qua (stdout van giu nguyen dong do).
   */
  captureSanitizedLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    void this.storeSanitized(parsed as Record<string, unknown>);
  }

  private storeSanitized(record: Record<string, unknown>): Promise<void> {
    const runId = typeof record.runId === "string" ? record.runId : "";
    if (!runId || typeof record.event !== "string") return Promise.resolve();
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const task = previous.then(() => this.appendOne(runId, record));
    // Chuoi khong duoc vo vi mot lan ghi loi: nhanh luu trong map luon
    // la nhanh da bat loi, con task tra ra ngoai giu nguyen ket qua.
    this.chains.set(
      runId,
      task.catch(() => undefined),
    );
    return task.catch(() => undefined);
  }

  private async appendOne(
    runId: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    try {
      const state = await this.repo.getState(runId);
      if (state.truncated) return;
      if (state.count >= MAX_RUN_LOG_ENTRIES) {
        await this.repo.append(runId, {
          seq: state.count + 1,
          ts: new Date().toISOString(),
          runId,
          level: "warn",
          event: "run_log_truncated",
          message: `Nhật ký đã vượt ${MAX_RUN_LOG_ENTRIES} dòng — các dòng tiếp theo của lần chạy này không được lưu nữa`,
        });
        await this.repo.markTruncated(runId);
        return;
      }
      await this.repo.append(runId, {
        seq: state.count + 1,
        ts: typeof record.ts === "string" ? record.ts : new Date().toISOString(),
        runId,
        ...(typeof record.roleId === "string" ? { roleId: record.roleId } : {}),
        ...(typeof record.stepId === "string" ? { stepId: record.stepId } : {}),
        level: deriveRunLogLevel(record),
        event: record.event as string,
        message: deriveRunLogMessage(record),
      });
    } catch {
      // Ghi nhat ky la phu tro: loi kho luu khong duoc lam hong lan chay.
    }
  }

  async list(runId: string): Promise<{ entries: StoredRunLogEntry[]; truncated: boolean }> {
    const [entries, state] = await Promise.all([
      this.repo.list(runId),
      this.repo.getState(runId),
    ]);
    return { entries, truncated: state.truncated };
  }

  /** Cho moi lan ghi dang xep hang hoan tat (dung trong test/dieu phoi). */
  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }
}

/** Dang entry dua ra API: bo runId (da nam o cap phan hoi), giu nguyen con lai. */
export function toRunLogApiEntry(entry: StoredRunLogEntry): {
  seq: number;
  ts: string;
  roleId?: string;
  stepId?: string;
  level: RunLogLevel;
  event: string;
  message: string;
} {
  return {
    seq: entry.seq,
    ts: entry.ts,
    ...(entry.roleId ? { roleId: entry.roleId } : {}),
    ...(entry.stepId ? { stepId: entry.stepId } : {}),
    level: entry.level,
    event: entry.event,
    message: entry.message,
  };
}

const SAIGON_TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Saigon",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Gio HH:mm:ss theo Asia/Saigon cho dong log .txt va trang Nhat ky. */
export function formatRunLogTime(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "--:--:--" : SAIGON_TIME.format(date);
}

/**
 * Ban text cua nhat ky lan chay (GET .../logs.txt): dinh dang gui di ho
 * tro - moi entry mot dong "HH:mm:ss | vai | buoc | LEVEL | message",
 * gio Asia/Saigon; vai/buoc vang mat thi de "-". Phan dau ghi run_id +
 * kich ban va ghi chu log da duoc che du lieu nhay cam.
 */
export function buildRunLogText(input: {
  runId: string;
  scenarioId?: string | null;
  entries: StoredRunLogEntry[];
  truncated: boolean;
}): string {
  const lines: string[] = [
    `Nhật ký lần chạy ${input.runId}`,
    ...(input.scenarioId ? [`Kịch bản: ${input.scenarioId}`] : []),
    "Log đã được hệ thống tự che dữ liệu nhạy cảm (số điện thoại, email, mật khẩu) trước khi lưu.",
  ];
  if (input.truncated) {
    lines.push(
      `LƯU Ý: nhật ký quá dài nên đã bị cắt bớt — chỉ giữ ${MAX_RUN_LOG_ENTRIES} dòng đầu của lần chạy.`,
    );
  }
  lines.push("");
  for (const entry of input.entries) {
    lines.push(
      `${formatRunLogTime(entry.ts)} | ${entry.roleId ?? "-"} | ${entry.stepId ?? "-"} | ${entry.level.toUpperCase()} | ${entry.message || entry.event}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
