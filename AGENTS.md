# AGENTS.md — Luật làm việc cho dự án AutoTest

## Bối cảnh

AutoTest là app kiểm thử tự động trên UAT cho CRM_Loyalty (đặt lịch, check-in, thanh toán, chiến dịch, báo cáo doanh thu/điểm). Kế hoạch nằm trong `_bmad-output/planning-artifacts/`; đọc **ARCHITECTURE-SPINE** trước khi thêm module, luồng dữ liệu hay cơ chế stream mới.

## Policy

- Không push thẳng lên `main` (ngoại lệ duy nhất: commit khởi tạo repo). Làm trên branch riêng theo story, mở PR để chủ dự án duyệt.
- Tài liệu kế hoạch trong `_bmad-output/` chỉ cập nhật qua các bước BMAD tương ứng (Brief → PRD → Architecture → Epics → Sprint), không sửa tay tuỳ tiện làm lệch chuỗi.
- Không commit `.env`, mật khẩu tài khoản UAT, khoá/secret nào. Biến mới khai báo trong `.env.example` với giá trị giả.
- Không ghi số điện thoại, họ tên, kết quả khám thật vào log, video, ảnh chụp hay dữ liệu kịch bản. Log chỉ ghi id và `run_id`.
- Dữ liệu kịch bản là dữ liệu **sinh tự động, giả danh tính**. Cấm sao chép dữ liệu từ Production vào bộ kịch bản.
- Hệ thống phải **chặn cứng Production**: nếu URL đích không nằm trong danh sách UAT cho phép trong cấu hình, từ chối chạy và báo rõ. Không có ngoại lệ qua giao diện.
- Kênh ngoài (Zalo/Facebook/SMS) khi test phải ở sandbox/stub. Story nào chạm kênh ngoài phải có kiểm chứng "không gửi thật" trong tiêu chí nghiệm thu.

## Chạy và kiểm chứng (khi đã vào Phase 4)

- Dự án đóng gói bằng Docker Compose để chạy trên máy thật của chủ dự án: `docker compose up -d` (control app + orchestrator + worker + db).
- Lệnh kiểm tra chuẩn sẽ chốt trong Architecture Spine và ghi lại ở đây khi sprint 1 bắt đầu.
