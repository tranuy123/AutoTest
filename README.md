# AutoTest

Hệ thống tự động kiểm thử trên môi trường **UAT** cho CRM_Loyalty: nạp kịch bản, bấm bắt đầu, hệ thống tự sinh dữ liệu giống thật, thao tác như người dùng thật với **nhiều vai trò cùng lúc**, **stream trực tiếp** từng phiên thao tác, và tự **đối chiếu báo cáo + kiểm đếm số liệu** ở cuối mỗi kịch bản.

- Repo: https://github.com/tranuy123/AutoTest
- Sản phẩm chạy trên **máy thật của chủ dự án** (không chạy trên Muse VM). Muse là nơi phát triển code và đẩy code lên GitHub.
- Kế hoạch triển khai theo **BMAD Method** — toàn bộ tài liệu kế hoạch nằm trong `_bmad-output/planning-artifacts/`:
  - Product Brief: `_bmad-output/planning-artifacts/product-brief.md`
  - PRD: `_bmad-output/planning-artifacts/prds/prd-AutoTest-2026-11-07/prd.md`
  - Kiến trúc: `_bmad-output/planning-artifacts/architecture/architecture-AutoTest-2026-11-07/ARCHITECTURE-SPINE.md`
  - UX: `_bmad-output/planning-artifacts/ux-designs/ux-AutoTest-2026-11-07/EXPERIENCE.md`
  - Epics & Stories: `_bmad-output/planning-artifacts/epics.md`
  - Kiểm tra sẵn sàng triển khai: `_bmad-output/planning-artifacts/implementation-readiness.md`
  - Trạng thái sprint: `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Trạng thái

Đã qua cổng Phase 3 → Phase 4 (ngày 2026-11-07): Brief, PRD, Architecture Spine, Epics/Stories đã có; chủ dự án đã chốt QD-1 (stack TypeScript/Next.js/Playwright/Docker Compose), QD-2 (kịch bản YAML + chuyển đổi Excel), QD-4 (MVP chỉ đích CRM_Loyalty UAT) và duyệt spike stream QD-3 trong Sprint 1 — xem `implementation-readiness.md`. Sprint 1 bắt đầu với Epic 1 + spike S3.0.

## Chạy trên máy thật

Yêu cầu duy nhất: Docker + Docker Compose trên máy thật.

```bash
cp .env.example .env
docker compose up -d
```

Sau khi các service healthy:

- Mở Control App: http://localhost:3100 — trang chủ hiện "Hệ thống sẵn sàng".
- Kiểm tra Orchestrator: `curl http://localhost:3101/health` → `{ "status": "ok" }`.

Dừng hệ thống: `docker compose down` (thêm `-v` nếu muốn xoá cả dữ liệu DB nội bộ).

Phát triển không qua Docker (trên máy dev có Node >= 22 và pnpm 11):

```bash
corepack enable && corepack prepare pnpm@11 --activate
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

## Nguyên tắc không thương lượng

1. Chỉ chạy vào **UAT**. Chặn cứng Production (xem AGENTS.md).
2. **Không dùng dữ liệu bệnh nhân thật**: dữ liệu sinh tự động, giống thật về cấu trúc và số tiền, giả về danh tính.
3. Kênh Zalo/Facebook/SMS trên UAT phải ở chế độ sandbox — auto test không bao giờ nhắn tin thật cho khách.
4. Mật khẩu tài khoản UAT lưu trong `.env` local / kho bí mật, **không bao giờ commit**.
