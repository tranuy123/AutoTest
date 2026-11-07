# Quy tắc tính kỳ vọng doanh thu — Oracle AutoTest (S4.1)

Tài liệu này là **nguồn sự thật duy nhất** của module Oracle (`packages/oracle`).
Mọi công thức tính kỳ vọng doanh thu đều viết từ tài liệu này (luật **AD-4**:
Oracle độc lập — cấm import hay sao chép code tính báo cáo của CRM; nếu CRM
báo cáo sai khác tài liệu này thì đó là lỗi cần bắt được, không phải lý do để
Oracle "sai theo").

**Quy trình thay đổi:** sửa tài liệu này TRƯỚC, ghi rõ quy tắc thay đổi và ví
dụ số mới, sau đó mới sửa code và test tương ứng. Mỗi quy tắc dưới đây có ít
nhất một ví dụ số cụ thể; bộ test của Oracle (`src/oracle.test.ts`) cài đặt
lại đúng các ví dụ này bằng số tính tay độc lập.

Đơn vị tiền: **đồng Việt Nam, số nguyên** (VND không có phần lẻ). Mọi phép
tính tiền trong Oracle chỉ dùng số nguyên; đầu vào tiền không nguyên bị từ
chối kèm lỗi nêu rõ bản ghi.

---

## QT-1 — Trạng thái nào được ghi nhận doanh thu

Chỉ giao dịch ở trạng thái **đã thanh toán** (`da-thanh-toan`) mới ghi nhận
doanh thu. Các trạng thái còn lại đóng góp **0**:

| Trạng thái | Ý nghĩa nghiệp vụ | Doanh thu |
|---|---|---|
| `da-thanh-toan` | Đã thu tiền, không hoàn | Tính theo QT-2 |
| `da-huy` | Lịch huỷ trước khi thanh toán | 0 |
| `chua-thanh-toan` | Đã đặt/đã khám nhưng chưa thu tiền | 0 |
| `da-hoan-tien` | Đã thu rồi hoàn lại toàn bộ | 0 (doanh thu bị đảo ngược hoàn toàn) |

Ví dụ: 4 giao dịch trong ngày — 300.000đ đã thanh toán, 200.000đ đã huỷ,
150.000đ đã hoàn tiền, 100.000đ chưa thanh toán → **tổng doanh thu ngày =
300.000đ**.

## QT-2 — Số tiền thực thu của một giao dịch

```
thucThu = giaGoc − giamTien − giamTheoPhanTram
giamTheoPhanTram = floor(giaGoc × giamPhanTram / 100)
```

- `giaGoc`: giá dịch vụ tại thời điểm đặt lịch (lấy từ dữ liệu đầu vào của
  lần chạy, không lấy lại từ hệ thống đích).
- `giamTien`: số tiền giảm trực tiếp (đồng), mặc định 0.
- `giamPhanTram`: phần trăm giảm trên **giá gốc** (0–100), mặc định 0. Phần
  giảm theo % được **làm tròn xuống** tới đồng (floor) vì tiền mặt VND không
  có phần lẻ.

Ví dụ 1: giá gốc 300.000đ, giảm tiền 20.000đ → thực thu **280.000đ**.
Ví dụ 2: giá gốc 155.555đ, giảm 10% → phần giảm = floor(15.555,5) = 15.555đ →
thực thu **140.000đ**.
Ví dụ 3 (kết hợp): giá gốc 500.000đ, giảm tiền 50.000đ và giảm 10% (=
50.000đ tính trên giá gốc) → thực thu **400.000đ**.

## QT-3 — Trần giảm giá

Tổng phần giảm không được làm số tiền âm: nếu `giamTien +
giamTheoPhanTram > giaGoc` thì thực thu = **0**.

Ví dụ: giá gốc 100.000đ, giảm tiền 120.000đ → thực thu **0đ** (không phải
−20.000đ).

## QT-4 — Ngày ghi nhận doanh thu (múi giờ Asia/Saigon)

Doanh thu của một giao dịch thuộc về **ngày lịch tại múi giờ Asia/Saigon**
của thời điểm thanh toán, không theo UTC và không theo múi giờ máy chạy.

Ví dụ 1: thanh toán lúc `2026-11-07T23:59:00+07:00` → ngày **2026-11-07**;
thanh toán lúc `2026-11-08T00:01:00+07:00` → ngày **2026-11-08**. Hai giao
dịch cách nhau 2 phút nhưng thuộc hai ngày báo cáo khác nhau.
Ví dụ 2: thời điểm ghi dạng UTC `2026-11-07T17:30:00Z` tương đương 00:30
ngày 08/11 giờ Saigon → thuộc ngày **2026-11-08**.

## QT-5 — Cộng dồn theo ngày / khách hàng / dịch vụ

- **Tổng theo ngày** = tổng thực thu (QT-2) của mọi giao dịch được ghi nhận
  (QT-1) thuộc ngày đó (QT-4).
- **Doanh thu theo khách hàng** = tổng thực thu của khách đó qua mọi ngày,
  mọi dịch vụ.
- **Doanh thu theo dịch vụ** = tổng thực thu của dịch vụ đó qua mọi ngày,
  mọi khách hàng.
- **Bất biến kiểm tra chéo:** tổng toàn bộ = tổng các tổng theo ngày = tổng
  các tổng theo khách hàng = tổng các tổng theo dịch vụ. Test của Oracle
  kiểm tra bất biến này trên bộ dữ liệu nhiều ngày/nhiều khách.

Ví dụ: khách A mua dịch vụ X 300.000đ ngày 07/11 và dịch vụ Y 200.000đ ngày
08/11; khách B mua dịch vụ X 300.000đ ngày 08/11 →
theo ngày: 07/11 = 300.000đ, 08/11 = 500.000đ;
theo khách: A = 500.000đ, B = 300.000đ;
theo dịch vụ: X = 600.000đ, Y = 200.000đ;
tổng toàn bộ = 800.000đ.

## QT-6 — Nguồn dữ liệu của Oracle

Oracle chỉ đọc **dữ liệu đầu vào của lần chạy** (bộ dữ liệu đã sinh ở S2.3 và
kết quả luân chuyển của chính lần chạy: lịch nào đã thanh toán/huỷ — do
orchestrator xác định từ kết quả các bước của lần chạy đó). Oracle không đọc
báo cáo, API hay DB của hệ thống đích: những nguồn đó là đối tượng bị kiểm
tra ở tầng Reconciler (S4.2), không bao giờ là nguồn của kỳ vọng.

Khi chuyển dữ liệu sinh thành giao dịch kỳ vọng: thời điểm thanh toán mặc
định lấy bằng thời điểm của lịch hẹn (kịch bản mẫu chạy trọn luồng trong
ngày của lịch hẹn); lịch không nằm trong tập đã thanh toán và không bị huỷ
thì ở trạng thái `chua-thanh-toan`.
