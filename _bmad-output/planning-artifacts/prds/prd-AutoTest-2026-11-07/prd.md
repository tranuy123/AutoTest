# PRD — AutoTest (BMAD Phase 2: Planning)

Ngày: 2026-11-07 · Phiên bản: 1.0 (chủ dự án đã chốt các quyết định ở mục 6 cùng ngày)

## 1. Mục tiêu

App chạy trên máy thật của chủ dự án, cho phép nạp kịch bản kiểm thử, chạy tự động trên UAT của CRM_Loyalty với nhiều vai trò đồng thời, stream trực tiếp thao tác, và tự kiểm đếm số liệu báo cáo.

## 2. Hành trình người dùng

- **UJ-1 — Xem một kịch bản chạy trực tiếp:** Mở app → chọn kịch bản → bấm Bắt đầu → xem lưới stream các vai thao tác theo nhịp đồng bộ → kịch bản kết thúc, app hiện kết luận Qua/Hỏng + bảng đối chiếu.
- **UJ-2 — Nạp kịch bản mới:** Tải file kịch bản lên (hoặc chọn mẫu) → app kiểm tra định dạng và báo lỗi dòng cụ thể nếu sai → kịch bản vào thư viện, dùng lại được.
- **UJ-3 — Chạy nhanh toàn bộ qua đêm:** Chọn chế độ Chạy nhanh → hệ thống chạy headless song song → sáng hôm sau xem báo cáo tổng, chỉ mở video của kịch bản hỏng.

## 3. Yêu cầu chức năng (FR)

- **FR-1 Thư viện kịch bản:** Liệt kê, tìm, xem chi tiết kịch bản; mỗi kịch bản khai báo: các vai tham gia, dữ liệu cần sinh, các bước theo vai, điểm đồng bộ giữa các vai, và khối kiểm đếm cuối.
- **FR-2 Nạp kịch bản:** Tải lên file kịch bản; validate schema; báo lỗi dễ hiểu theo dòng/trường. Định dạng gốc: *[QUYẾT ĐỊNH MỞ QD-2]*.
- **FR-3 Sinh dữ liệu:** Theo khai báo của kịch bản, sinh bệnh nhân/lịch hẹn/dịch vụ/hoá đơn giả danh tính nhưng hợp lệ nghiệp vụ; mọi bản ghi gắn `run_id` duy nhất cho lần chạy; có cơ chế dọn dữ liệu theo `run_id` sau chạy.
- **FR-4 Thực thi nhiều vai:** Mỗi vai đăng nhập bằng tài khoản UAT riêng (cấu hình ngoài file kịch bản), phiên trình duyệt tách biệt; các vai chờ nhau tại điểm đồng bộ (ví dụ có `appointment_id` mới đi tiếp).
- **FR-5 Stream trực tiếp:** Mỗi phiên có 1 ô stream riêng trên giao diện; xem được chuột/click/gõ/cuộn; có nhãn vai + bước hiện tại; độ trễ mục tiêu < 2 giây trên mạng LAN/máy local.
- **FR-6 Hai chế độ chạy:** *Chế độ Xem* (chậm như người thật, có stream, 1 kịch bản, tối đa số vai theo cấu hình) và *Chế độ Chạy nhanh* (headless, song song, không stream, quay video để xem lại).
- **FR-7 Oracle + kiểm đếm 3 chiều:** Bộ tính kỳ vọng độc lập với code báo cáo của CRM; đối chiếu số liệu ở UI báo cáo, API và truy vấn DB UAT; xuất bảng chênh lệch theo từng chỉ tiêu/dòng dữ liệu.
- **FR-8 Báo cáo lần chạy:** Mỗi lần chạy lưu: trạng thái từng bước, input đã sinh, output kỳ vọng vs thực tế, video từng vai (chế độ Xem luôn lưu; chế độ Nhanh lưu khi fail hoặc theo cấu hình), log rút gọn không chứa dữ liệu cá nhân.
- **FR-9 Điều khiển lần chạy:** Bắt đầu, Dừng an toàn (dừng sau bước hiện tại, vẫn dọn dữ liệu), xem hàng đợi khi tài nguyên stream đã đầy.
- **FR-10 Cấu hình môi trường:** Khai báo URL UAT, danh sách URL được phép, tài khoản theo vai, chi nhánh/tenant test riêng cho auto test. Mật khẩu chỉ ở `.env` local.

## 4. Yêu cầu phi chức năng (NFR)

- **NFR-1 An toàn môi trường:** Chặn cứng mọi URL ngoài danh sách UAT cho phép. Không có nút "chạy Production".
- **NFR-2 Cách ly dữ liệu:** Lần chạy song song không đụng nhau (run_id + tenant/chi nhánh test riêng); không ảnh hưởng dữ liệu người test tay ngoài phạm vi tenant test.
- **NFR-3 Tài nguyên:** Chế độ Xem chạy ổn định 4-8 phiên Chrome đồng thời trên máy thật cấu hình vừa (ước lượng 300-500 MB RAM/phiên); vượt giới hạn thì xếp hàng thay vì sập.
- **NFR-4 Kênh ngoài:** Mọi kịch bản chạm Zalo/Facebook/SMS chỉ chạy khi UAT đang ở sandbox/stub; hệ thống kiểm tra cờ sandbox trước khi chạy và từ chối nếu không chắc chắn.
- **NFR-5 Thời gian:** Kịch bản khai báo múi giờ Asia/Saigon và ngày nghiệp vụ cố định khi cần, tránh lệch số báo cáo theo ngày.
- **NFR-6 Cài đặt đơn giản:** Trên máy thật chỉ cần Docker + Docker Compose: `docker compose up -d` là dùng được.

## 5. Phạm vi MVP

Có: FR-1..FR-10 ở mức cơ bản cho **đích UAT đầu tiên là CRM_Loyalty**, 1 kịch bản mẫu nhiều vai (đặt lịch → check-in → thanh toán → báo cáo doanh thu), stream qua công nghệ chốt ở QD-3.
Chưa có: trình dựng kịch bản kéo-thả trực quan, chạy phân tán nhiều máy worker, hỗ trợ app mobile native, báo cáo xu hướng nhiều tuần.

## 6. Quyết định (chủ dự án đã chốt ngày 2026-11-07)

- **QD-1 Stack kỹ thuật: ĐÃ CHỐT.** TypeScript toàn dự án (khớp CRM): Next.js cho control app, Node cho orchestrator/worker, Playwright, pnpm monorepo, Docker Compose.
- **QD-2 Định dạng kịch bản gốc: ĐÃ CHỐT.** YAML là chuẩn gốc, kèm bộ chuyển đổi từ Excel.
- **QD-3 Công nghệ stream: ĐÃ DUYỆT cách làm.** Spike trong Sprint 1 so sánh CDP screencast vs noVNC, chốt công nghệ bằng số đo độ trễ/tài nguyên (story S3.0).
- **QD-4 Đích kiểm thử: ĐÃ CHỐT.** MVP chỉ nhắm CRM_Loyalty UAT; kiến trúc giữ cửa để thêm đích khác sau.
