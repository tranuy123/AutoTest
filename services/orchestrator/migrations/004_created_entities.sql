-- Migration 004 (S2.4): so dang ky thuc the da tao tren CRM theo run_id.
-- Moi dong la mot thuc the test (lich hen, hoa don...) duoc tao trong mot
-- lan chay; bo don chi cham cac dong cua dung lan chay do (AD-5).

CREATE TABLE IF NOT EXISTS created_entities (
  run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_by_step_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleaned_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_created_entities_run ON created_entities (run_id);
