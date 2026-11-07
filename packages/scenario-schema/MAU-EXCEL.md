# Mẫu Excel cho kịch bản AutoTest (S2.1, QD-2)

YAML là định dạng chuẩn gốc của kịch bản. File Excel chỉ là cách soạn thảo
thân thiện cho tester; khi nạp lên, hệ thống chuyển Excel → YAML rồi validate
bằng đúng schema YAML. Lỗi ở ô nào, hệ thống báo đúng ô đó (ví dụ `Buoc!C3`).

Tải file mẫu bằng hàm `buildExcelTemplate()` trong gói `@autotest/scenario-schema`
(file mẫu cũng được sinh trong test của gói).

## Sheet `KichBan` — thông tin chung

Hai cột: `Khoa` | `GiaTri`, mỗi khóa một dòng:

| Khoa   | Giá trị                                              |
| ------ | ---------------------------------------------------- |
| id     | slug chữ thường, vd `dat-lich-den-bao-cao`           |
| ten    | Tên kịch bản hiển thị tiếng Việt                     |
| moTa   | Mô tả ngắn (không bắt buộc)                          |
| cacVai | Các vai tham gia, cách nhau dấu phẩy: `benh-nhan,le-tan,bac-si,thu-ngan,quan-ly` |

## Sheet `Buoc` — các bước theo vai

Dòng 1 là tiêu đề cột; mỗi dòng sau là một bước, chạy theo thứ tự dòng:

| Cột            | Ý nghĩa |
| -------------- | ------- |
| id             | slug duy nhất của bước trong kịch bản |
| vai            | vai thực hiện: `benh-nhan`, `le-tan`, `bac-si`, `thu-ngan`, `quan-ly` (phải có trong `cacVai`) |
| hanhDong       | mã hành động trong thư viện bước dùng chung (xem `src/actions.ts`): `dang-nhap`, `dat-lich-hen`, `xac-nhan-lich`, `check-in`, `bat-dau-kham`, `ket-thuc-kham`, `thanh-toan`, `in-hoa-don`, `cong-diem`, `doi-diem`, `tao-chien-dich`, `mo-trang-chu`, `mo-bao-cao`, `xem-bao-cao-doanh-thu` |
| choSuKien      | tên sự kiện bước này phải chờ trước khi chạy (điểm đồng bộ AD-3); để trống nếu không chờ |
| phatSuKien     | tên sự kiện bước này phát ra khi xong; mọi sự kiện được chờ phải có một bước phát |
| thoiGianChoGiay| thời gian chờ tối đa cho điểm đồng bộ (giây), không bắt buộc |

## Sheet `SinhDuLieu` — khai báo dữ liệu cần sinh (S2.3)

Cột: `loai` | `ma` | `ten` | `gia` | `soLuong`

| loai     | Cách dùng |
| -------- | --------- |
| benhNhan | chỉ dùng `soLuong`: số bệnh nhân giả cần sinh |
| dichVu   | `ma`, `ten`, `gia` (VND, số nguyên); mỗi dịch vụ một dòng |
| lichHen  | chỉ dùng `soLuong`: số lịch hẹn cần sinh (gắn vào bệnh nhân/dịch vụ đã khai) |
| phuTro   | `ma` = loại thực thể phụ (vd `khuyenMai`), `soLuong` = số lượng |

## Sheet `KiemDem` — chỉ tiêu đối chiếu cuối kịch bản

Cột: `id` | `ten` | `nguon` | `kyVongTuDuLieu` | `kyVongGiaTri` | `donVi`

| Cột            | Ý nghĩa |
| -------------- | ------- |
| nguon          | nguồn đối chiếu, cách nhau dấu phẩy, ít nhất một trong `ui,api,db` |
| kyVongTuDuLieu | tên đại lượng kỳ vọng tính từ dữ liệu đã sinh (vd `tongGiaLichHenDaThanhToan`, `soLichHen`, `soCheckIn`) — dùng cột này hoặc `kyVongGiaTri` |
| kyVongGiaTri   | giá trị kỳ vọng cố định (số) |
| donVi          | đơn vị hiển thị (vd `VND`, `lịch`, `lượt`) |
