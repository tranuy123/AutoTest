/**
 * Test khoi giao dien muc co ban (S2.2 AC-2, AC-3, AC-4) - chay THAT:
 * tu khoi dong orchestrator (kho nho tam) + control app (ban build),
 * dung Playwright thao tac nhu nguoi dung:
 * 1. Mo trang chinh: thay khu 3 buoc, kich ban mau da seed.
 * 2. Nap YAML sai -> thay danh sach loi theo truong, kich ban khong vao thu vien.
 * 3. Nap YAML hop le -> kich ban xuat hien, chon che do, Bat dau chay ->
 *    tao duoc lan chay dang cho.
 * 4. Sang Thu vien: tim theo ten, xem chi tiet, xoa co xac nhan.
 * Yeu cau: da build orchestrator + control (pnpm -r build).
 * Cach chay: pnpm --filter @autotest/control test:ui
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const ORCH_PORT = 3121;
const CTRL_PORT = 3120;
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "DAT " : "HONG"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

async function waitHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* chua len */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout cho ${url}`);
    await sleep(500);
  }
}

const VALID_YAML = `schemaVersion: 1
id: kich-ban-smoke
ten: Kịch bản khói giao diện
cacVai: [le-tan, benh-nhan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
    phatSuKien: san-sang
  - id: dat-lich
    vai: benh-nhan
    hanhDong: dat-lich-hen
    choSuKien: san-sang
kiemDem:
  - id: so-lich
    ten: Số lịch hẹn
    nguon: [db]
    kyVong:
      tuDuLieuSinh: soLichHen
`;

const BAD_YAML = `schemaVersion: 1
id: kich-ban-loi-smoke
ten: Kịch bản lỗi khói
cacVai: [le-tan]
cacBuoc:
  - id: buoc-1
    vai: le-tan
    hanhDong: hanh-dong-khong-co-that
`;

const env = {
  ...process.env,
  PORT: String(ORCH_PORT),
  TARGET_BASE_URL: "https://uat.example.invalid",
  TARGET_ALLOWLIST: "https://uat.example.invalid",
  TEST_TENANT: "tenant-smoke",
  CHANNELS_SANDBOX: "true",
};
delete env.DATABASE_URL;

const orch = spawn("node", ["services/orchestrator/dist/index.js"], {
  cwd: new URL("../../..", import.meta.url).pathname,
  env,
  stdio: "pipe",
});
const ctrl = spawn("pnpm", ["--filter", "@autotest/control", "exec", "next", "start", "-p", String(CTRL_PORT)], {
  cwd: new URL("../../..", import.meta.url).pathname,
  env: { ...process.env, ORCHESTRATOR_URL: `http://127.0.0.1:${ORCH_PORT}` },
  stdio: "pipe",
});
let orchLog = "";
orch.stdout.on("data", (d) => (orchLog += d));
orch.stderr.on("data", (d) => (orchLog += d));

let browser;
try {
  await waitHttp(`http://127.0.0.1:${ORCH_PORT}/health`);
  await waitHttp(`http://127.0.0.1:${CTRL_PORT}/`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const base = `http://127.0.0.1:${CTRL_PORT}`;

  // 1) Trang chinh: khu 3 buoc + kich ban mau + nut dung chu
  await page.goto(base + "/");
  await page.getByText("Bắt đầu ở đây — 3 bước").waitFor();
  check("Trang chinh co khu 'Bat dau o day - 3 buoc'", true);
  check(
    "Nut nap dung chu 'Nạp kịch bản mới (.yaml, .xlsx)'",
    await page.getByRole("button", { name: "Nạp kịch bản mới (.yaml, .xlsx)" }).isVisible(),
  );
  await page.getByText("Đặt lịch đến báo cáo doanh thu").waitFor();
  check("Kich ban mau da seed hien tren trang chinh", true);
  check(
    "Nut 'Bat dau chay' la nut chinh lon (>= 52px)",
    (await page.getByRole("button", { name: "Bắt đầu chạy" }).boundingBox())?.height >= 52,
  );
  check(
    "Trang thai moi truong kem chu 'Đúng UAT — được phép chạy'",
    await page.getByText("Đúng UAT — được phép chạy").isVisible(),
  );

  // 2) Nap YAML sai -> loi theo truong, khong nap do dang
  await page.locator('input[type="file"]').setInputFiles({
    name: "loi.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(BAD_YAML),
  });
  await page.getByText("Kịch bản chưa hợp lệ").waitFor();
  check("Nap sai: hien thong bao chua hop le", true);
  check(
    "Nap sai: loi chi dung truong hanhDong",
    await page.locator(".danh-sach-loi").getByText(/hanhDong/).first().isVisible(),
  );
  check(
    "Nap sai: kich ban loi khong vao danh sach",
    (await page.getByText("Kịch bản lỗi khói").count()) === 0,
  );

  // 3) Nap YAML hop le -> xuat hien; chon + bat dau chay -> tao lan chay dang cho
  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(VALID_YAML),
  });
  await page.getByText(/Đã nạp kịch bản 'Kịch bản khói giao diện'/).waitFor();
  check("Nap hop le: thong bao da nap", true);
  await page.getByRole("button", { name: "Chạy kịch bản này" }).last().click();
  await page.getByText("Chạy nhanh (không xem, chạy song song)").click();
  await page.getByRole("button", { name: "Bắt đầu chạy" }).click();
  await page.getByText(/Đã tạo lần chạy AUTOTEST_\d{8}_\d{3}/).waitFor();
  check("Bat dau chay: tao duoc lan chay AUTOTEST_...", true);
  check(
    "Lan chay o trang thai 'Đang chờ chạy' (kem chu)",
    await page.getByText("Đang chờ chạy").first().isVisible(),
  );

  // 4) Thu vien: tim, chi tiet, xoa co xac nhan
  await page.goto(base + "/thu-vien");
  await page.getByText("Kịch bản khói giao diện").waitFor();
  await page.getByPlaceholder("Gõ tên kịch bản…").fill("khói");
  check(
    "Tim theo ten: con thay kich ban khoi",
    await page.getByText("Tìm thấy 1 /").isVisible(),
  );
  await page.getByPlaceholder("Gõ tên kịch bản…").fill("khong-ton-tai");
  check(
    "Tim khong thay: bao ro khong co kich ban khop",
    await page.getByText("Không có kịch bản nào khớp").isVisible(),
  );
  await page.getByPlaceholder("Gõ tên kịch bản…").fill("");
  const card = page.locator(".the", { hasText: "Kịch bản khói giao diện" });
  await card.getByRole("button", { name: "Xem chi tiết" }).click();
  await card.getByText("Các bước (2)").waitFor();
  check("Chi tiet: thay bang buoc + chi tieu kiem dem", await card.getByText("Số lịch hẹn").isVisible());
  await card.getByRole("button", { name: "Xoá kịch bản" }).click();
  await card.getByText(/Bạn có chắc muốn xoá/).waitFor();
  check("Xoa: hoi xac nhan truoc", true);
  await card.getByRole("button", { name: "Không xoá" }).click();
  check("Xoa: chon khong xoa thi kich ban con", await page.getByText("Kịch bản khói giao diện").isVisible());
  await card.getByRole("button", { name: "Xoá kịch bản" }).click();
  await card.getByRole("button", { name: "Xoá hẳn kịch bản này" }).click();
  await page.getByText(/Đã xoá kịch bản 'Kịch bản khói giao diện'/).waitFor();
  check("Xoa: xac nhan xong thi kich ban bien mat kem thong bao", true);
} catch (error) {
  check("Chay test khoi khong loi", false, String(error).slice(0, 400));
  console.log("--- log orchestrator ---\n" + orchLog.slice(-800));
} finally {
  if (browser) await browser.close().catch(() => {});
  orch.kill("SIGTERM");
  ctrl.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nTong: ${results.length - failed}/${results.length} dat`);
process.exit(process.exitCode ?? 0);
