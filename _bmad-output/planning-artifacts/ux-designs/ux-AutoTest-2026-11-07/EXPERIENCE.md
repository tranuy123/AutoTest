# EXPERIENCE — AutoTest (BMAD Phase 2/3: UX)

Ngày: 2026-11-07 · Bản 2 (2026-11-07, khi chủ dự án yêu cầu thiết kế giao diện trước): bổ sung đặc tả từng màn hình để dựng bản mẫu tương tác. Nguyên tắc: học từ lỗi của e2e viewer cũ — nút phải rõ nghĩa, mở app là biết bắt đầu ở đâu.

## Điều hướng

4 mục cố định: **Trang chính** (chạy kịch bản), **Thư viện kịch bản**, **Lịch sử chạy**, **Cấu hình môi trường**. Đang ở mục nào thì mục đó sáng rõ kèm chữ đậm; không ẩn điều hướng trong menu hamburger trên desktop.

## Màn hình Cấu hình môi trường (điều kiện trước khi chạy)

- Hiện URL UAT đang nối + trạng thái "Đúng UAT — được phép chạy" (xanh + chữ) hoặc "Không phải UAT — đã chặn" (đỏ + chữ, nút Bắt đầu bị khóa kèm lý do).
- Danh sách tài khoản theo vai (bệnh nhân, lễ tân, bác sĩ, thu ngân, quản lý): chỉ hiện "đã cấu hình / chưa cấu hình", không bao giờ hiện mật khẩu.
- Trạng thái sandbox kênh ngoài: "Zalo/Facebook/SMS đang ở chế độ sandbox — an toàn" hoặc cảnh báo.

## Màn hình chính — "Bắt đầu ở đây, 3 bước"

1. **Chọn / nạp kịch bản** — nút lớn "Nạp kịch bản mới (.yaml, .xlsx)" + danh sách kịch bản có sẵn ngay bên dưới, mỗi dòng có nút "Chạy kịch bản này".
2. **Chọn chế độ** — 2 lựa chọn chữ rõ: "Xem trực tiếp (chậm, có stream)" / "Chạy nhanh (không xem, chạy song song)".
3. **Bấm "Bắt đầu chạy"** — nút lớn nhất màn hình; khi đang chạy đổi thành "Dừng" + trạng thái từng bước.

## Màn hình đang chạy

- **Lưới stream là trung tâm:** mỗi vai 1 ô 16:9, nhãn trên ô: tên vai + bước đang làm (ví dụ "Lễ tân — đang xác nhận lịch #..."). Ô nào lỗi viền đỏ + chữ "Lỗi ở bước này".
- Bên phải/dưới: **bảng kiểm đếm trực tiếp** — chỉ tiêu nào đã đối chiếu xong hiện ✓ khớp / ✗ lệch (kèm 2 số: kỳ vọng vs thực tế).
- Không dùng biểu tượng trạng thái đơn độc; mọi trạng thái đều có chữ tiếng Việt đi kèm.
- Nút bấm có vùng chạm lớn; chữ trên nút là hành động cụ thể, không viết tắt.

## Màn hình kết quả

- Kết luận đầu trang: "Kịch bản QUA" / "Kịch bản HỎNG — lệch 2 chỉ tiêu", chữ lớn.
- Bảng đối chiếu đầy đủ, video từng vai để phát lại, nút "Tải báo cáo (.md)" và "Chạy lại kịch bản này".
- Phân biệt rõ dữ liệu của lần chạy này với các lần trước (hiện run_id + giờ chạy).
