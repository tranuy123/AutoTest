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

Đã triển khai xong toàn bộ 19 story theo bản cam kết tự hành (ngày 2026-11-07): 11 story `done`, 8 story mã hoàn chỉnh còn chờ kiểm chứng trên máy thật (Docker/Chrome/PostgreSQL không có trên máy ảo phát triển). Cổng cuối chương trình: **178/178 test đạt**, typecheck + lint đạt cả 5 gói, `pnpm verify:compose` đạt.

📦 **Gói bàn giao:**

- **Tài liệu cài đặt + checklist nghiệm thu máy thật:** [`docs/HUONG-DAN-MAY-THAT.md`](docs/HUONG-DAN-MAY-THAT.md) — cài từ đầu, điền `.env` từng biến, chạy kịch bản mẫu đầu tiên, checklist 9 khoản chạy một lượt để đóng toàn bộ nợ kiểm chứng, xử lý sự cố, và mục đầu vào cần cấp cho vòng UAT thật.
- **Báo cáo tự nghiệm thu toàn dự án:** [`docs/BAO-CAO-TU-NGHIEM-THU.md`](docs/BAO-CAO-TU-NGHIEM-THU.md) — từng story đạt AC nào, bằng chứng gì, còn nợ gì.

## Chạy trên máy thật

**Windows — cài đặt nhanh:** tải/clone repo rồi **double-click `SETUP.bat`** ở
thư mục gốc. Script tự nâng quyền Admin, kiểm tra (và cài qua winget nếu thiếu)
Docker Desktop + Node.js, bật pnpm, `pnpm install`, tạo `.env` từ
`.env.example` và mở Notepad để điền, `docker compose up -d --build`, chờ cả
hai cổng 3100/3101 sẵn sàng rồi tự mở http://localhost:3100. Toàn bộ logic nằm
trong [`scripts/setup.ps1`](scripts/setup.ps1) — đọc được từng bước trước khi
chạy nếu muốn.

Yêu cầu duy nhất: Docker + Docker Compose trên máy thật. Hướng dẫn đầy đủ ở
[`docs/HUONG-DAN-MAY-THAT.md`](docs/HUONG-DAN-MAY-THAT.md); tóm tắt:

```bash
cp .env.example .env   # điền TARGET_*, tài khoản 5 vai, tenant test
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
