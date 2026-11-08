-- Migration 008 (S5.6): nhat ky theo lan chay - trang Nhat ky doc tu day
-- de xem/tai log gui ho tro thay vi chi dua vao stdout cua orchestrator.
-- Moi entry LUU O DAY da qua sanitizeLogEntry (whitelist + redact) o
-- RunLogService: tuyet doi khong co entry tho, khong co so dien thoai,
-- email hay mat khau trong bang nay.
-- run_log_state giu so dong da luu + co bao da bi cat (gioi han
-- MAX_RUN_LOG_ENTRIES dong/lan chay o RunLogService).

CREATE TABLE IF NOT EXISTS run_log_entries (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  role_id TEXT,
  step_id TEXT,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_run_log_entries_run_seq
  ON run_log_entries (run_id, seq);

CREATE TABLE IF NOT EXISTS run_log_state (
  run_id TEXT PRIMARY KEY,
  entry_count INTEGER NOT NULL DEFAULT 0,
  truncated BOOLEAN NOT NULL DEFAULT false
);
