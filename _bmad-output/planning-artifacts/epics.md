# Epics & Stories — AutoTest (BMAD Phase 3: Solutioning)

Ngày: 2026-11-07 · Mỗi story nghiệm thu trên máy thật của chủ dự án, đích là CRM_Loyalty UAT.

## Epic 1 — Khung chạy & an toàn môi trường
- S1.1 Khởi tạo monorepo + Docker Compose: `docker compose up -d` mở được Control App rỗng trên localhost.
- S1.2 Cấu hình môi trường + allowlist UAT + chặn cứng URL ngoài danh sách (có test chứng minh chạy nhầm URL bị từ chối).
- S1.3 Kho lần chạy + cấp `run_id` + nhật ký lần chạy không chứa dữ liệu cá nhân.

## Epic 2 — Kịch bản & sinh dữ liệu
- S2.1 Schema kịch bản + validate file nạp vào, báo lỗi theo dòng/trường (phụ thuộc QD-2).
- S2.2 Thư viện kịch bản trên giao diện: liệt kê, xem, chọn chạy.
- S2.3 Bộ sinh dữ liệu giả danh tính theo khai báo kịch bản, gắn `run_id`.
- S2.4 Dọn dữ liệu theo `run_id` sau mỗi lần chạy, kể cả lần chạy fail.

## Epic 3 — Thực thi nhiều vai & stream
- S3.0 **Spike stream:** đo CDP screencast vs noVNC (độ trễ, CPU/RAM/phiên, độ ổn định 60 phút) → chốt QD-3 bằng số đo.
- S3.1 Worker Playwright: mở phiên headed, đăng nhập 1 vai, thực thi thư viện bước cơ bản.
- S3.2 Stream 1 phiên về lưới xem, nhãn vai + bước hiện tại, trễ < 2 giây local.
- S3.3 Nhiều vai đồng thời + điểm đồng bộ theo sự kiện (AD-3); kịch bản mẫu: bệnh nhân đặt lịch → lễ tân xác nhận.
- S3.4 Chế độ Chạy nhanh: headless song song, quay video, không stream.

## Epic 4 — Oracle & kiểm đếm báo cáo
- S4.1 Oracle tính kỳ vọng cho kịch bản mẫu doanh thu (độc lập code CRM — AD-4).
- S4.2 Reconciler đối chiếu UI/API/DB, xuất bảng chênh lệch theo chỉ tiêu.
- S4.3 Tích hợp vào kịch bản mẫu đầy đủ: đặt lịch → check-in → thanh toán → báo cáo doanh thu 29.1/29.2 khớp số.

## Epic 5 — Báo cáo, video & hoàn thiện MVP
- S5.1 Trang kết quả lần chạy: kết luận, bảng đối chiếu, video từng vai, tải báo cáo .md.
- S5.2 Hàng đợi khi vượt số phiên stream tối đa; nút Dừng an toàn.
- S5.3 Kiểm tra cờ sandbox kênh ngoài trước khi chạy kịch bản có nhắc hẹn (NFR-4).
- S5.4 Tài liệu chạy trên máy thật: cài Docker, cấu hình `.env`, chạy kịch bản mẫu đầu tiên.

## Thứ tự sprint đề xuất

- Sprint 1: Epic 1 + S3.0 (spike stream) — xong là biết nền có đứng vững không.
- Sprint 2: Epic 2 + S3.1, S3.2 — nạp được kịch bản, xem được 1 vai chạy.
- Sprint 3: S3.3, S3.4 + Epic 4 — nhiều vai đồng bộ + kiểm đếm doanh thu.
- Sprint 4: Epic 5 — đóng gói MVP, chạy thử trọn gói trên máy thật.
