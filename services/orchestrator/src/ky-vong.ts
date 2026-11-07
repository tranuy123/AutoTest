/**
 * Giai ky vong kiem dem tu du lieu dau vao cua lan chay (S4.2 + S4.1).
 *
 * Ky vong chi den tu hai nguon doc lap voi he thong dich:
 * 1. Bo du lieu da sinh cua lan chay (S2.3) dua qua Oracle (S4.1, AD-4).
 * 2. Ket qua cac buoc cua chinh lan chay (buoc nao da qua) do worker bao
 *    ve - day la "viec he thong da lam", khong phai so CRM bao cao.
 * So tren bao cao/API/DB cua CRM khong bao gio la nguon cua ky vong.
 */
import {
  giaoDichTuDuLieuSinh,
  tinhKyVongDoanhThu,
  type GiaoDich,
  type KyVongDoanhThu,
} from "@autotest/oracle";
import type {
  ScenarioDefinition,
  ScenarioMetric,
  ScenarioStepDef,
} from "@autotest/scenario-schema";

import type { GeneratedRunData } from "./data-generator.js";
import { resolveStepData } from "./run-executor.js";
import type { WorkerSessionResult } from "./worker-client.js";

export class KyVongError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KyVongError";
  }
}

export interface KhachChinh {
  benhNhanId: string;
  hoTen: string;
  soDienThoai: string;
}

export interface BoKyVong {
  oracle: KyVongDoanhThu;
  giaoDich: GiaoDich[];
  khachChinh: KhachChinh | null;
  /** So lich hen da tao thanh cong qua cac buoc dat-lich-hen cua lan chay. */
  soLichHenDaTao: number;
  /** So luot check-in da thuc hien qua cac buoc check-in thanh cong. */
  soCheckIn: number;
}

interface BuocDaQua {
  step: ScenarioStepDef;
  data: Record<string, string | number | boolean>;
  outputs: Record<string, string | number>;
}

/** Cac buoc cua kich ban da chay QUA, kem du lieu da giai tham chieu. */
function cacBuocDaQua(
  scenario: ScenarioDefinition,
  generated: GeneratedRunData,
  sessionResults: readonly WorkerSessionResult[],
): BuocDaQua[] {
  const outcomes = new Map<string, BuocDaQua["outputs"]>();
  for (const session of sessionResults) {
    for (const outcome of session.steps) {
      if (outcome.status === "qua") outcomes.set(outcome.stepId, outcome.outputs);
    }
  }
  const out: BuocDaQua[] = [];
  for (const step of scenario.cacBuoc) {
    const outputs = outcomes.get(step.id);
    if (!outputs) continue;
    let data: Record<string, string | number | boolean> = {};
    try {
      data = resolveStepData(step, generated);
    } catch {
      // Buoc da qua nhung khong giai duoc tham chieu: bo qua du lieu buoc,
      // cac buoc khac van duoc tinh. (Executor da bao loi neu buoc hong.)
    }
    out.push({ step, data, outputs });
  }
  return out;
}

/**
 * Xac dinh cac lich hen ma mot nhom buoc (dat-lich/huy) da tac dong:
 * uu tien tham chieu lichHen.id truc tiep; neu buoc chi tham chieu benh
 * nhan (+ dich vu) thi khop lich da sinh theo benhNhanId/dichVuMa theo
 * thu tu sinh, moi buoc mot lich chua duoc gan.
 */
function khopLichHen(
  buoc: readonly BuocDaQua[],
  generated: GeneratedRunData,
): Set<string> {
  const daGan = new Set<string>();
  const ketQua = new Set<string>();
  for (const { data } of buoc) {
    const lichId = data["lichHen.id"];
    if (typeof lichId === "string" && generated.lichHen.some((lh) => lh.id === lichId)) {
      ketQua.add(lichId);
      daGan.add(lichId);
      continue;
    }
    const benhNhanId = data["benhNhan.id"];
    if (typeof benhNhanId !== "string") continue;
    const dichVuMa = typeof data["dichVu"] === "string" ? data["dichVu"] : null;
    const ungVien = generated.lichHen.find(
      (lh) =>
        lh.benhNhanId === benhNhanId &&
        (dichVuMa === null || lh.dichVuMa === dichVuMa) &&
        !daGan.has(lh.id),
    );
    if (ungVien) {
      ketQua.add(ungVien.id);
      daGan.add(ungVien.id);
    }
  }
  return ketQua;
}

/** Tinh toan bo ky vong day du cho mot lan chay. */
export function tinhBoKyVong(input: {
  scenario: ScenarioDefinition;
  generated: GeneratedRunData;
  sessionResults: readonly WorkerSessionResult[];
}): BoKyVong {
  const { scenario, generated, sessionResults } = input;
  const daQua = cacBuocDaQua(scenario, generated, sessionResults);

  const buocDatLich = daQua.filter((b) => b.step.hanhDong === "dat-lich-hen");
  const buocThanhToan = daQua.filter((b) => b.step.hanhDong === "thanh-toan");
  const buocHuy = daQua.filter((b) => b.step.hanhDong === "huy-lich");
  const buocCheckIn = daQua.filter((b) => b.step.hanhDong === "check-in");

  const lichDaTao = khopLichHen(buocDatLich, generated);
  // Lich duoc thanh toan = lich DA TAO ma buoc thanh-toan thanh cong tro
  // toi (theo lichHen.id hoac theo benh nhan cua lich).
  const lichThanhToanTrucTiep = khopLichHen(buocThanhToan, generated);
  const benhNhanDaThanhToan = new Set(
    buocThanhToan
      .map((b) => b.data["benhNhan.id"])
      .filter((v): v is string => typeof v === "string"),
  );
  const lichDaThanhToan = new Set<string>();
  for (const lichId of lichDaTao) {
    const lh = generated.lichHen.find((x) => x.id === lichId);
    if (lh && (lichThanhToanTrucTiep.has(lichId) || benhNhanDaThanhToan.has(lh.benhNhanId))) {
      lichDaThanhToan.add(lichId);
    }
  }
  const lichDaHuy = khopLichHen(buocHuy, generated);

  // Giam gia khai bao ngay trong du lieu buoc thanh-toan (so tien / %).
  const giamTienTheoLich = new Map<string, number>();
  const giamPhanTramTheoLich = new Map<string, number>();
  for (const b of buocThanhToan) {
    const giamTien = b.step.duLieu?.giamTien;
    const giamPhanTram = b.step.duLieu?.giamPhanTram;
    if (typeof giamTien !== "number" && typeof giamPhanTram !== "number") continue;
    for (const lichId of khopLichHen([b], generated)) {
      if (!lichDaThanhToan.has(lichId)) continue;
      if (typeof giamTien === "number") giamTienTheoLich.set(lichId, giamTien);
      if (typeof giamPhanTram === "number") giamPhanTramTheoLich.set(lichId, giamPhanTram);
    }
  }

  const giaoDich = giaoDichTuDuLieuSinh(generated, {
    lichDaThanhToan,
    lichDaHuy,
    giamTienTheoLich,
    giamPhanTramTheoLich,
  });
  const oracle = tinhKyVongDoanhThu(giaoDich);

  // Khach chinh: benh nhan cua lich da thanh toan dau tien (theo thu tu
  // sinh); neu chua lich nao thanh toan thi la benh nhan dau tien da sinh.
  const lichChinh = generated.lichHen.find((lh) => lichDaThanhToan.has(lh.id));
  const benhNhanChinh =
    generated.benhNhan.find((bn) => bn.id === lichChinh?.benhNhanId) ?? generated.benhNhan[0];
  const khachChinh: KhachChinh | null = benhNhanChinh
    ? {
        benhNhanId: benhNhanChinh.id,
        hoTen: benhNhanChinh.hoTen,
        soDienThoai: benhNhanChinh.soDienThoai,
      }
    : null;

  const soCheckIn = buocCheckIn.reduce((tong, b) => {
    const tuBuoc = b.outputs.check_in;
    return tong + (typeof tuBuoc === "number" ? tuBuoc : 1);
  }, 0);
  const coBuocDatLich = scenario.cacBuoc.some((b) => b.hanhDong === "dat-lich-hen");

  return {
    oracle,
    giaoDich,
    khachChinh,
    soLichHenDaTao: coBuocDatLich ? lichDaTao.size : generated.lichHen.length,
    soCheckIn,
  };
}

/**
 * Giai mot chi tieu kiem dem thanh con so ky vong.
 * Nem KyVongError khi khong tinh duoc (khoa chua ho tro, thieu du lieu) -
 * Reconciler se danh dau chi tieu la "khong kiem chung duoc" thay vi doan.
 */
export function giaiKyVongChiTieu(
  metric: ScenarioMetric,
  bo: BoKyVong,
  generated: GeneratedRunData,
): number {
  if (metric.kyVong.giaTri !== undefined) return metric.kyVong.giaTri;
  const khoa = metric.kyVong.tuDuLieuSinh;
  switch (khoa) {
    case "tongGiaLichHen":
      return generated.thongKe.tongGiaLichHen;
    case "tongGiaLichHenDaThanhToan":
    case "doanhThuNgay":
    case "tongDoanhThu":
      return bo.oracle.tongDoanhThu;
    case "doanhThuKhachChinh": {
      if (!bo.khachChinh) {
        throw new KyVongError(
          `Chỉ tiêu '${metric.id}': không xác định được khách chính (lần chạy không có bệnh nhân nào)`,
        );
      }
      return bo.oracle.theoKhachHang[bo.khachChinh.benhNhanId] ?? 0;
    }
    case "soLichHen":
      return bo.soLichHenDaTao;
    case "soCheckIn":
    case "soLuotCheckIn":
      return bo.soCheckIn;
    default:
      throw new KyVongError(
        `Chỉ tiêu '${metric.id}': chưa hỗ trợ khóa kỳ vọng tuDuLieuSinh '${khoa ?? "(trống)"}'`,
      );
  }
}
