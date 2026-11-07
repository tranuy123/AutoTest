# Architecture Spine — AutoTest (BMAD Phase 3: Solutioning)

Ngày: 2026-11-07 · Trạng thái: Đề xuất, phụ thuộc QD-1..QD-4 trong PRD

## Thành phần

```
[Giao diện Control App] --WebSocket/HTTP--> [Orchestrator] --> [Hàng đợi lần chạy]
        ^                                        |
        | stream từng vai                        v
[Bảng đối chiếu + Báo cáo] <--- [Oracle/Reconciler]   [Worker Pool: Chrome + Playwright]
                                        ^                        |
                                        |                        v
                                  [DB/API/UI của CRM UAT] <------+
```

1. **Control App** — giao diện: thư viện kịch bản, nạp file, nút Bắt đầu/Dừng, lưới stream, báo cáo lần chạy. Không tự chạy test.
2. **Orchestrator** — nhận lệnh chạy, cấp `run_id`, sinh dữ liệu, điều phối các vai và điểm đồng bộ, thu kết quả, ra lệnh dọn dữ liệu.
3. **Worker** — mỗi worker chứa các phiên Chrome (Xvfb, headed) chạy Playwright; mỗi vai = 1 browser context tách biệt (cookie/session riêng) đăng nhập tài khoản UAT của vai đó.
4. **Stream Gateway** — lấy hình từng phiên (CDP screencast hoặc noVNC — QD-3) và đẩy qua WebSocket về Control App theo kênh riêng từng vai.
5. **Oracle/Reconciler** — tính kỳ vọng độc lập từ dữ liệu đầu vào của lần chạy; đối chiếu UI/API/DB; sinh bảng chênh lệch.
6. **Kho lần chạy** — lưu kịch bản, input đã sinh, kết quả từng bước, video, bảng đối chiếu. DB nội bộ của AutoTest (không dùng chung DB CRM).

## Luật kiến trúc (AD)

- **AD-1 Tách điều phối khỏi thực thi:** Orchestrator không thao tác trình duyệt trực tiếp; mọi thao tác qua Worker. Nhờ đó thêm worker = thêm song song, không sửa logic kịch bản.
- **AD-2 Kịch bản là dữ liệu, không phải code:** Kịch bản khai báo (vai, dữ liệu, bước, đồng bộ, kiểm đếm) được validate bằng schema trước khi chạy. Hành động thao tác thuộc bộ thư viện bước dùng chung (đăng nhập, đặt lịch, check-in, thanh toán, mở báo cáo...), kịch bản chỉ ghép các bước.
- **AD-3 Đồng bộ theo sự kiện:** Các vai chờ nhau bằng sự kiện có tên + dữ liệu mang theo (ví dụ `appointment.created {appointment_id}`), không chờ bằng sleep cố định. Timeout cho từng điểm đồng bộ, quá hạn là fail rõ bước.
- **AD-4 Oracle độc lập:** Công thức tính kỳ vọng viết riêng từ đặc tả nghiệp vụ, cấm import/copy code tính báo cáo của CRM. Đây là điều kiện để bắt được lỗi lệch số của chính CRM.
- **AD-5 Mọi dữ liệu test đều mang run_id:** Sinh, thao tác, kiểm đếm, dọn — tất cả lọc theo `run_id` và tenant/chi nhánh test. Dọn dữ liệu là một bước của lần chạy, fail cũng phải dọn.
- **AD-6 Chặn Production ở Orchestrator:** Trước khi cấp phát worker, Orchestrator kiểm URL đích thuộc danh sách cho phép (allowlist trong cấu hình môi trường). Control App không có khả năng ghi đè allowlist.
- **AD-7 Stream là phụ, đúng/sai là chính:** Mất stream không được làm fail kịch bản; kết quả kiểm đếm vẫn phải hoàn thành và video bản ghi vẫn lưu để xem lại.
- **AD-8 Hai chế độ dùng chung một engine:** Chế độ Xem và Chạy nhanh chỉ khác cấu hình phiên (headed+stream+slow-mo vs headless+song song), không fork logic kịch bản.
- **AD-9 Stream bằng noVNC (chốt QD-3 qua spike S3.0, 2026-11-07):** Stream Gateway dùng noVNC (máy chủ X ảo + VNC phía worker, client `@novnc/novnc` phía Control App). Số đo trên VM 4 CPU/7,9 GB RAM: ở 4 phiên đồng thời noVNC đạt trễ hình median 116 ms / p95 205 ms, 0 đứt, trong khi CDP screencast đạt 904/1376 ms với 39 khoảng trống khung > 500 ms và sập hoàn toàn ở 8 phiên (median ~25 giây) vì nghẽn một kết nối điều khiển dùng chung. CDP screencast chỉ là dự phòng cho chế độ 1 phiên. Chi tiết và giới hạn đo (thay Xvnc cho Xvfb+x11vnc, phần ổn định 60 phút còn nợ do môi trường VM): `spikes/stream/BAO-CAO-SPIKE.md`.

## Luồng một lần chạy (Chế độ Xem)

1. Người dùng chọn kịch bản → Bắt đầu.
2. Orchestrator kiểm allowlist UAT + cờ sandbox kênh ngoài → cấp `run_id` → sinh dữ liệu.
3. Worker mở phiên cho từng vai, Stream Gateway gắn kênh, Control App hiện lưới stream.
4. Các vai thực thi bước, gặp điểm đồng bộ thì chờ sự kiện.
5. Khối kiểm đếm: Oracle tính kỳ vọng → Reconciler đọc UI/API/DB → bảng chênh lệch.
6. Dọn dữ liệu theo `run_id` → lưu báo cáo + video → hiện kết luận.

## Quy mô và giới hạn

- 1 máy thật, 1 worker: mục tiêu 4-8 phiên stream đồng thời (ước lượng, đo lại ở spike QD-3).
- Vượt quá: hàng đợi ở Orchestrator; Chế độ Nhanh mới là đường chạy hàng loạt.
- Độ trễ stream mục tiêu < 2 giây trên local/LAN; không cam kết qua Internet công cộng (app chạy local).

## Bảo mật

- Tài khoản UAT theo vai: chỉ ở `.env` trên máy thật / biến môi trường container; API của Orchestrator không trả mật khẩu về Control App.
- Log/video/ảnh: chỉ id và run_id, không dữ liệu cá nhân; dữ liệu sinh là giả danh tính.
- Control App chỉ nghe trên localhost/LAN của chủ dự án ở MVP; chưa có multi-user auth.
