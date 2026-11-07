-- Migration 003 (S2.3): bo du lieu da sinh kem theo lan chay.
-- Oracle o Epic 4 doc bang nay de tinh ky vong doc lap (AD-4/AD-5).

CREATE TABLE IF NOT EXISTS run_inputs (
  run_id TEXT PRIMARY KEY REFERENCES runs (run_id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
