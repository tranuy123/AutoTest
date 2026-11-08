-- Migration 007 (S5.5): cau hinh khai bao qua trang Cau hinh moi truong.
-- Bang key-value don gian: URL dich UAT, allowlist, tenant va tai khoan
-- theo vai (ten dang nhap + mat khau) do chu du an khai bao tren giao dien.
-- Gia tri o day GHI DE cau hinh tu .env khi tinh cau hinh hieu luc;
-- .env chi con la gia tri mac dinh ban dau. Mat khau luu o day khong bao
-- gio duoc tra ra API/giao dien (chi tra co hasPassword).

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
