# Bộ kịch bản CRM_Loyalty cho AutoTest

Đã validate bằng `parseScenarioYaml` của `@autotest/scenario-schema` (cả 5 file OK).
Nạp vào app: Control App (http://localhost:3100) → Thư viện kịch bản → tải file `.yaml` lên.

| File | Nội dung | Vai | Ghi lên CRM |
|---|---|---|---|
| 01-khoi-dong-dang-nhap | 4 vai nhân viên đăng nhập + mở trang chủ. **Chạy đầu tiên** để kiểm `.env` | lễ tân, bác sĩ, thu ngân, quản lý | Không |
| 02-dat-lich-check-in-thu-tien | Đặt lịch → xác nhận → check-in → thu tiền → in phiếu → báo cáo doanh thu ngày | BN, lễ tân, thu ngân, quản lý | Có |
| 03-tich-diem-doi-diem | 2 lịch cùng khách: thu tiền + cộng điểm, rồi đổi điểm trừ vào phiếu thu lần 2 | BN, lễ tân, thu ngân, quản lý | Có |
| 04-chien-dich-cham-soc | Tạo chiến dịch + mở báo cáo hiệu quả chiến dịch. Khai `kenhNgoai: zalo, sms` → chỉ chạy khi UAT ở sandbox | quản lý | Có |
| 05-nhieu-khach-cung-ngay | 3 khách cùng ngày, đối chiếu tổng doanh thu / số lịch / số check-in | BN, lễ tân, thu ngân, quản lý | Có |

Hai kịch bản mẫu có sẵn (`dat-lich-den-bao-cao`, `dat-lich-den-bao-cao-29`) được orchestrator tự nạp khi khởi động.
Chúng có bước `bat-dau-kham` / `ket-thuc-kham` — CRM_Loyalty **không có** màn khám (thuộc HIS) nên hai bước này sẽ hỏng; bộ trên đã bỏ chúng.

## Chặn trước khi chạy được trên CRM thật

Kịch bản YAML chỉ là dữ liệu; thao tác thật nằm ở `workers/runner/src/crm-actions.ts`, viết theo một CRM giả định:

1. **Đường dẫn** mặc định (`/lich-hen`, `/kham`, `/thu-ngan`, `/bao-cao/doanh-thu`, `/chien-dich`, `/diem-thuong`) không khớp CRM thật. Route đúng:

   | Biến | Giá trị cho CRM_Loyalty |
   |---|---|
   | `CRM_PATH_DAT_LICH` | `/dat-lich` |
   | `CRM_PATH_LICH_HEN` | `/quan-tri/lich-hen` |
   | `CRM_PATH_THANH_TOAN` | `/quan-tri/phieu-thu` |
   | `CRM_PATH_BAO_CAO_DOANH_THU` | `/quan-tri/bao-cao/doanh-thu` |
   | `CRM_PATH_CHIEN_DICH` | `/quan-tri/chien-dich/tao-moi` |
   | `CRM_PATH_DIEM` | `/quan-tri/khach-hang` (điểm nằm trong hồ sơ khách) |

   Các biến này **chưa có** trong `docker-compose.yml` / `.env.example` nên điền `.env` cũng không tới worker.
2. **Đăng nhập**: action mở `TARGET_BASE_URL` gốc (cổng bệnh nhân); nhân viên phải vào `/quan-tri/dang-nhap` (email + mật khẩu), bệnh nhân đăng nhập bằng SĐT + OTP.
3. **Check-in**: CRM check-in ở `/quan-tri/check-in`, action đang mở trang lịch hẹn.
4. **Bộ định vị**: các `data-testid` action dùng (`tong-doanh-thu`, `so-luot-check-in`, `lich-hen-id`, `tong-tien`, `app-shell`…) không tồn tại trong CRM; nhãn "Tên đăng nhập", "In hoá đơn", "Bắt đầu khám" cũng không có.
5. **Bộ hành động** chỉ gồm 14 mã cố định; muốn kịch bản cho màn khác của CRM (khách tiềm năng, chăm sóc, KPI, hoa hồng…) phải thêm hành động vào `actions.ts` + `crm-actions.ts`.
