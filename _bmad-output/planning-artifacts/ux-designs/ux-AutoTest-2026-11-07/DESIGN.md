# DESIGN — AutoTest (BMAD UX: hệ thống thị giác)

Ngày: 2026-11-07 · Đi kèm EXPERIENCE.md cùng thư mục (hành vi, trạng thái, câu chữ)

## Bố cục tổng

- Khung ứng dụng: thanh trái cố định (điều hướng: Trang chính / Thư viện kịch bản / Lịch sử chạy / Cấu hình môi trường), vùng chính thay đổi theo màn hình. Trên di động, thanh trái thu thành hàng nút trên đầu.
- Màn hình khi đang chạy: lưới stream chiếm tối thiểu 60% diện tích; bảng kiểm đếm là cột phải cố định, không phải cuộn tìm.

## Màu sắc (token)

- `--nen`: #0F172A (slate-900) cho nền app tối — lưới stream xem lâu không mỏi mắt, ô video nổi bật.
- `--be-mat`: #1E293B (slate-800) nền thẻ/panel; `--be-mat-sang`: #334155 khi hover/chọn.
- `--chu-chinh`: #F1F5F9; `--chu-phu`: #94A3B8.
- `--nhan-manh`: #2563EB (blue-600) — nút hành động chính duy nhất trên mỗi màn hình.
- `--qua`: #16A34A (green-600) — trạng thái khớp/qua, luôn kèm chữ "Khớp" / "QUA".
- `--hong`: #DC2626 (red-600) — lỗi/lệch, luôn kèm chữ "Lệch" / "HỎNG" + số cụ thể.
- `--cho`: #D97706 (amber-600) — đang chờ/đang chạy, luôn kèm chữ mô tả bước.
- Màu không bao giờ là tín hiệu duy nhất: mọi trạng thái đều có chữ tiếng Việt đi kèm (bài học từ e2e viewer).

## Chữ

- Font: Inter hoặc system-ui; tiếng Việt phải đủ dấu, không dùng font trang trí.
- Tiêu đề màn hình 24-28px đậm; nhãn ô stream 14px đậm; số liệu đối chiếu 16-18px, dùng font-variant-numeric: tabular-nums để các cột số thẳng hàng.
- Số tiền hiển thị đúng định dạng CRM: `900.000 đ` (dấu chấm phân cách nghìn, có khoảng trắng trước đ).

## Nút và điều khiển

- Nút chính (Bắt đầu chạy / Chạy lại): cao tối thiểu 52px, chữ 16-17px đậm, là nút màu nhấn mạnh duy nhất trên màn hình.
- Nút phụ: cao tối thiểu 44px, viền rõ, chữ là hành động cụ thể ("Nạp kịch bản mới (.yaml, .xlsx)", "Tải báo cáo (.md)") — cấm chữ chung chung kiểu "Gửi", "OK", "Tiếp".
- Nút Dừng khi đang chạy: màu đỏ nhạt + chữ "Dừng lần chạy này", đặt xa nút chính để tránh bấm nhầm.
- Ô stream: tỉ lệ 16:9, nhãn vai + bước hiện tại chồng ở góc trên-trái trên nền bán trong suốt; viền ô đổi theo trạng thái (xám = chờ, vàng = đang chạy, xanh = xong, đỏ = lỗi).

## Mật độ

- Trang chính thoáng: khu "Bắt đầu ở đây — 3 bước" trên cùng, thư viện kịch bản dạng danh sách 1 cột dễ quét, không dùng lưới thẻ dày đặc.
- Lịch sử chạy: bảng 1 dòng / 1 lần chạy, cột: giờ, kịch bản, chế độ, kết quả (chữ), nút "Xem lại".
