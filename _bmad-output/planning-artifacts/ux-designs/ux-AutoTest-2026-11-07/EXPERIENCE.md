# EXPERIENCE — AutoTest (BMAD Phase 2/3: UX)

Ngày: 2026-11-07 · Nguyên tắc: học từ lỗi của e2e viewer cũ — nút phải rõ nghĩa, mở app là biết bắt đầu ở đâu.

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
