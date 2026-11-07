# Implementation Readiness — AutoTest (BMAD Phase 3 → 4 Gate)

Ngày: 2026-11-07 · Kết luận: **PASS — chủ dự án đã chốt QD-1, QD-2, QD-4 và duyệt spike QD-3 trong cùng ngày; vào Sprint 1.**

## Đã sẵn sàng

- Mục tiêu, người dùng, hành trình UJ-1..UJ-3 rõ (Product Brief + PRD).
- Kiến trúc có luật AD-1..AD-8 đủ để chia story không lệ thuộc lẫn nhau.
- Epics/Stories đã chia tới mức nghiệm thu được, có thứ tự sprint.
- Đích UAT đầu tiên (CRM_Loyalty) đã có sẵn bộ Playwright e2e và seed để tham chiếu hành vi bước (đặt lịch, check-in, báo cáo 29.1/29.2/38.6).
- Repo đích `tranuy123/AutoTest` tồn tại, đang rỗng, nhánh mặc định `main` (kiểm chứng qua GitHub ngày 2026-11-07).

## Còn thiếu / rủi ro

- **QD-3 Stream** — công nghệ cuối cùng chưa chốt, đã có story spike S3.0 đo số trước khi quyết, đúng cách xử lý rủi ro kỹ thuật lớn nhất.
- **Tài khoản UAT theo vai + tenant/chi nhánh test riêng**: cần chủ dự án chuẩn bị trên UAT trước Sprint 2 (danh sách vai: bệnh nhân, lễ tân, bác sĩ, thu ngân, quản lý). Đây là đầu vào ngoài code, không có là S3.3 không nghiệm thu được.
- **Cờ sandbox kênh ngoài trên UAT** cần xác nhận với đội CRM trước S5.3.

## Cổng vào Phase 4

1. ~~Uy chốt QD-1 và QD-4~~ — đã chốt 2026-11-07, kèm QD-2 và duyệt spike QD-3.
2. Đẩy bộ tài liệu BMAD này lên repo AutoTest (commit khởi tạo, Uy đã duyệt 2026-11-07).
3. Bắt đầu Sprint 1: Epic 1 + spike S3.0.
