/**
 * Test Reconciler + 3 nguon so lieu (S4.2 AC-1..AC-4).
 * - Nguon API chay qua HTTP that (may chu gia lap CRM tren 127.0.0.1).
 * - Nguon DB dung executor gia lap tren cung "trang thai CRM gia lap" -
 *   VM khong co PostgreSQL; ban PgDbExecutor chay o may that (S5.4).
 * - Ky vong tinh tu du lieu sinh + Oracle doc lap, khong doc so dich.
 */
import { createServer, type Server } from "node:http";

import type { ScenarioDefinition } from "@autotest/scenario-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateRunData } from "./data-generator.js";
import { KiemDemService } from "./kiem-dem.js";
import { tinhBoKyVong } from "./ky-vong.js";
import {
  ApiNguonSoLieu,
  DbNguonSoLieu,
  laSqlChiDoc,
  type DbExecutor,
} from "./nguon-so-lieu.js";
import { Reconciler } from "./reconciler.js";
import type { WorkerSessionResult } from "./worker-client.js";

const RUN_ID = "AUTOTEST_20261107_001";

const generated = generateRunData({
  runId: RUN_ID,
  dataGen: {
    benhNhan: { soLuong: 2 },
    dichVu: [
      { ma: "DV-KHAM-TQ", ten: "Khám tổng quát", gia: 300000 },
      { ma: "DV-TAI-KHAM", ten: "Tái khám", gia: 200000 },
    ],
    lichHen: { soLuong: 2 },
  },
});
const khachChinh = generated.benhNhan[0];
if (!khachChinh) throw new Error("thieu benh nhan sinh");

const scenario: ScenarioDefinition = {
  schemaVersion: 1,
  id: "kich-ban-test-kiem-dem",
  ten: "Kịch bản test kiểm đếm",
  cacVai: ["benh-nhan", "le-tan", "bac-si", "thu-ngan", "quan-ly"],
  cacBuoc: [
    { id: "dat-lich", vai: "benh-nhan", hanhDong: "dat-lich-hen", duLieu: { benhNhan: "$benhNhan[0]", dichVu: "DV-KHAM-TQ" } },
    { id: "check-in", vai: "benh-nhan", hanhDong: "check-in" },
    { id: "thanh-toan", vai: "thu-ngan", hanhDong: "thanh-toan", duLieu: { benhNhan: "$benhNhan[0]" } },
    { id: "xem-bao-cao", vai: "quan-ly", hanhDong: "xem-bao-cao-doanh-thu" },
    { id: "xem-bao-cao-khach", vai: "quan-ly", hanhDong: "xem-bao-cao-doanh-thu", duLieu: { doc: "theo-khach", benhNhan: "$benhNhan[0]" } },
  ],
  kiemDem: [
    { id: "doanh-thu-ngay", ten: "Doanh thu trong ngày", nguon: ["ui", "api", "db"], kyVong: { tuDuLieuSinh: "tongGiaLichHenDaThanhToan" }, donVi: "VND" },
    { id: "doanh-thu-khach-chinh", ten: "Doanh thu khách chính", nguon: ["ui", "api", "db"], kyVong: { tuDuLieuSinh: "doanhThuKhachChinh" }, donVi: "VND" },
    { id: "so-luot-check-in", ten: "Số lượt check-in", nguon: ["ui", "api", "db"], kyVong: { tuDuLieuSinh: "soCheckIn" }, donVi: "lượt" },
  ],
};

/** Trang thai "CRM gia lap": so lieu ma he thong dich (gia) bao cao. */
const crmState = {
  tongDoanhThu: 300000,
  doanhThuKhach: 300000,
  soCheckIn: 1,
  soLichHen: 1,
  apiHong: false,
  dbHong: false,
};

function sessionResults(): WorkerSessionResult[] {
  const base = { videoPath: null, screenshots: [] as string[] };
  return [
    {
      ...base,
      sessionId: "s-bn",
      runId: RUN_ID,
      roleId: "benh-nhan",
      status: "qua",
      steps: [
        { stepId: "dat-lich", actionId: "dat-lich-hen", status: "qua", durationMs: 1, outputs: { appointment_id: "LH-CRM-1" } },
        { stepId: "check-in", actionId: "check-in", status: "qua", durationMs: 1, outputs: { check_in: 1 } },
      ],
    },
    {
      ...base,
      sessionId: "s-tn",
      runId: RUN_ID,
      roleId: "thu-ngan",
      status: "qua",
      steps: [
        { stepId: "thanh-toan", actionId: "thanh-toan", status: "qua", durationMs: 1, outputs: { invoice_id: "HD-CRM-1", so_tien: crmState.tongDoanhThu } },
      ],
    },
    {
      ...base,
      sessionId: "s-ql",
      runId: RUN_ID,
      roleId: "quan-ly",
      status: "qua",
      steps: [
        {
          stepId: "xem-bao-cao",
          actionId: "xem-bao-cao-doanh-thu",
          status: "qua",
          durationMs: 1,
          outputs: {
            tong_doanh_thu_text: `${crmState.tongDoanhThu.toLocaleString("vi-VN")} đ`,
            so_luot_check_in_text: String(crmState.soCheckIn),
          },
        },
        {
          stepId: "xem-bao-cao-khach",
          actionId: "xem-bao-cao-doanh-thu",
          status: "qua",
          durationMs: 1,
          outputs: { doanh_thu_khach_text: `${crmState.doanhThuKhach.toLocaleString("vi-VN")} đ` },
        },
      ],
    },
  ];
}

/* ------- May chu API gia lap (HTTP that) ------- */

let server: Server;
let apiBase = "";
let lastApiQuery = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/bao-cao/doanh-thu") {
      res.writeHead(404).end();
      return;
    }
    lastApiQuery = url.search;
    if (crmState.apiHong) {
      res.writeHead(500, { "content-type": "application/json" }).end("{}");
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          tongDoanhThu: crmState.tongDoanhThu,
          soLuotCheckIn: crmState.soCheckIn,
          soLichHen: crmState.soLichHen,
          theoKhachHang: [{ hoTen: khachChinh.hoTen, doanhThu: crmState.doanhThuKhach }],
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("khong lay duoc cong");
  apiBase = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* ------- Executor DB gia lap tren cung trang thai ------- */

const SQL = {
  tongDoanhThu: "SELECT tong_doanh_thu AS gia_tri FROM bao_cao WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  doanhThuKhach: "SELECT ho_ten AS khoa, doanh_thu AS gia_tri FROM bao_cao_khach WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  soCheckIn: "SELECT so_check_in AS gia_tri FROM bao_cao WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  soLichHen: "SELECT so_lich_hen AS gia_tri FROM bao_cao WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
};

const fakeDb: DbExecutor = {
  async query(text: string) {
    if (crmState.dbHong) throw new Error("connection refused (giả lập)");
    if (text === SQL.tongDoanhThu) return { rows: [{ gia_tri: crmState.tongDoanhThu }] };
    if (text === SQL.doanhThuKhach) {
      return { rows: [{ khoa: khachChinh.hoTen, gia_tri: crmState.doanhThuKhach }] };
    }
    if (text === SQL.soCheckIn) return { rows: [{ gia_tri: crmState.soCheckIn }] };
    if (text === SQL.soLichHen) return { rows: [{ gia_tri: crmState.soLichHen }] };
    throw new Error(`SQL lạ trong test: ${text}`);
  },
};

function taoDichVuKiemDem() {
  return new KiemDemService({
    api: new ApiNguonSoLieu({}),
    db: new DbNguonSoLieu(fakeDb, SQL),
    tenant: "autotest-tenant-mau",
  });
}

async function chayKiemDem() {
  const service = taoDichVuKiemDem();
  return service.kiemDem({
    run: {
      runId: RUN_ID,
      scenarioId: scenario.id,
      mode: "chay-nhanh",
      targetUrl: apiBase,
      status: "dang-chay",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      videoPath: null,
      reportPath: null,
      cleanupStatus: null,
    },
    scenario,
    generated,
    sessionResults: sessionResults(),
  });
}

function resetCrm() {
  crmState.tongDoanhThu = 300000;
  crmState.doanhThuKhach = 300000;
  crmState.soCheckIn = 1;
  crmState.soLichHen = 1;
  crmState.apiHong = false;
  crmState.dbHong = false;
}

describe("tinhBoKyVong — kỳ vọng độc lập từ dữ liệu sinh", () => {
  it("chỉ lịch được tạo VÀ thanh toán mới thành doanh thu (300.000, không phải 500.000)", () => {
    const bo = tinhBoKyVong({ scenario, generated, sessionResults: sessionResults() });
    expect(bo.oracle.tongDoanhThu).toBe(300000);
    expect(bo.khachChinh?.benhNhanId).toBe(khachChinh.id);
    expect(bo.soCheckIn).toBe(1);
    expect(bo.soLichHenDaTao).toBe(1);
  });
});

describe("Reconciler qua KiemDemService (S4.2)", () => {
  it("AC-1/AC-2: cả 3 nguồn khớp kỳ vọng ở cả 3 chỉ tiêu → bảng QUA", async () => {
    resetCrm();
    const bang = await chayKiemDem();
    expect(bang.ketQua).toBe("qua");
    expect(bang.soKhop).toBe(3);
    for (const dong of bang.cacChiTieu) {
      expect(dong.ketQua).toBe("khop");
      expect(dong.ui).toBe(dong.kyVong);
      expect(dong.api).toBe(dong.kyVong);
      expect(dong.db).toBe(dong.kyVong);
    }
    const doanhThu = bang.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(doanhThu?.kyVong).toBe(300000);
    expect(doanhThu?.ui).toBe(300000); // tu van ban "300.000 đ" qua bo phan tich
    // API nhan du tham so loc: ngay + tenant + runId.
    expect(lastApiQuery).toContain("tuNgay=2026-11-07");
    expect(lastApiQuery).toContain("tenant=autotest-tenant-mau");
    expect(lastApiQuery).toContain(`runId=${RUN_ID}`);
  });

  it("AC-2: lệch ở UI (báo cáo hiện 250.000 đ) → chỉ tiêu lệch đúng độ lệch, bảng HỎNG", async () => {
    resetCrm();
    crmState.tongDoanhThu = 250000; // UI + API + DB cung lech trong gia lap nay
    const bang = await chayKiemDem();
    const dong = bang.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(dong?.ketQua).toBe("lech");
    expect(dong?.doLech.ui).toBe(-50000);
    expect(bang.ketQua).toBe("hong");
  });

  it("AC-2: chỉ DB lệch (UI/API khớp) → vẫn lệch và chỉ rõ nguồn DB", async () => {
    resetCrm();
    const dbLech: DbExecutor = {
      async query(text: string) {
        if (text === SQL.tongDoanhThu) return { rows: [{ gia_tri: 200000 }] };
        return fakeDb.query(text, []);
      },
    };
    const service = new KiemDemService({
      api: new ApiNguonSoLieu({}),
      db: new DbNguonSoLieu(dbLech, SQL),
      tenant: "autotest-tenant-mau",
    });
    const bang = await service.kiemDem({
      run: {
        runId: RUN_ID, scenarioId: scenario.id, mode: "chay-nhanh", targetUrl: apiBase,
        status: "dang-chay", startedAt: new Date().toISOString(), finishedAt: null,
        videoPath: null, reportPath: null, cleanupStatus: null,
      },
      scenario, generated, sessionResults: sessionResults(),
    });
    const dong = bang.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(dong?.ketQua).toBe("lech");
    expect(dong?.ui).toBe(300000);
    expect(dong?.api).toBe(300000);
    expect(dong?.db).toBe(200000);
    expect(dong?.doLech).toEqual({ db: -100000 });
    expect(bang.ketQua).toBe("hong");
  });

  it("AC-4: DB không nối được → 'Không kiểm chứng được nguồn DB', bảng HỎNG", async () => {
    resetCrm();
    crmState.dbHong = true;
    const bang = await chayKiemDem();
    expect(bang.ketQua).toBe("hong");
    expect(bang.soKhongKiemChung).toBe(3);
    for (const dong of bang.cacChiTieu) {
      expect(dong.ketQua).toBe("khong-kiem-chung-duoc");
      expect(dong.ghiChu.some((g) => g.includes("Không kiểm chứng được nguồn DB"))).toBe(true);
      // UI va API van doc duoc va khop - chi DB la khong kiem chung duoc.
      expect(dong.ui).toBe(dong.kyVong);
      expect(dong.api).toBe(dong.kyVong);
      expect(dong.db).toBeNull();
    }
  });

  it("AC-4: API trả 500 → các chỉ tiêu có nguồn api không kiểm chứng được", async () => {
    resetCrm();
    crmState.apiHong = true;
    const bang = await chayKiemDem();
    expect(bang.ketQua).toBe("hong");
    const dong = bang.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(dong?.ketQua).toBe("khong-kiem-chung-duoc");
    expect(dong?.ghiChu.some((g) => g.includes("nguồn API") && g.includes("500"))).toBe(true);
  });

  it("AC-3: số trên UI không phân tích được → không kiểm chứng được, nêu rõ văn bản gốc", async () => {
    resetCrm();
    const service = taoDichVuKiemDem();
    const results = sessionResults().map((s) =>
      s.roleId === "quan-ly"
        ? {
            ...s,
            steps: s.steps.map((st) =>
              st.stepId === "xem-bao-cao"
                ? { ...st, outputs: { ...st.outputs, tong_doanh_thu_text: "chưa có dữ liệu" } }
                : st,
            ),
          }
        : s,
    );
    const bang = await service.kiemDem({
      run: {
        runId: RUN_ID, scenarioId: scenario.id, mode: "chay-nhanh", targetUrl: apiBase,
        status: "dang-chay", startedAt: new Date().toISOString(), finishedAt: null,
        videoPath: null, reportPath: null, cleanupStatus: null,
      },
      scenario, generated, sessionResults: results,
    });
    const dong = bang.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(dong?.ketQua).toBe("khong-kiem-chung-duoc");
    expect(dong?.ghiChu.some((g) => g.includes("chưa có dữ liệu"))).toBe(true);
    expect(bang.ketQua).toBe("hong");
  });

  it("kỳ vọng không tính được (khóa lạ) → chỉ tiêu không kiểm chứng được, không đoán", async () => {
    resetCrm();
    const scenarioLa: ScenarioDefinition = {
      ...scenario,
      kiemDem: [
        { id: "doanh-thu-ngay", ten: "Lạ", nguon: ["ui"], kyVong: { tuDuLieuSinh: "khoa-khong-ton-tai" } },
      ],
    };
    const reconciler = new Reconciler([]);
    const bo = tinhBoKyVong({ scenario, generated, sessionResults: sessionResults() });
    const bang = await reconciler.doiChieu({
      runId: RUN_ID, ngay: "2026-11-07", nhanDienTest: `AUTOTEST_${RUN_ID}`,
      tenant: "autotest-tenant-mau", targetBaseUrl: apiBase,
      metrics: scenarioLa.kiemDem ?? [], boKyVong: bo, generated,
    });
    expect(bang.cacChiTieu[0]?.ketQua).toBe("khong-kiem-chung-duoc");
    expect(bang.cacChiTieu[0]?.ghiChu[0]).toContain("khoa-khong-ton-tai");
  });
});

describe("DbNguonSoLieu — cổng an toàn chỉ-đọc", () => {
  it("laSqlChiDoc chỉ chấp nhận SELECT/WITH", () => {
    expect(laSqlChiDoc("SELECT 1")).toBe(true);
    expect(laSqlChiDoc("  -- ghi chu\nWITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(laSqlChiDoc("UPDATE bao_cao SET x = 1")).toBe(false);
    expect(laSqlChiDoc("DELETE FROM bao_cao")).toBe(false);
  });

  it("cấu hình SQL ghi bị từ chối ngay khi khởi tạo nguồn DB", () => {
    expect(
      () => new DbNguonSoLieu(fakeDb, { tongDoanhThu: "DELETE FROM lich_hen" }),
    ).toThrow(/chỉ-đọc/);
  });

  it("chưa cấu hình executor → nguồn DB báo không kiểm chứng được (AC-4)", async () => {
    const nguon = new DbNguonSoLieu(null, SQL);
    const ketQua = await nguon.doc("tong-doanh-thu", {
      runId: RUN_ID, ngay: "2026-11-07", nhanDienTest: `AUTOTEST_${RUN_ID}`,
      tenant: "autotest-tenant-mau", targetBaseUrl: apiBase, khachChinh: null,
    });
    expect(ketQua.ok).toBe(false);
    if (!ketQua.ok) expect(ketQua.lyDo).toContain("CRM_DB_READONLY_URL");
  });
});
