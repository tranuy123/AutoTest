# Hướng dẫn cài đặt và chạy AutoTest trên máy thật

Tài liệu này dành cho chủ dự án: cài AutoTest từ đầu trên máy thật của mình,
chạy kịch bản mẫu đầu tiên, và — quan trọng nhất — **chạy một lượt checklist
nghiệm thu ở Mục 6** để đóng toàn bộ các khoản kiểm chứng còn nợ từ quá trình
phát triển (những phần không chạy được trên máy ảo phát triển vì thiếu Docker,
Chrome và PostgreSQL thật).

Mọi lệnh trong tài liệu đều copy-paste được. Đường dẫn tương đối tính từ thư
mục gốc của repo AutoTest.

---

## Mục 1 — Yêu cầu máy thật

| Hạng mục | Tối thiểu | Khuyến nghị |
|---|---|---|
| Hệ điều hành | Windows 11 / macOS / Linux có Docker Desktop hoặc Docker Engine | Linux hoặc Windows 11 + Docker Desktop |
| Docker | Docker Engine 24+ và Docker Compose v2 (`docker compose version` chạy được) | Bản mới nhất |
| RAM | 8 GB | 16 GB (5 phiên Chrome chạy song song + đối chiếu) |
| Dung lượng trống | 15 GB | 25 GB (image Docker, Chromium của Playwright, video các lần chạy) |
| CPU | 4 nhân | 8 nhân |
| Mạng | Truy cập được tới UAT của CRM_Loyalty | — |

Chế độ phát triển không Docker (chỉ khi cần sửa code): Node.js ≥ 22 và pnpm 11
(`corepack enable && corepack prepare pnpm@11 --activate`).

---

## Mục 2 — Cài đặt từ đầu

> **Windows — đường nhanh:** clone repo xong **double-click `SETUP.bat`** ở
> thư mục gốc. Script tự làm các việc của Mục 2 + Mục 4 (kiểm tra/cài Docker
> Desktop và Node.js qua winget nếu thiếu, `pnpm install`, tạo `.env`, mở
> Notepad để điền, `docker compose up -d --build`, chờ healthy rồi mở sẵn
> http://localhost:3100). Sau khi script chạy xong, quay lại Mục 3 để đối
> chiếu từng biến `.env` và tiếp tục từ Mục 5. Nội dung script nằm ở
> `scripts/setup.ps1`, đọc trước nếu muốn biết rõ từng bước.

```bash
git clone https://github.com/tranuy123/AutoTest.git
cd AutoTest
git checkout phat-trien/mvp   # hoặc main sau khi PR bàn giao được duyệt
```

Cài dependencies và build thử một lượt ở chế độ phát triển (bước này cũng cập
nhật `pnpm-lock.yaml` cho hai gói được bổ sung sau lần cài đầu tiên trên máy ảo
phát triển: `@autotest/oracle` và `@novnc/novnc`):

```bash
corepack enable && corepack prepare pnpm@11 --activate
pnpm install
pnpm -r build
```

Kết quả mong đợi: `pnpm install` kết thúc không lỗi; `pnpm -r build` báo Done
cho cả 5 gói (scenario-schema, oracle, orchestrator, runner, control).

> Lưu ý: gói `@autotest/scenario-schema` phải được build từ mã nguồn trên máy
> thật (`pnpm -r build` ở trên đã gồm bước này) — bản `dist/` sao chép từ máy
> ảo phát triển từng bị hỏng do giới hạn ghi file của môi trường đó; mã nguồn
> không bị ảnh hưởng.

---

## Mục 3 — Tạo file `.env` và ý nghĩa từng biến

```bash
cp .env.example .env
```

Mở `.env` và điền theo bảng dưới đây. **Không bao giờ commit file `.env`.**

### 3.1. Cổng dịch vụ (giữ mặc định nếu không có lý do đổi)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CONTROL_PORT` | `3100` | Cổng Control App (giao diện web) |
| `ORCHESTRATOR_PORT` | `3101` | Cổng Orchestrator (API điều phối) |
| `RUNNER_PORT` | `3102` | Cổng Worker/Stream Gateway |
| `ORCHESTRATOR_URL` | `http://localhost:3101` | URL Control dùng để gọi Orchestrator |
| `STREAM_GATEWAY_WS_URL` | `ws://localhost:3102` | URL WebSocket trình duyệt dùng xem stream |

### 3.2. Đích kiểm thử — lấy từ quản trị UAT của CRM_Loyalty

| Biến | Điền gì | Lấy ở đâu |
|---|---|---|
| `TARGET_BASE_URL` | URL gốc của UAT, ví dụ `https://uat.phongkham.example` | Quản trị UAT CRM_Loyalty cấp |
| `TARGET_ALLOWLIST` | Danh sách origin được phép chạy, cách nhau dấu phẩy — phải chứa origin của `TARGET_BASE_URL` | Tự khai theo URL UAT ở trên. Ngoài danh sách này hệ thống **chặn cứng**, kể cả Production |
| `TEST_TENANT` | Mã tenant/chi nhánh test riêng cho AutoTest | Quản trị UAT tạo tenant test riêng (xem Mục 8) |

### 3.3. Tài khoản 5 vai trên UAT — lấy từ quản trị UAT

Mỗi vai một tài khoản thật trên UAT thuộc tenant test. Mật khẩu chỉ nằm trong
`.env` trên máy thật:

`ROLE_BENH_NHAN_USERNAME/PASSWORD`, `ROLE_LE_TAN_USERNAME/PASSWORD`,
`ROLE_BAC_SI_USERNAME/PASSWORD`, `ROLE_THU_NGAN_USERNAME/PASSWORD`,
`ROLE_QUAN_LY_USERNAME/PASSWORD`.

### 3.4. Kênh ngoài (Zalo/Facebook/SMS) — an toàn khách hàng

| Biến | Điền gì | Ý nghĩa |
|---|---|---|
| `CHANNELS_SANDBOX` | `true` | Khai báo môi trường đích đang ở sandbox kênh ngoài. Kịch bản có khai báo `kenhNgoai` chỉ được chạy khi sandbox được xác nhận (qua biến này và/hoặc cờ trong health của CRM); không xác nhận được = bị chặn (fail-closed) |
| `CRM_HEALTH_PATH` | Để trống (mặc định `/api/health`) | Đường health của CRM để hệ thống đọc cờ `sandbox` / `kenhNgoaiSandbox` / `channelsSandbox` (boolean) từ JSON trả về |

### 3.5. Giới hạn chạy và dừng an toàn

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MAX_PARALLEL_SESSIONS` | `5` | Số phiên trình duyệt chạy đồng thời tối đa; vượt quá thì xếp hàng ở tầng phiên |
| `MAX_CONCURRENT_RUNS` | `2` | Số lần chạy thực thi đồng thời tối đa; lần chạy vượt giới hạn xếp hàng "Đang chờ phiên trống" kèm vị trí hàng đợi trên giao diện |
| `STOP_GRACE_MS` | `30000` | Thời gian ân hạn khi bấm "Dừng lần chạy này": phiên đang chạy được chờ báo kết quả tự nhiên tối đa bấy lâu, quá hạn mới bị đóng và việc đóng ép được ghi rõ vào báo cáo |
| `VIEW_PACE_MS` | `400` | Nhịp nghỉ giữa các bước ở chế độ xem trực tiếp (để mắt người theo kịp) |
| `VIDEO_KEEP_ON_PASS` | `false` | `true` = giữ video cả lần chạy QUA; mặc định chỉ giữ video lần chạy HỎNG và lần chạy bị DỪNG |

### 3.6. Dọn dữ liệu test trên CRM

| Biến | Điền gì | Ý nghĩa |
|---|---|---|
| `CRM_CLEANUP_PATH_TEMPLATE` | Để trống (mặc định `/api/test-data/{type}/{id}`) | Mẫu đường API xoá dữ liệu test của CRM. Nếu CRM dùng đường khác, điền mẫu đúng — xác nhận ở Mục 6, khoản 8 |
| `CRM_CLEANUP_TOKEN` | Để trống nếu CRM không yêu cầu | Token gửi kèm khi gọi API xoá dữ liệu test |

### 3.7. Nguồn số liệu kiểm đếm (Epic 4) — lấy từ schema CRM thật

| Biến | Điền gì | Ý nghĩa |
|---|---|---|
| `CRM_API_BAO_CAO_PATH` | Để trống (mặc định `/api/bao-cao/doanh-thu`) | Đường API báo cáo doanh thu của CRM; API cần trả JSON có `tongDoanhThu`, `soLuotCheckIn`, `soLichHen`, `theoKhachHang` |
| `CRM_DB_READONLY_URL` | Connection string **chỉ đọc** tới DB của đích kiểm thử | Tài khoản DB chỉ-đọc do quản trị UAT cấp riêng cho AutoTest. Để trống = nguồn DB luôn "không kiểm chứng được" |
| `CRM_DB_SQL_TONG_DOANH_THU` | Câu SQL chỉ đọc | Kết quả đọc ở cột `gia_tri`; tham số: `$1` ngày (YYYY-MM-DD), `$2` nhận diện test `AUTOTEST_<runId>`, `$3` tenant, `$4` id khách chính, `$5` họ tên, `$6` số điện thoại |
| `CRM_DB_SQL_DOANH_THU_KHACH` | Câu SQL chỉ đọc | Như trên; có thể trả nhiều dòng kèm cột `khoa` |
| `CRM_DB_SQL_SO_CHECK_IN` | Câu SQL chỉ đọc | Đếm lượt check-in của dữ liệu test trong ngày |
| `CRM_DB_SQL_SO_LICH_HEN` | Câu SQL chỉ đọc | Đếm lịch hẹn của dữ liệu test trong ngày |

### 3.8. Các biến còn lại

| Biến | Ý nghĩa |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | DB nội bộ của AutoTest trong Docker — **đổi mật khẩu mẫu** trước khi chạy thật |
| `DATABASE_URL` | Connection string của Orchestrator tới DB nội bộ (khi chạy không Docker) |
| `BANNED_DATA_FILE` | (Không bắt buộc) Đường tới file JSON `{"names": [...], "phones": [...]}` danh sách dữ liệu thật bị cấm — bộ sinh dữ liệu sẽ từ chối nếu sinh trùng |
| `AUTOTEST_DATA_DIR` | Thư mục lưu artifact lần chạy (video, ảnh, `ket-qua.json`); trong Docker là volume `run_data` tại `/data` |

---

## Mục 4 — Chạy hệ thống bằng Docker Compose

```bash
docker compose up -d
docker compose ps
```

Kết quả mong đợi: cả 4 service ở trạng thái `healthy`:

- `control` — giao diện web
- `orchestrator` — điều phối lần chạy
- `runner` — worker Playwright + stream
- `db` — PostgreSQL nội bộ (không publish cổng ra ngoài)

Kiểm tra nhanh:

```bash
curl http://localhost:3101/health
# → {"status":"ok","service":"@autotest/orchestrator"}
```

Mở giao diện: http://localhost:3100 — trang chủ hiện trạng thái hệ thống và
danh sách kịch bản mẫu có sẵn (`dat-lich-den-bao-cao`,
`dat-lich-den-bao-cao-29`).

Dừng hệ thống: `docker compose down` (thêm `-v` nếu muốn xoá cả DB nội bộ).

---

## Mục 5 — Chạy kịch bản mẫu đầu tiên và đọc trang kết quả

Điều kiện: đích CRM kiểm thử đã dựng (bản CRM_Loyalty chạy cục bộ hoặc UAT —
xem Mục 6 khoản 4 và Mục 8), `.env` đã điền đủ tài khoản 5 vai và allowlist.

1. Mở http://localhost:3100.
2. Ở **Bước 2 — Chọn kịch bản**, chọn `dat-lich-den-bao-cao` (kịch bản mẫu:
   Bệnh nhân đặt lịch → Lễ tân xác nhận → check-in → Bác sĩ khám → Thu ngân
   thanh toán → Quản lý xem báo cáo).
3. Chọn chế độ **Xem trực tiếp**, bấm **Bắt đầu chạy**. App chuyển sang trang
   lần chạy: 5 ô stream hiện thao tác của 5 vai cùng lúc (chuột, click, gõ
   phím, cuộn trang). Nếu tài nguyên đang bận, trang hiện "Đang chờ phiên
   trống — vị trí N trong hàng đợi" thay vì báo lỗi; cần dừng giữa chừng thì
   bấm **Dừng lần chạy này** (hệ thống dừng sau bước hiện tại và vẫn dọn dữ
   liệu; kết quả chốt là "Đã dừng theo yêu cầu").
4. Khi chạy xong, bấm **Mở trang kết quả** (hoặc vào **Lịch sử chạy** → dòng
   lần chạy → **Xem kết quả**). Trang kết quả gồm:
   - Kết luận lớn: "Kịch bản QUA" / "Kịch bản HỎNG — lệch N chỉ tiêu" kèm
     run_id và giờ chạy;
   - Bảng đối chiếu kiểm đếm: Kỳ vọng | Trên màn hình (UI) | Qua API | Trong
     CSDL (DB) | Kết quả từng chỉ tiêu;
   - Video phát lại theo từng vai (vai không có video ghi rõ lý do bằng chữ);
   - Các bước đã chạy, dữ liệu đầu vào (số điện thoại đã che), kết quả dọn
     dữ liệu, bản ghi kiểm tra sandbox kênh ngoài (nếu kịch bản có khai);
   - Nút **Tải báo cáo (.md)** tải file báo cáo đầy đủ; nút **Chạy lại kịch
     bản này** tạo một lần chạy mới cùng kịch bản.

---

## Mục 6 — Checklist nghiệm thu trên máy thật (chạy một lượt, đúng thứ tự)

Checklist này gom **toàn bộ** các khoản kiểm chứng còn nợ từ 15 story trước
(ghi trong Dev Agent Record của từng story). Chạy lần lượt từ khoản 1 đến
khoản 9; mỗi khoản ghi rõ lệnh và kết quả mong đợi. Khoản nào không đạt, dừng
lại xử lý theo Mục 7 trước khi đi tiếp. Sau khi cả 9 khoản đạt, các story
S3.0, S3.1, S3.2, S3.3, S3.4, S2.4, S4.3 được đóng `done` (và epic-4 đóng
`done` nhờ khoản 9).

### Khoản 1 — Cài đặt, build và Docker thật (nợ S1.1, S2.1, S3.1, S3.2)

```bash
pnpm install
pnpm -r build
docker compose up -d
docker compose ps
curl http://localhost:3101/health
```

Kết quả mong đợi:

- `pnpm install` cập nhật `pnpm-lock.yaml` cho `@autotest/oracle` và
  `@novnc/novnc`, không lỗi.
- `pnpm -r build` Done cả 5 gói — gồm build lại `@autotest/scenario-schema`
  từ mã nguồn (bản `dist/` từ máy ảo phát triển từng bị hỏng, xem Mục 2).
- `docker compose ps`: cả 4 service `healthy`.
- Mở http://localhost:3100 được; `curl` trả `{"status":"ok",...}`.

### Khoản 2 — Test PostgreSQL thật (nợ S1.3, S2.2, S2.3, S2.4, S3.3, S4.2)

Điều kiện: PostgreSQL 16 (dùng container `db` của compose hoặc một
PostgreSQL riêng cho test) và hai biến trỏ tới DB test:

```bash
export DATABASE_URL=postgres://autotest:<mat-khau>@localhost:5432/autotest
export TEST_DATABASE_URL=postgres://autotest:<mat-khau>@localhost:5432/autotest_test
pnpm --filter @autotest/orchestrator test
```

Kết quả mong đợi: toàn bộ test đạt; các test `*.pg.test.ts` **chạy thật,
không còn skip**; migration 001–006 áp dụng sạch trên DB trắng (lần chạy đầu
tiên tự áp). Đây là vòng chạy vitest chuẩn trên máy thật — trên máy ảo phát
triển các test này được chạy bằng hạ tầng thay thế tương đương và nhóm PG bị
skip có ghi chú.

### Khoản 3 — Lượt stream ổn định 60 phút (nợ S3.0, đóng AC-2 của S3.0)

```bash
cd spikes/stream
node lib/measure.js --method cdp --sessions 4 --duration 3600 --warmup 15 --label on-dinh
node lib/measure.js --method novnc --sessions 4 --duration 3600 --warmup 15 --label on-dinh
cd ../..
```

Kết quả mong đợi: thư mục `spikes/stream/results/` có thêm 2 file
`cdp-4phien-on-dinh-*.json` và `novnc-4phien-on-dinh-*.json`; bổ sung số lần
mất khung/đứt stream của 2 file này vào `spikes/stream/BAO-CAO-SPIKE.md` rồi
đóng story S3.0. (Quyết định công nghệ QD-3 = noVNC đã chốt từ ma trận đo
90 giây; khoản này chỉ còn là lượt ổn định dài.)

### Khoản 4 — Worker 1 vai trên đích CRM cục bộ thật (nợ S3.1)

Điều kiện: một bản CRM_Loyalty chạy cục bộ (seed dữ liệu mẫu, có tài khoản lễ
tân thuộc tenant test) và URL của nó nằm trong `TARGET_ALLOWLIST`.

1. Trong app, chạy kịch bản 1 vai (chỉ vai lễ tân: đăng nhập → mở trang đặt
   lịch) ở chế độ **Xem trực tiếp**.
2. Chạy lại lần 2 cùng kịch bản.

Kết quả mong đợi:

- Chrome headed mở dưới Xvnc, đăng nhập thành công, mở được trang đặt lịch.
- Trong volume `run_data`, thư mục `<run_id>/video/le-tan/` có file video và
  `<run_id>/` có ảnh cuối phiên.
- Lần 2 dùng phiên hoàn toàn mới, không dính phiên cũ (video/ảnh của lần 2
  nằm ở thư mục run_id của lần 2).
- Lệnh kèm theo đạt: `pnpm --filter @autotest/runner test`.

### Khoản 5 — Stream tích hợp: độ trễ và mất tín hiệu (nợ S3.2, S2.2)

1. Chạy 1 lần **Xem trực tiếp** từ trang chính, mở `/lan-chay/<run_id>`: xác
   nhận thấy chuột/click/gõ/cuộn trong ô stream của từng vai.
2. Đo độ trễ tích hợp theo cách của S3.0 (so mốc thời gian thao tác với hình
   nhận được ở ô stream): yêu cầu **< 2 giây**.
3. Ngắt VNC của một phiên giữa chừng (dừng Xvnc của phiên đó): ô stream hiện
   "Mất tín hiệu stream — lần chạy vẫn tiếp tục", lần chạy vẫn kết thúc bình
   thường và có video xem lại ở trang kết quả.
4. Chạy kiểm thử giao diện tự động:

```bash
pnpm --filter @autotest/control test:ui
```

Kết quả mong đợi: `test:ui` đạt (gồm bước kiểm tra trang lần chạy ở chế độ
nhanh của S3.4). Sau các lần chạy ở khoản này, mở `/ket-qua/<run_id>` kiểm
tra trang kết quả hiện đúng kết luận, bảng đối chiếu và video từng vai.

### Khoản 6 — Kịch bản mẫu 5 vai trên đích CRM cục bộ thật (nợ S3.3)

1. Nạp/chọn kịch bản mẫu `dat-lich-den-bao-cao`, chạy chế độ **Xem trực
   tiếp** trên đích CRM cục bộ.

Kết quả mong đợi:

- 5 ô stream hiện đúng 5 vai cùng lúc; luồng đặt lịch → xác nhận → check-in
  → khám → thanh toán → báo cáo chạy qua trọn.
- Kiểm tra `GET http://localhost:3102/streams` (hoặc trang thái worker): có
  5 phiên worker riêng, không vai nào dùng chung phiên.

2. Chạy lại cùng kịch bản ở chế độ **chạy nhanh**: kết quả tổng tương đương
   (QUA), chỉ khác là không có stream trực tiếp.

### Khoản 7 — Đợt chạy nhanh và chính sách video vật lý (nợ S3.4)

1. Tạo một **đợt chạy nhanh ≥ 4 lần** của kịch bản mẫu trên đích CRM cục bộ.
2. Làm hỏng có chủ đích một bước trong một lần chạy riêng (ví dụ đổi
   selector của đích), chạy lần đó ở chế độ xem.
3. Mở trang của một lần chạy nhanh trong lúc đang chạy.

Kết quả mong đợi:

- Cả đợt hoàn tất; báo cáo tổng của đợt khớp đúng số lần chạy thật.
- Lần chạy hỏng có file video vật lý trong `run_data/<run_id>/video/<vai>/`;
  lần chạy QUA không còn file video (trừ khi `.env` đặt
  `VIDEO_KEEP_ON_PASS=true`).
- Trang lần chạy nhanh hiện lớp phủ "Chế độ chạy nhanh — không có stream" và
  tiến độ theo vai cập nhật trong lúc chạy.

### Khoản 8 — Dọn dữ liệu trên CRM thật (nợ S2.4)

**Xác nhận trước khi kiểm chứng:** hỏi quản trị CRM_Loyalty xem CRM có
endpoint xoá dữ liệu test theo mẫu `/api/test-data/{type}/{id}` hay không.

- Nếu CRM dùng đường khác: đặt `CRM_CLEANUP_PATH_TEMPLATE=<mẫu đường đúng>`
  trong `.env`, khởi động lại orchestrator (`docker compose up -d`), và ghi
  lại mẫu đường đúng vào tài liệu bàn giao này.

Kiểm chứng:

1. Chạy một lần chạy đầy đủ trên đích thật; sau khi chạy xong, kiểm tra trên
   CRM: các thực thể mang run_id của lần chạy đã biến mất; trang kết quả ghi
   báo cáo dọn là **sạch**.
2. Tạo dữ liệu rác giả lập cho một run_id cũ (ví dụ chạy dở một lần rồi
   dừng), sau đó dọn thủ công:

```bash
node scripts/cleanup-run.mjs <run_id>
echo $?
```

Kết quả mong đợi: mã thoát **0**, dữ liệu của run_id đó biến mất trên CRM,
dữ liệu của các lần chạy khác không bị đụng vào.

### Khoản 9 — Epic 4 trên CRM thật: cấu hình nguồn và AC-4 của S4.3 (nợ S4.2, S4.3)

Cấu hình trong `.env` (xem Mục 3.7):

- `CRM_DB_READONLY_URL` trỏ tới DB của đích kiểm thử bằng tài khoản chỉ đọc.
- Viết 4 câu `CRM_DB_SQL_TONG_DOANH_THU`, `CRM_DB_SQL_DOANH_THU_KHACH`,
  `CRM_DB_SQL_SO_CHECK_IN`, `CRM_DB_SQL_SO_LICH_HEN` theo schema thật của
  CRM_Loyalty (kết quả ở cột `gia_tri`).
- Khớp `CRM_API_BAO_CAO_PATH` và các khoá JSON API thật của CRM
  (`tongDoanhThu`, `soLuotCheckIn`, `soLichHen`, `theoKhachHang`); khớp
  selector UI của báo cáo 29.1/29.2 và các biến route `CRM_PATH_*` của
  worker nếu route thật khác quy ước mặc định.
- Nếu vòng này chạy kịch bản có khai báo `kenhNgoai`: xác nhận JSON health
  của CRM (tại `CRM_HEALTH_PATH`) có cờ sandbox dạng boolean như Mục 3.4;
  nếu CRM không trả cờ, đặt `CHANNELS_SANDBOX=true` và kiểm chứng một lần
  chạy bị chặn khi cố tình đặt `false`.

Kiểm chứng (AC-4 chính thức của S4.3):

1. Chạy kịch bản `dat-lich-den-bao-cao-29` trên đích CRM cục bộ thật ở chế
   độ xem: trọn 9 bước QUA, bảng đối chiếu 3 chỉ tiêu khớp ở cả 3 nguồn
   UI/API/DB.
2. Chạy lại **2 lần nữa liên tiếp** (tổng 3 lần): cả 3 lần đều QUA toàn bộ
   và dữ liệu được dọn sạch sau mỗi lần.

Kết quả mong đợi: 3/3 lần QUA. Nếu có lần lệch/flaky, ghi nguyên nhân vào hồ
sơ story S4.3 trước khi đóng. Đạt khoản này → đóng S4.3 và epic-4.

---

## Mục 7 — Xử lý sự cố thường gặp

### 7.1. Cổng 3100/3101 (hoặc 3102) bị chiếm

Kiểm tra tiến trình đang giữ cổng:

```bash
# Linux/macOS
lsof -i :3100 -i :3101 -i :3102
# Windows (PowerShell)
netstat -ano | findstr "3100 3101 3102"
```

Xử lý: dừng tiến trình đó, hoặc đổi cổng trong `.env` (`CONTROL_PORT`,
`ORCHESTRATOR_PORT`, `RUNNER_PORT`) rồi `docker compose up -d` lại. Lưu ý
`ORCHESTRATOR_URL` và `STREAM_GATEWAY_WS_URL` phải trỏ đúng cổng mới.

### 7.2. Container không healthy

```bash
docker compose ps
docker compose logs orchestrator --tail 100
docker compose logs runner --tail 100
docker compose logs db --tail 50
```

- `db` không healthy: kiểm tra `POSTGRES_PASSWORD` trong `.env` có khớp
  `DATABASE_URL` không; thử `docker compose down -v && docker compose up -d`
  (xoá DB nội bộ làm lại từ đầu — dữ liệu lịch sử chạy sẽ mất).
- `orchestrator` không healthy: thường do DB chưa sẵn sàng hoặc biến môi
  trường sai định dạng (URL chứa ký tự đặc biệt chưa mã hoá). Xem log dòng
  lỗi đầu tiên.
- `runner` không healthy: kiểm tra log có lỗi tải Chromium của Playwright
  không; build lại image: `docker compose build runner && docker compose up -d`.

### 7.3. Bị chặn "Không phải UAT"

Hệ thống chặn cứng theo thiết kế khi URL đích không nằm trong allowlist.
Kiểm tra: `TARGET_BASE_URL` và `TARGET_ALLOWLIST` trong `.env` — allowlist
phải chứa đúng **origin** (gồm cả `https://` và cổng nếu khác mặc định) của
URL đích. Đích là Production sẽ luôn bị chặn — đây là hành vi đúng, không có
cách mở qua giao diện.

### 7.4. Stream giật hoặc mất tín hiệu

- Trang lần chạy hiện "Mất tín hiệu stream — lần chạy vẫn tiếp tục": lần
  chạy **không** hỏng — thao tác vẫn chạy ở worker, kết quả và video xem lại
  vẫn có ở trang kết quả. Kiểm tra `docker compose logs runner` và cổng
  3102/`STREAM_GATEWAY_WS_URL`.
- Stream giật khi nhiều vai cùng chạy: giảm `MAX_PARALLEL_SESSIONS` (ví dụ
  5 → 3) hoặc tăng RAM cho Docker. Độ trễ tích hợp yêu cầu < 2 giây (Mục 6
  khoản 5).

### 7.5. Dọn dữ liệu còn sót theo run_id

Trang kết quả báo "còn sót N thực thể": xem chi tiết thực thể + lý do trong
file báo cáo .md của lần chạy, rồi dọn thủ công theo run_id:

```bash
node scripts/cleanup-run.mjs <run_id>
```

Nếu vẫn sót: kiểm tra mẫu đường xoá của CRM (Mục 6 khoản 8 —
`CRM_CLEANUP_PATH_TEMPLATE`) và token (`CRM_CLEANUP_TOKEN`); thử gọi thẳng
API xoá của CRM bằng curl để xem mã HTTP trả về (404 = thực thể đã biến mất,
coi như đã dọn; 401/403 = thiếu token; 500 = lỗi phía CRM, báo quản trị CRM).

### 7.6. Lần chạy bị chặn vì sandbox kênh ngoài

Trang kết quả/bước `kiem-tra-sandbox` ghi rõ lý do. Kiểm tra: JSON tại
`GET <TARGET_BASE_URL>/api/health` (hoặc đường ở `CRM_HEALTH_PATH`) có cờ
`sandbox`/`kenhNgoaiSandbox`/`channelsSandbox` = `true` không, và
`CHANNELS_SANDBOX` trong `.env` có đang là `true` không. Chỉ cần một tín
hiệu nói `false` là hệ thống chặn — đây là cơ chế bảo vệ khách hàng thật,
không tắt được bằng giao diện.

---

## Mục 8 — Đầu vào cần chủ dự án cấp cho vòng UAT thật

Các khoản ở Mục 6 dùng **đích CRM cục bộ** và không cần chờ ai. Riêng vòng
kiểm chứng cuối trên **UAT thật** cần chủ dự án (phối hợp quản trị
CRM_Loyalty) cấp đúng 3 đầu vào sau — đây là phần việc duy nhất còn phụ
thuộc phía dự án:

1. **URL UAT thật** của CRM_Loyalty (để điền `TARGET_BASE_URL` +
   `TARGET_ALLOWLIST`).
2. **Tài khoản cho 5 vai** trên UAT: Bệnh nhân, Lễ tân, Bác sĩ, Thu ngân,
   Quản lý (điền vào nhóm biến `ROLE_*` trong `.env`).
3. **Tenant/chi nhánh test riêng** cho AutoTest trên UAT (điền `TEST_TENANT`)
   — dữ liệu sinh của AutoTest chỉ nằm trong tenant này và luôn mang nhận
   diện `AUTOTEST_<run_id>` để dọn theo run_id.

Có đủ 3 đầu vào trên: chạy kịch bản `dat-lich-den-bao-cao-29` trên UAT thật
3 lần liên tiếp theo Mục 6 khoản 9 (thay đích cục bộ bằng URL UAT) để khép
vòng kiểm chứng cuối của chương trình.

---

## Mục 9 — Giới hạn đã biết của bản bàn giao

- Route/selector của CRM trong worker (`CRM_PATH_*`, selector báo cáo
  29.1/29.2), mẫu đường API báo cáo, các khoá JSON API và 4 câu SQL kiểm đếm
  đang là **quy ước cấu hình được** khớp theo tài liệu CRM ở thời điểm phát
  triển; chúng được khớp dứt điểm ở Mục 6 khoản 8–9 trên đích thật. Nếu CRM
  đổi giao diện/API, chỉ cần sửa cấu hình, không sửa code AutoTest.
- Cơ chế đọc cờ sandbox kênh ngoài dựa trên health JSON của CRM
  (`CRM_HEALTH_PATH`) và/hoặc biến `CHANNELS_SANDBOX`; nếu CRM không công bố
  cờ nào, kịch bản có `kenhNgoai` sẽ bị chặn cho tới khi cấu hình xác nhận
  sandbox — hành vi fail-closed theo thiết kế an toàn.
- Độ trễ stream và số phiên chạy song song ổn định phụ thuộc tài nguyên máy
  thật (RAM/CPU); số đo chuẩn tham chiếu ở `spikes/stream/BAO-CAO-SPIKE.md`.
- Bản bàn giao này **chưa từng chạy `docker compose up` trên môi trường
  sạch** — AC-4 của story S5.4 được kiểm chứng bằng chính Mục 6 của tài liệu
  này trên máy thật; chạy xong Mục 6 là hoàn tất AC-4.
