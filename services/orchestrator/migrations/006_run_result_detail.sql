-- Migration 006 (S5.1): chi tiet ket qua cua lan chay luu dang JSONB:
-- { kiemDem: BangDoiChieu|null, roles: WorkerSessionResult[],
--   sandboxCheck: SandboxCheckRecord|null }.
-- Trang ket qua va bao cao .md doc tu cot nay thay vi phu thuoc file
-- ket-qua.json (file chi la ban artifact bo sung, ghi tot nhat).

ALTER TABLE runs ADD COLUMN IF NOT EXISTS result_detail JSONB;
