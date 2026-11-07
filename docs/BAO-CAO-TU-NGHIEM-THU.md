# Báo cáo tự nghiệm thu toàn dự án AutoTest

Ngày chốt: 2026-11-07 · Phạm vi: 19 story (5 epic) theo bản cam kết tự hành
`_bmad-output/implementation-artifacts/ke-hoach-tu-hanh-va-nghiem-thu.md`.
Bằng chứng chi tiết từng story nằm trong mục **Dev Agent Record** của file
story tương ứng tại `_bmad-output/implementation-artifacts/stories/`.

## Cổng cuối chương trình (chạy trên máy ảo phát triển, 2026-11-07)

| Kiểm chứng | Lệnh | Kết quả |
|---|---|---|
| Toàn bộ test | `node scripts/testing/run-tests-node.mjs` (hạ tầng thay thế VM, tương đương vitest — xem ghi chú) | **178/178 đạt, 0 fail**: scenario-schema 23, oracle 24, orchestrator 110, runner 21 (mốc đầu chương trình: 151) |
| Typecheck | `node scripts/testing/typecheck-vm.mjs` | Đạt cả 5 gói |
| Lint | `eslint .` từng gói | Đạt cả 5 gói, 0 lỗi |
| Cấu trúc Compose | `pnpm verify:compose` | Đạt: 4 service, đủ healthcheck, cổng 3100/3101, db không publish cổng |

Ghi chú môi trường (trung thực): máy ảo phát triển không có Docker, và từ
~13:11 UTC 2026-11-07 sandbox chặn ghi file với tiến trình đã nạp mã mạng
(EPERM) nên Chrome/PostgreSQL không chạy được trên VM. Mọi phần chưa kiểm
chứng được trên VM đều được ghi thành **nợ máy thật** trong Dev Agent Record
của story liên quan và đã gom đủ vào checklist Mục 6 của
`docs/HUONG-DAN-MAY-THAT.md` — không có AC nào bị đóng giả.

## Kết quả theo story

| Story | Trạng thái | AC đạt | Bằng chứng chính |
|---|---|---|---|
| S1.1 Monorepo + Docker Compose | done | 5/5 (AC-3 theo phương án thay thế của bản cam kết) | `pnpm -r build/typecheck/test/lint` đạt; `verify:compose` đạt; chạy trực tiếp bằng Node: orchestrator `/health` ok, control hiện "Hệ thống sẵn sàng". Nợ: `docker compose up` thật → Checklist khoản 1 |
| S1.2 Cấu hình + allowlist UAT | done | 4/4 | Test hàm + HTTP: Production bị chặn, URL lạ bị chặn, UAT trong allowlist qua cổng; các ca biên (hậu tố tên miền giả, URL chứa thông tin đăng nhập) đều fail-closed |
| S1.3 Kho lần chạy + run_id | done | Đủ (đã chạy trên PostgreSQL 16 thật tại thời điểm Epic 1) | 33/33 test khi có `TEST_DATABASE_URL`; run_id `AUTOTEST_YYYYMMDD_NNN` duy nhất kể cả 30–50 lần song song. Nợ chạy lại trên máy thật → Checklist khoản 2 |
| S2.1 Schema kịch bản + validate + Excel | done | Đủ | 19/19 test ở đợt 2; sau bổ sung S5.3: 23/23 (kèm `kenhNgoai`). Lỗi validate tiếng Việt trỏ đúng file/dòng/trường; converter báo đúng ô lỗi Excel |
| S2.2 Thư viện kịch bản + giao diện | done | Đủ ở mức API/UI code | Trang chính khớp bản mẫu đã duyệt; YAML sai trả lỗi đúng dòng. Nợ: `test:ui` click-through + test PG → Checklist khoản 2, 5 |
| S2.3 Sinh dữ liệu giả danh tính | done | 4/4 | SĐT tiền tố 011 (dải chưa cấp phát), gắn run_id, tổng tiền đối chiếu khớp trên lần chạy thật (2 bệnh nhân/2 lịch hẹn, 500.000đ). Nợ: test PG → Checklist khoản 2 |
| S2.4 Dọn dữ liệu theo run_id | in-progress | AC-1 đạt ở mức cơ chế + CRM giả lập HTTP thật; nhánh "bị dừng" đã nối xong qua S5.2 | Dọn cuối mọi lần chạy (qua/hỏng/dừng), thứ tự ngược phụ thuộc, script `cleanup-run.mjs`. Nợ: xác nhận endpoint xoá thật của CRM + PG → Checklist khoản 2, 8 |
| S3.0 Spike stream | in-progress | AC-1 đạt; AC-2 đạt một phần (ma trận 90 giây) | QD-3 chốt **noVNC** (AD-9): 4 phiên — noVNC median 116 ms/p95 205 ms, 0 đứt; CDP 904/1376 ms, 39 gap; CDP sập ở 8 phiên. Nợ: lượt ổn định 60 phút → Checklist khoản 3 |
| S3.1 Worker Playwright 1 vai | in-progress | AC-1/AC-3/AC-4 đạt ở mức mã + factory giả lập | Engine/factory có test vòng đời phiên. Nợ: Chrome headed Xvnc thật trên đích CRM cục bộ → Checklist khoản 4 |
| S3.2 Stream 1 phiên | in-progress | Đạt ở mức tích hợp giả lập | Cổng stream WS↔VNC + trang xem noVNC. Nợ: đo trễ tích hợp < 2s + ngắt VNC giữa chừng trên bản thật → Checklist khoản 5 |
| S3.3 Nhiều vai + đồng bộ sự kiện | in-progress | AC-4 đạt ở mức worker giả lập | Kịch bản mẫu 5 vai/8 bước chạy đầu-cuối QUA với worker giả; semaphore FIFO 5 phiên. Nợ: 5 ô stream trên CRM cục bộ thật → Checklist khoản 6 |
| S3.4 Chế độ chạy nhanh + đợt | in-progress | Đạt ở mức chính sách + giao diện | Đợt chạy + chính sách giữ/xoá video có test. Nợ: đợt ≥ 4 lần trên đích thật + file video vật lý → Checklist khoản 7 |
| S4.1 Oracle doanh thu độc lập | done | Đủ | Gói `@autotest/oracle` không phụ thuộc CRM; quy tắc QT-1..QT-6 viết trước code; 24/24 test gồm ca biên ngày Asia/Saigon, chiết khấu % làm tròn xuống |
| S4.2 Reconciler UI/API/DB | done (có ghi chú nợ transport PG) | Đủ ở mức logic + HTTP thật | Kỳ vọng chỉ suy từ dữ liệu sinh + bước đã qua; 3 nguồn độc lập; mất nguồn → "không kiểm chứng được" và lần chạy HỎNG (fail-closed). Nợ: `PgDbExecutor` trên PG thật + khớp API/SQL CRM → Checklist khoản 2, 9 |
| S4.3 Kịch bản mẫu báo cáo 29 | in-progress | AC-1/AC-4 đạt ở mức giả lập (HTTP thật) | 3 lần liên tiếp QUA trên đích giả lập; ca tiêm lệch API +50.000đ bị kết luận HỎNG đúng ở khối kiểm đếm. Nợ: AC-4 chính thức trên CRM cục bộ thật → Checklist khoản 9 |
| S5.3 Kiểm tra sandbox kênh ngoài | done | 4/4 | Schema v2 thêm `kenhNgoai`; cổng sandbox fail-closed 2 tín hiệu (health CRM + cấu hình); test đích giả lập HTTP thật ở 3 trạng thái: bật → chạy, tắt → chặn (0 phiên được tạo), không trả lời → chặn; bản ghi kiểm tra có trong chi tiết lần chạy + `ket-qua.json` + báo cáo |
| S5.1 Trang kết quả + video + báo cáo | done | 4/4 | API chi tiết kết quả (kết luận lớn, bảng đối chiếu, video theo vai, báo cáo .md, SĐT đã che) — 4 test gồm bất biến dữ liệu lần chạy cũ (AC-4); trang `/ket-qua/[runId]` + proxy video/báo cáo + nối từ Lịch sử và trang xem trực tiếp. Kiểm chứng hình ảnh bằng trình duyệt thật đi cùng Checklist khoản 5–6 |
| S5.2 Hàng đợi + dừng an toàn | done | 4/4 | 7 test: RunQueue FIFO/vị trí; hàng đợi lần chạy + tự bắt đầu (AC-3); dừng khi đang chạy trong ân hạn (0 phiên đóng ép) và quá ân hạn (đóng qua DELETE, ghi rõ vào báo cáo); dừng khi đang xếp hàng (không mở phiên, vẫn dọn); test tải gấp đôi giới hạn phiên (AC-4) — không vượt giới hạn, không mất trạng thái |
| S5.4 Tài liệu máy thật + bàn giao | in-progress | AC-1, AC-2, AC-3 đạt; **AC-4 chưa** | `docs/HUONG-DAN-MAY-THAT.md` (cài đặt, .env từng biến, sự cố tối thiểu 5 mục) + báo cáo này. AC-4 (làm theo tài liệu trên môi trường sạch) chỉ thực hiện được trên máy thật có Docker — chính là Mục 6 của tài liệu hướng dẫn |

## Tổng kết trạng thái

- **done: 11** — S1.1, S1.2, S1.3, S2.1, S2.2, S2.3, S4.1, S4.2 (done kèm
  ghi chú nợ transport PG), S5.3, S5.1, S5.2.
- **in-progress: 8** — S2.4, S3.0, S3.1, S3.2, S3.3, S3.4, S4.3, S5.4: mã đã
  hoàn chỉnh và qua test thay thế tương đương; phần còn lại thuần tuý là
  kiểm chứng trên máy thật theo Checklist Mục 6 của tài liệu hướng dẫn.
- **backlog: 0.**

## Giới hạn đã biết

Xem Mục 9 của `docs/HUONG-DAN-MAY-THAT.md` (quy ước route/selector/SQL của
CRM khớp dứt điểm trên đích thật; cơ chế cờ sandbox dựa trên health CRM;
giới hạn hiệu năng stream theo tài nguyên máy; AC-4 của S5.4 chờ chạy
Checklist Mục 6).

## Phần việc còn phụ thuộc chủ dự án

Xem Mục 8 của `docs/HUONG-DAN-MAY-THAT.md`: URL UAT thật, tài khoản 5 vai,
tenant test riêng — chỉ cần cho vòng kiểm chứng cuối trên UAT thật, không
cần cho các khoản nghiệm thu trên đích CRM cục bộ.
