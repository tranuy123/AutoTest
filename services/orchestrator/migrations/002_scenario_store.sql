-- Migration 002 (S2.2): thu vien kich ban cua AutoTest.
-- Luu ca YAML goc lan doi tuong da parse de giao dien hien chi tiet
-- ma khong phai parse lai; validate nam o lop service truoc khi luu.

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  yaml TEXT NOT NULL,
  parsed JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
