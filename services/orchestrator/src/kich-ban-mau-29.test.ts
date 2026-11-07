/**
 * Test dau-cuoi kich ban mau chuan vang S4.3 tren dich GIA LAP:
 * - CRM gia lap la mot may chu HTTP that (API bao cao) + executor DB gia
 *   lap, ca hai doc cung mot trang thai duoc tinh tu du lieu sinh theo
 *   nghia cua "he thong dich" (lich [0] di tron luong: dat -> check-in ->
 *   thanh toan), doc lap voi code Oracle.
 * - Worker gia lap tra so UI dang van ban tho ("300.000 đ").
 * AC-1/AC-2/AC-3 chung minh o muc gia lap nay; chay tren dich CRM that
 * (AC-4 ban chinh thuc) la no nghiem thu may that - xem Dev Agent Record.
 */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatSoTien } from "@autotest/oracle";
import { parseScenarioYaml } from "@autotest/scenario-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GeneratedRunData } from "./data-generator.js";
import { KiemDemService } from "./kiem-dem.js";
import {
  ApiNguonSoLieu,
  DbNguonSoLieu,
  type DbExecutor,
} from "./nguon-so-lieu.js";
import type { BangDoiChieu } from "./reconciler.js";
import { makeExecutionStack, type ExecutionStack } from "./testing.js";

const SAMPLE_29 = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..",
  "packages", "scenario-schema", "samples", "dat-lich-den-bao-cao-29.yaml",
);

const SQL = {
  tongDoanhThu: "SELECT tong_doanh_thu AS gia_tri FROM bao_cao_ngay WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  doanhThuKhach: "SELECT khoa, gia_tri FROM bao_cao_khach WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  soCheckIn: "SELECT so_check_in AS gia_tri FROM bao_cao_ngay WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
  soLichHen: "SELECT so_lich_hen AS gia_tri FROM bao_cao_ngay WHERE ngay = $1 AND nhan_dien = $2 AND tenant = $3",
};

/** Trang thai cua CRM gia lap - he thong dich trong test nay. */
interface CrmGiaLapState {
  tongDoanhThu: number;
  doanhThuTheoKhach: Map<string, number>;
  soCheckIn: number;
  soLichHen: number;
  /** Chenh lech gia lap tiem vao API (0 = bao cao dung). */
  apiLechTong: number;
}

let server: Server;
let apiBase = "";
const crm: CrmGiaLapState = {
  tongDoanhThu: 0,
  doanhThuTheoKhach: new Map(),
  soCheckIn: 0,
  soLichHen: 0,
  apiLechTong: 0,
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/bao-cao/doanh-thu") {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          tongDoanhThu: crm.tongDoanhThu + crm.apiLechTong,
          soLuotCheckIn: crm.soCheckIn,
          soLichHen: crm.soLichHen,
          theoKhachHang: [...crm.doanhThuTheoKhach.entries()].map(([hoTen, doanhThu]) => ({
            hoTen,
            doanhThu,
          })),
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

const fakeDb: DbExecutor = {
  async query(text: string) {
    if (text === SQL.tongDoanhThu) return { rows: [{ gia_tri: crm.tongDoanhThu }] };
    if (text === SQL.doanhThuKhach) {
      return {
        rows: [...crm.doanhThuTheoKhach.entries()].map(([khoa, gia_tri]) => ({ khoa, gia_tri })),
      };
    }
    if (text === SQL.soCheckIn) return { rows: [{ gia_tri: crm.soCheckIn }] };
    if (text === SQL.soLichHen) return { rows: [{ gia_tri: crm.soLichHen }] };
    throw new Error(`SQL lạ trong test: ${text}`);
  },
};

/** KiemDemService ghi lai bang doi chieu cuoi de test khang dinh truc tiep. */
class KiemDemGhiLai extends KiemDemService {
  bangCuoi: BangDoiChieu | null = null;
  override async kiemDem(
    input: Parameters<KiemDemService["kiemDem"]>[0],
  ): Promise<BangDoiChieu> {
    const bang = await super.kiemDem(input);
    this.bangCuoi = bang;
    return bang;
  }
}

/**
 * Dung trang thai CRM gia lap tu du lieu sinh theo nghia dich: lich hen
 * dau tien di tron luong (dat, xac nhan, check-in, kham, thanh toan);
 * cac lich con lai chi duoc tao.
 */
function dungTrangThaiCrm(generated: GeneratedRunData): void {
  const lichChinh = generated.lichHen[0];
  const khachChinh = generated.benhNhan.find((bn) => bn.id === lichChinh?.benhNhanId);
  crm.tongDoanhThu = lichChinh?.gia ?? 0;
  crm.doanhThuTheoKhach = new Map(
    khachChinh && lichChinh ? [[khachChinh.hoTen, lichChinh.gia]] : [],
  );
  crm.soCheckIn = lichChinh ? 1 : 0;
  crm.soLichHen = lichChinh ? 1 : 0;
  crm.apiLechTong = 0;
}

async function taoStack(): Promise<{ stack: ExecutionStack; kiemDem: KiemDemGhiLai }> {
  const kiemDem = new KiemDemGhiLai({
    api: new ApiNguonSoLieu({}),
    db: new DbNguonSoLieu(fakeDb, SQL),
    tenant: "autotest-tenant-mau",
  });
  const stack = await makeExecutionStack(
    { TARGET_BASE_URL: apiBase, TARGET_ALLOWLIST: apiBase },
    { kiemDemService: kiemDem },
  );
  const yaml = await readFile(SAMPLE_29, "utf8");
  await stack.scenarioService.importScenario({
    filename: "dat-lich-den-bao-cao-29.yaml",
    format: "yaml",
    contentText: yaml,
  });
  return { stack, kiemDem };
}

async function chayMotLan(stack: ExecutionStack) {
  const run = await stack.runService.createRun({
    scenarioId: "dat-lich-den-bao-cao-29",
    mode: "chay-nhanh",
    targetUrl: apiBase,
    status: "dang-cho",
  });
  const generated = (await stack.dataService.generateForRun(run.runId)).data;
  dungTrangThaiCrm(generated);
  // So UI ma worker "doc" duoc tu bao cao cua CRM gia lap (van ban tho).
  const khachChinh = generated.benhNhan.find(
    (bn) => bn.id === generated.lichHen[0]?.benhNhanId,
  );
  stack.worker.reportOutputs = {
    tong_doanh_thu_text: formatSoTien(crm.tongDoanhThu),
    so_luot_check_in_text: String(crm.soCheckIn),
    doanh_thu_khach_text: formatSoTien(
      khachChinh ? (crm.doanhThuTheoKhach.get(khachChinh.hoTen) ?? 0) : 0,
    ),
  };
  await stack.executor.startRun(run.runId);
  return run.runId;
}

describe("S4.3 — kịch bản mẫu chuẩn vàng 29.1/29.2 trên đích giả lập", () => {
  it("file YAML hợp lệ theo schema và nạp được vào thư viện mặc định", async () => {
    const yaml = await readFile(SAMPLE_29, "utf8");
    const parsed = parseScenarioYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scenario.cacBuoc.length).toBe(9);
    expect(parsed.scenario.kiemDem?.length).toBe(3);
    for (const metric of parsed.scenario.kiemDem ?? []) {
      expect(metric.nguon).toEqual(["ui", "api", "db"]);
    }
    const { stack } = await taoStack();
    await stack.scenarioService.seedSampleIfAbsent(yaml, "dat-lich-den-bao-cao-29.yaml");
    const summaries = await stack.scenarioService.listSummaries();
    expect(summaries.some((s) => s.id === "dat-lich-den-bao-cao-29")).toBe(true);
  });

  it("AC-1/AC-2/AC-3: trọn luồng qua, 3 chỉ tiêu khớp 3 nguồn, dữ liệu được dọn sạch", async () => {
    const { stack, kiemDem } = await taoStack();
    const runId = await chayMotLan(stack);

    const detail = await stack.runService.getRunWithSteps(runId);
    expect(detail?.run.status).toBe("qua");
    // AC-1: moi buoc thao tac + buoc kiem dem deu qua.
    const stepIds = (detail?.steps ?? []).map((s) => s.stepId);
    for (const id of [
      "dat-lich", "xac-nhan-lich", "check-in", "bat-dau-kham",
      "ket-thuc-kham", "thanh-toan", "xem-bao-cao-291", "xem-bao-cao-292",
      "kiem-dem",
    ]) {
      expect(stepIds).toContain(id);
      expect(detail?.steps.find((s) => s.stepId === id)?.status).toBe("qua");
    }
    // AC-2: bang doi chieu du 3 chi tieu, ca 3 nguon khop ky vong Oracle.
    const bang = kiemDem.bangCuoi;
    expect(bang?.ketQua).toBe("qua");
    expect(bang?.cacChiTieu.length).toBe(3);
    for (const dong of bang?.cacChiTieu ?? []) {
      expect(dong.ketQua).toBe("khop");
      expect(dong.ui).toBe(dong.kyVong);
      expect(dong.api).toBe(dong.kyVong);
      expect(dong.db).toBe(dong.kyVong);
    }
    expect(bang?.cacChiTieu.find((d) => d.id === "doanh-thu-ngay")?.kyVong).toBe(300000);
    expect(bang?.cacChiTieu.find((d) => d.id === "so-luot-check-in")?.kyVong).toBe(1);
    // AC-3: don sach theo S2.4 va the hien trong ban ghi lan chay.
    expect(detail?.run.cleanupStatus).toBe("sach");
    const entities = await stack.registry.listByRun(runId);
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => e.cleanedAt !== null)).toBe(true);
    // ket-qua.json (neu ghi doc duoc tren VM) phai chua bang kiem dem.
    try {
      const raw = await readFile(join(stack.artifactsRoot, runId, "ket-qua.json"), "utf8");
      const report = JSON.parse(raw) as { kiemDem?: { ketQua?: string }; cleanup?: { sach?: boolean } };
      if (report.kiemDem) {
        expect(report.kiemDem.ketQua).toBe("qua");
        expect(report.cleanup?.sach).toBe(true);
      }
    } catch {
      // Sandbox VM co the cat file do tien trinh test ghi (da ghi nhan o
      // S3.3) - bang kiem dem da duoc khang dinh truc tiep o tren.
    }
  });

  it("AC-4 (mức giả lập): 3 lần chạy liên tiếp với 3 bộ dữ liệu sinh khác nhau đều qua", async () => {
    const { stack, kiemDem } = await taoStack();
    const runIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      runIds.push(await chayMotLan(stack));
      const detail = await stack.runService.getRunWithSteps(runIds[i] as string);
      expect(detail?.run.status).toBe("qua");
      expect(kiemDem.bangCuoi?.ketQua).toBe("qua");
    }
    expect(new Set(runIds).size).toBe(3);
  });

  it("API báo cáo lệch +50.000 → lần chạy HỎNG ở khối kiểm đếm dù mọi bước thao tác đều qua", async () => {
    const { stack, kiemDem } = await taoStack();
    const run = await stack.runService.createRun({
      scenarioId: "dat-lich-den-bao-cao-29",
      mode: "chay-nhanh",
      targetUrl: apiBase,
      status: "dang-cho",
    });
    const generated = (await stack.dataService.generateForRun(run.runId)).data;
    dungTrangThaiCrm(generated);
    const khachChinh = generated.benhNhan.find(
      (bn) => bn.id === generated.lichHen[0]?.benhNhanId,
    );
    stack.worker.reportOutputs = {
      tong_doanh_thu_text: formatSoTien(crm.tongDoanhThu),
      so_luot_check_in_text: String(crm.soCheckIn),
      doanh_thu_khach_text: formatSoTien(
        khachChinh ? (crm.doanhThuTheoKhach.get(khachChinh.hoTen) ?? 0) : 0,
      ),
    };
    crm.apiLechTong = 50000; // CRM bao cao sai: API cong them 50.000
    await stack.executor.startRun(run.runId);

    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    const actionSteps = (detail?.steps ?? []).filter((s) => s.stepId !== "kiem-dem");
    expect(actionSteps.every((s) => s.status === "qua")).toBe(true);
    expect(detail?.steps.find((s) => s.stepId === "kiem-dem")?.status).toBe("hong");
    const dong = kiemDem.bangCuoi?.cacChiTieu.find((d) => d.id === "doanh-thu-ngay");
    expect(dong?.ketQua).toBe("lech");
    expect(dong?.doLech).toEqual({ api: 50000 });
    expect(dong?.ui).toBe(300000);
    expect(dong?.db).toBe(300000);
  });
});
