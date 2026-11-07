/**
 * Reconciler - doi chieu 3 chieu UI/API/DB voi ky vong doc lap (S4.2).
 *
 * Ket luan qua/hong cua khoi kiem dem dua tren SO THAT doi chieu duoc,
 * khong dua tren viec cac buoc thao tac co chay het hay khong:
 * - Mot chi tieu lech o BAT KY nguon nao -> chi tieu hong (AC-2).
 * - Mot nguon khong doc duoc -> chi tieu "khong kiem chung duoc" va lan
 *   chay khong duoc tinh la qua (AC-4).
 */
import type { ScenarioMetric } from "@autotest/scenario-schema";

import type { GeneratedRunData } from "./data-generator.js";
import { giaiKyVongChiTieu, KyVongError, type BoKyVong } from "./ky-vong.js";
import type { BoiCanhDoc, LoaiChiTieu, NguonSoLieu } from "./nguon-so-lieu.js";

export type KetQuaChiTieu = "khop" | "lech" | "khong-kiem-chung-duoc";

export interface DongDoiChieu {
  id: string;
  ten: string;
  donVi: string | null;
  kyVong: number | null;
  ui: number | null;
  api: number | null;
  db: number | null;
  ketQua: KetQuaChiTieu;
  /** Do lech theo nguon = so doc duoc - ky vong (chi co o nguon lech). */
  doLech: { ui?: number; api?: number; db?: number };
  ghiChu: string[];
}

export interface BangDoiChieu {
  runId: string;
  ngay: string;
  cacChiTieu: DongDoiChieu[];
  ketQua: "qua" | "hong";
  soKhop: number;
  soLech: number;
  soKhongKiemChung: number;
}

/**
 * Anh xa chi tieu kiem dem -> loai so lieu ma cac nguon doc duoc.
 * Id chuan cua thu vien kich ban duoc anh xa truc tiep; cac id tu do
 * duoc suy theo tu khoa trong id (khach / check-in / lich-hen / doanh-thu).
 */
export function loaiChiTieuCua(metric: ScenarioMetric): LoaiChiTieu | null {
  switch (metric.id) {
    case "doanh-thu-ngay":
      return "tong-doanh-thu";
    case "doanh-thu-khach-chinh":
      return "doanh-thu-khach";
    case "so-luot-check-in":
      return "so-check-in";
    case "so-lich-hen":
      return "so-lich-hen";
  }
  if (metric.id.includes("khach")) return "doanh-thu-khach";
  if (metric.id.includes("check-in")) return "so-check-in";
  if (metric.id.includes("lich-hen")) return "so-lich-hen";
  if (metric.id.includes("doanh-thu")) return "tong-doanh-thu";
  return null;
}

export class Reconciler {
  constructor(private readonly sources: readonly NguonSoLieu[]) {}

  async doiChieu(input: {
    runId: string;
    ngay: string;
    nhanDienTest: string;
    tenant: string;
    targetBaseUrl: string;
    metrics: readonly ScenarioMetric[];
    boKyVong: BoKyVong;
    generated: GeneratedRunData;
  }): Promise<BangDoiChieu> {
    const ctx: BoiCanhDoc = {
      runId: input.runId,
      ngay: input.ngay,
      nhanDienTest: input.nhanDienTest,
      tenant: input.tenant,
      targetBaseUrl: input.targetBaseUrl,
      khachChinh: input.boKyVong.khachChinh,
    };

    const cacChiTieu: DongDoiChieu[] = [];
    for (const metric of input.metrics) {
      cacChiTieu.push(await this.doiChieuMotChiTieu(metric, ctx, input));
    }

    const soKhop = cacChiTieu.filter((d) => d.ketQua === "khop").length;
    const soLech = cacChiTieu.filter((d) => d.ketQua === "lech").length;
    const soKhongKiemChung = cacChiTieu.filter(
      (d) => d.ketQua === "khong-kiem-chung-duoc",
    ).length;
    return {
      runId: input.runId,
      ngay: input.ngay,
      cacChiTieu,
      ketQua: soLech === 0 && soKhongKiemChung === 0 ? "qua" : "hong",
      soKhop,
      soLech,
      soKhongKiemChung,
    };
  }

  private async doiChieuMotChiTieu(
    metric: ScenarioMetric,
    ctx: BoiCanhDoc,
    input: { boKyVong: BoKyVong; generated: GeneratedRunData },
  ): Promise<DongDoiChieu> {
    const dong: DongDoiChieu = {
      id: metric.id,
      ten: metric.ten,
      donVi: metric.donVi ?? null,
      kyVong: null,
      ui: null,
      api: null,
      db: null,
      ketQua: "khong-kiem-chung-duoc",
      doLech: {},
      ghiChu: [],
    };

    const loai = loaiChiTieuCua(metric);
    if (!loai) {
      dong.ghiChu.push(`Chưa ánh xạ được loại số liệu cho chỉ tiêu '${metric.id}'`);
      return dong;
    }

    try {
      dong.kyVong = giaiKyVongChiTieu(metric, input.boKyVong, input.generated);
    } catch (error) {
      dong.ghiChu.push(
        error instanceof KyVongError
          ? error.message
          : `Không tính được kỳ vọng: ${error instanceof Error ? error.message : "lỗi không rõ"}`,
      );
      return dong;
    }

    let coNguonLoi = false;
    let coLech = false;
    for (const tenNguon of metric.nguon) {
      const nguon = this.sources.find((s) => s.ten === tenNguon);
      if (!nguon) {
        coNguonLoi = true;
        dong.ghiChu.push(`Chưa cấu hình nguồn ${tenNguon.toUpperCase()} cho khối kiểm đếm`);
        continue;
      }
      const ketQuaDoc = await nguon.doc(loai, ctx);
      if (!ketQuaDoc.ok) {
        coNguonLoi = true;
        dong.ghiChu.push(`Không kiểm chứng được nguồn ${tenNguon.toUpperCase()}: ${ketQuaDoc.lyDo}`);
        continue;
      }
      dong[tenNguon] = ketQuaDoc.giaTri;
      if (ketQuaDoc.giaTri !== dong.kyVong) {
        coLech = true;
        dong.doLech[tenNguon] = ketQuaDoc.giaTri - dong.kyVong;
      }
    }

    dong.ketQua = coNguonLoi ? "khong-kiem-chung-duoc" : coLech ? "lech" : "khop";
    return dong;
  }
}
