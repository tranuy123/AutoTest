-- Migration 005 (S2.4): trang thai don du lieu cua lan chay.
-- 'sach' = da don het; 'chua-sach' = con thuc the sot lai (chi tiet trong
-- bao cao don cua lan chay); NULL = chua chay buoc don.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS cleanup_status TEXT;
