-- Migration 001 (S1.3): kho lan chay cua AutoTest.
-- DB nay la DB noi bo cua AutoTest, tach han DB cua CRM (Architecture Spine, thanh phan 6).

CREATE TABLE IF NOT EXISTS run_counters (
  day TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dang-chay',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  video_path TEXT,
  report_path TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  run_id TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs (scenario_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
