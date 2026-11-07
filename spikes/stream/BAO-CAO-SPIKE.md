# Báo cáo Spike S3.0 — CDP screencast vs noVNC (quyết định QD-3)

Ngày đo: 2026-11-07 · Người thực hiện: Muse (điều phối viên triển khai)
Thư mục spike: `spikes/stream/` (tách biệt mã sản phẩm — AC-4)
Dữ liệu thô: `spikes/stream/results/*.json` (mỗi lượt chạy một file, kèm cấu hình đo)

## 1. Phương pháp đo

- **Trang đích mẫu tương đương CRM:** form đặt lịch có gõ phím/click/cuộn liên tục (`lib/target.html`), hiển thị **đồng hồ khối 3×5 theo mili-giây** (9 chữ số) và một ô neo magenta cố định (`position: fixed`) để phía xem căn mẫu.
- **Phía xem giải mã khung hình thật:** (a) CDP — viewer tự vẽ khung JPEG nhận qua WebSocket relay từ `Page.startScreencast`; (b) noVNC — dùng thư viện `@novnc/novnc` thật kết nối qua cầu RFB. Độ trễ hình = `Date.now()` ở phía xem − giá trị đồng hồ giải mã được − thời điểm bắt đầu đo chung.
- Mỗi lượt đo 90 giây sau 15 giây khởi động; đếm thêm: khung hình/giây, số sự kiện hình cũ (stale), số khoảng trống khung > 500 ms, số lần đứt stream, CPU/RAM theo cây tiến trình (qua `/proc`).
- **Cấu hình máy đo:** Muse VM 4 CPU, ~7,9 GB RAM (yếu hơn hoặc tương đương máy thật của chủ dự án — đối chiếu khi áp kết luận).

### Thay thế hạ tầng phải ghi rõ (không ghi khống)

- Kế hoạch gốc nhánh noVNC là Xvfb + x11vnc. Trên VM này **x11vnc không cài được** (apt thiếu danh sách gói Ubuntu; một tiến trình `apt-get update` treo giữ khoá dpkg). Đã thay bằng **Xvnc của TigerVNC** — máy chủ X ảo tích hợp sẵn VNC, cùng giao thức RFB và cùng client noVNC. Kết quả đo vì thế phản ánh đúng phía client/giao thức sẽ dùng ở S3.2; phần khác biệt có thể có là hiệu năng của riêng x11vnc, được ghi nhận là giới hạn của spike.
- Nhánh CDP dùng Xvfb như kế hoạch.

## 2. Kết quả ma trận 1 / 4 / 8 phiên (90 giây/lượt)

| Phương án | Phiên | Trễ median | Trễ p95 | Trễ max | FPS/phiên | RAM/phiên | CPU/phiên | Gap >500ms | Đứt |
|---|---|---|---|---|---|---|---|---|---|
| CDP | 1 | 122 ms | 202 ms | 299 ms | ~44,3 | 1021,6 MB | 83,8% | 0 | 0 |
| CDP | 4 | 904 ms | 1376 ms | 5777 ms | ~9,3 | 467,8 MB | 23,3% | **39** | 0 |
| CDP | 8 | **25.107 ms** | **41.226 ms** | — | sập | 390,5 MB | — | **1733** | 0 |
| noVNC | 1 | 47 ms | 69 ms | 96 ms | — | 1067,1 MB | 24,2% | 0 | 0 |
| noVNC | 4 | 116 ms | 205 ms | 408 ms | — | 1060,6 MB | 14,0% | 0 | 0 |
| noVNC | 8 | 478 ms | 1205 ms | 2105 ms | — | 425,1 MB | 7,9% | 0 | 0 |

Hạ tầng phụ trợ noVNC (Xvnc + cầu): 32,4 MB ở 1 phiên, 129,4 MB ở 4 phiên, 179,8 MB ở 8 phiên.

Lưu ý diễn giải: số RAM/phiên không tuyến tính vì trang đích dùng chung bị tính trùng ở số phiên thấp; bộ nhớ trống của VM dao động trong ngày đo (có lúc chỉ còn ~620 MB, sau khi dọn tiến trình thừa ~3 GB). Các con số trễ — thước đo chính cho QD-3 — nhất quán qua nhiều lượt thử (có 3 lượt thử noVNC 1 phiên trong thư mục results).

## 3. Độ ổn định 60 phút (AC-2, phần chạy liên tục) — CHƯA HOÀN THÀNH vì môi trường

Đã khởi chạy lượt ổn định 4 phiên × 3600 giây cho cả hai phương án, nhưng **không thu được kết quả** do môi trường VM thay đổi giữa chừng (xem mục 5): từ khoảng 13:11 UTC 2026-11-07, Chromium không còn khởi động được trên VM này nữa (cả headless shell lẫn bản đầy đủ headed dưới Xvfb; lỗi `browserType.launch: Target page, context or browser has been closed`), nên lượt chạy bị hỏng hạ tầng (mất Xvfb/trình duyệt) và bản khởi chạy lại sau đó cũng chết ngay ở bước mở trình duyệt.

- Không ghi khống số ổn định 60 phút. Phần AC-2 còn nợ: **số lần mất khung/đứt stream trong 60 phút liên tục cho cả 2 phương án**.
- Cách bù: chạy lại đúng lệnh trong thư mục spike trên máy thật ở vòng bàn giao S5.4 (harness giữ nguyên, tham số `--duration 3600`):
  - `node lib/measure.js --method cdp --sessions 4 --duration 3600 --warmup 15 --label on-dinh`
  - `node lib/measure.js --method novnc --sessions 4 --duration 3600 --warmup 15 --label on-dinh`

## 4. Kết luận QD-3 — CHỌN noVNC

- Ở 1 phiên cả hai đều tốt; CDP rất mượt (~44 fps) nhưng tốn CPU bất thường (83,8%/phiên).
- Ở 4 phiên (mốc mục tiêu của PRD): noVNC trễ median 116 ms / p95 205 ms — **đạt xa mục tiêu < 2 giây**, 0 gap, 0 đứt. CDP đã chạm trần: median 904 ms, p95 1376 ms, 39 khoảng trống khung > 500 ms.
- Ở 8 phiên: noVNC vẫn trong mục tiêu (p95 1205 ms), trong khi **CDP sập hoàn toàn** (median ~25 giây) vì mọi phiên dùng chung một kết nối CDP/tiến trình điều khiển.
- **Quyết định: S3.2 dùng noVNC** (Xvfb/Xvnc + x11vnc hoặc Xvnc trên máy thật + @novnc/novnc ở phía xem). CDP screencast chỉ giữ vai trò dự phòng cho chế độ 1 phiên nếu cần chất lượng khung cao. Quyết định đã ghi vào Architecture Spine thành **AD-9**.

## 5. Ghi chú môi trường (bằng chứng cho phần còn nợ)

Trong ngày 2026-11-07, tầng sandbox của VM siết ghi file theo nội dung: tiến trình nào đã nạp mã có API mạng (TypeScript/Vite/Playwright/pg…) thì mọi lần ghi file sau đó đều trả EPERM (đã xác nhận bằng strace trên tiến trình ghi file tạm của Vite và bằng các probe tách bạch: đọc `typescript.js` rồi ghi → EPERM; mở socket rồi ghi → EPERM; ghi trước khi chạm các yếu tố đó → OK). Hệ quả trong ngày: vitest CLI không chạy được (ghi file tạm cấu hình), Chrome qua Playwright chết khi mở (không ghi được profile), không cài lại được PostgreSQL (file nhị phân trích từ .deb bị ghi thành 0 byte). Đây là giới hạn của môi trường VM, không phải của mã nguồn; chi tiết và cách nghiệm thu thay thế đã ghi trong Dev Agent Record của các story liên quan.
