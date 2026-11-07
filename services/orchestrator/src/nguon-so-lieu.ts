/**
 * Ba nguon so lieu bi doi chieu cua Reconciler (S4.2 AC-1):
 * - UI: so hien thi tren giao dien bao cao, do worker doc qua buoc
 *   xem-bao-cao-doanh-thu (van ban tho chay qua bo phan tich dung chung
 *   cua @autotest/oracle - AC-3).
 * - API: API bao cao cua CRM tren dich kiem thu (HTTP that).
 * - DB: truy van CHI DOC truc tiep DB cua dich kiem thu, qua cau hinh
 *   rieng, loc theo run_id/tenant test va ngay cua kich ban (AC-1).
 * Moi nguon doc lap: doc khong duoc tra { ok: false, lyDo } de
 * Reconciler danh dau "khong kiem chung duoc" (AC-4), khong nem loi
 * lam sap ca khoi kiem dem.
 */
import { parseSoLuong, parseSoTien } from "@autotest/oracle";
import { Pool } from "pg";

import type { KhachChinh } from "./ky-vong.js";
import type { WorkerSessionResult } from "./worker-client.js";

export type LoaiChiTieu =
  | "tong-doanh-thu"
  | "doanh-thu-khach"
  | "so-check-in"
  | "so-lich-hen";

export interface BoiCanhDoc {
  runId: string;
  /** Ngay nghiep vu cua lan chay (YYYY-MM-DD, tu run_id). */
  ngay: string;
  /** Dau nhan dien du lieu test: AUTOTEST_<runId>. */
  nhanDienTest: string;
  tenant: string;
  targetBaseUrl: string;
  khachChinh: KhachChinh | null;
}

export type KetQuaDoc = { ok: true; giaTri: number } | { ok: false; lyDo: string };

export interface NguonSoLieu {
  ten: "ui" | "api" | "db";
  doc(loai: LoaiChiTieu, ctx: BoiCanhDoc): Promise<KetQuaDoc>;
}

const loi = (lyDo: string): KetQuaDoc => ({ ok: false, lyDo });

/* ------------------------------ UI ------------------------------ */

const KHOA_UI: Record<
  LoaiChiTieu,
  { khoaText: string; khoaSo: string[]; phanTich: (t: string) => number | null; moTa: string }
> = {
  "tong-doanh-thu": {
    khoaText: "tong_doanh_thu_text",
    khoaSo: ["tong_doanh_thu"],
    phanTich: parseSoTien,
    moTa: "tổng doanh thu",
  },
  "doanh-thu-khach": {
    khoaText: "doanh_thu_khach_text",
    khoaSo: ["doanh_thu_khach"],
    phanTich: parseSoTien,
    moTa: "doanh thu khách chính",
  },
  "so-check-in": {
    khoaText: "so_luot_check_in_text",
    khoaSo: ["so_luot_check_in", "so_check_in"],
    phanTich: parseSoLuong,
    moTa: "số lượt check-in",
  },
  "so-lich-hen": {
    khoaText: "so_lich_hen_text",
    khoaSo: ["so_lich_hen"],
    phanTich: parseSoLuong,
    moTa: "số lịch hẹn",
  },
};

/** Nguon UI: doc tu ket qua buoc xem bao cao ma worker da bao ve. */
export class UiNguonSoLieu implements NguonSoLieu {
  readonly ten = "ui" as const;

  constructor(private readonly sessionResults: readonly WorkerSessionResult[]) {}

  async doc(loai: LoaiChiTieu): Promise<KetQuaDoc> {
    const cauHinh = KHOA_UI[loai];
    // Uu tien phien cua vai quan-ly (vai mo bao cao), sau do moi phien khac.
    const sessions = [...this.sessionResults].sort((a, b) =>
      a.roleId === "quan-ly" ? -1 : b.roleId === "quan-ly" ? 1 : 0,
    );
    let thayBuoc = false;
    for (const session of sessions) {
      for (const step of session.steps) {
        if (step.actionId !== "xem-bao-cao-doanh-thu" || step.status !== "qua") continue;
        thayBuoc = true;
        const text = step.outputs[cauHinh.khoaText];
        if (typeof text === "string") {
          const giaTri = cauHinh.phanTich(text);
          if (giaTri === null) {
            return loi(
              `Không phân tích được ${cauHinh.moTa} trên giao diện báo cáo: '${text}'`,
            );
          }
          return { ok: true, giaTri };
        }
        for (const khoaSo of cauHinh.khoaSo) {
          const so = step.outputs[khoaSo];
          if (typeof so === "number" && Number.isFinite(so)) return { ok: true, giaTri: so };
        }
      }
    }
    return loi(
      thayBuoc
        ? `Bước xem báo cáo đã chạy nhưng không trả ${cauHinh.moTa} (thiếu outputs ${cauHinh.khoaText})`
        : "Không có bước xem-bao-cao-doanh-thu nào chạy qua để đọc số trên giao diện",
    );
  }
}

/* ------------------------------ API ------------------------------ */

export interface ApiNguonOptions {
  /** Duong dan API bao cao tren CRM, mac dinh "/api/bao-cao/doanh-thu". */
  path?: string;
  fetchFn?: typeof fetch;
}

function layTruong(body: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return body[key];
  }
  return undefined;
}

function thanhSo(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseSoTien(value);
  return null;
}

/** Nguon API: goi API bao cao cua CRM (HTTP that) va trich so theo loai. */
export class ApiNguonSoLieu implements NguonSoLieu {
  readonly ten = "api" as const;
  private readonly path: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: ApiNguonOptions = {}) {
    this.path = options.path ?? "/api/bao-cao/doanh-thu";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async layBaoCao(
    ctx: BoiCanhDoc,
  ): Promise<{ body: Record<string, unknown> } | { lyDo: string }> {
    const url =
      `${ctx.targetBaseUrl.replace(/\/$/, "")}${this.path}` +
      `?tuNgay=${encodeURIComponent(ctx.ngay)}&denNgay=${encodeURIComponent(ctx.ngay)}` +
      `&tenant=${encodeURIComponent(ctx.tenant)}&runId=${encodeURIComponent(ctx.runId)}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: "GET", headers: { accept: "application/json" } });
    } catch (error) {
      return {
        lyDo: `Không gọi được API báo cáo của CRM: ${error instanceof Error ? error.message : "lỗi mạng"}`,
      };
    }
    if (!res.ok) return { lyDo: `API báo cáo của CRM trả HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return { lyDo: "API báo cáo trả về không phải JSON hợp lệ" };
    }
    return { body };
  }

  async doc(loai: LoaiChiTieu, ctx: BoiCanhDoc): Promise<KetQuaDoc> {
    const ketQuaLay = await this.layBaoCao(ctx);
    if ("lyDo" in ketQuaLay) return loi(ketQuaLay.lyDo);
    const body = ketQuaLay.body;
    switch (loai) {
      case "tong-doanh-thu": {
        const so = thanhSo(layTruong(body, ["tongDoanhThu", "tong_doanh_thu", "tong", "total"]));
        return so === null
          ? loi("API báo cáo không có trường tổng doanh thu (tongDoanhThu)")
          : { ok: true, giaTri: so };
      }
      case "so-check-in": {
        const so = thanhSo(layTruong(body, ["soLuotCheckIn", "soCheckIn", "so_luot_check_in"]));
        return so === null
          ? loi("API báo cáo không có trường số lượt check-in (soLuotCheckIn)")
          : { ok: true, giaTri: so };
      }
      case "so-lich-hen": {
        const so = thanhSo(layTruong(body, ["soLichHen", "so_lich_hen"]));
        return so === null
          ? loi("API báo cáo không có trường số lịch hẹn (soLichHen)")
          : { ok: true, giaTri: so };
      }
      case "doanh-thu-khach": {
        if (!ctx.khachChinh) return loi("Không xác định được khách chính để đọc API theo khách");
        const danhSach = layTruong(body, ["theoKhachHang", "theo_khach_hang", "khachHang"]);
        if (!Array.isArray(danhSach)) {
          return loi("API báo cáo không có danh sách doanh thu theo khách hàng (theoKhachHang)");
        }
        for (const item of danhSach) {
          if (!item || typeof item !== "object") continue;
          const dong = item as Record<string, unknown>;
          const khoaRaw = layTruong(dong, ["benhNhanId", "khachHangId", "id"]);
          const khoa = khoaRaw === undefined ? "" : String(khoaRaw);
          const hoTen = String(layTruong(dong, ["hoTen", "ho_ten", "ten"]) ?? "");
          const soDienThoai = String(layTruong(dong, ["soDienThoai", "so_dien_thoai"]) ?? "");
          if (
            khoa === ctx.khachChinh.benhNhanId ||
            hoTen === ctx.khachChinh.hoTen ||
            (soDienThoai !== "" && soDienThoai === ctx.khachChinh.soDienThoai)
          ) {
            const so = thanhSo(layTruong(dong, ["doanhThu", "tong", "soTien", "tongDoanhThu"]));
            return so === null
              ? loi("Dòng doanh thu của khách chính trên API không có số tiền hợp lệ")
              : { ok: true, giaTri: so };
          }
        }
        // Danh sach co nhung khong co dong cua khach chinh: doanh thu = 0.
        return { ok: true, giaTri: 0 };
      }
    }
  }
}

/* ------------------------------ DB ------------------------------ */

export interface DbExecutor {
  query(text: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close?(): Promise<void>;
}

/** Chi chap nhan cau truy van bat dau bang SELECT/WITH (sau khi bo comment). */
export function laSqlChiDoc(sql: string): boolean {
  const sach = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .toLowerCase();
  return sach.startsWith("select") || sach.startsWith("with");
}

export interface DbSqlTemplates {
  tongDoanhThu?: string;
  doanhThuKhach?: string;
  soCheckIn?: string;
  soLichHen?: string;
}

const SQL_THEO_LOAI: Record<LoaiChiTieu, keyof DbSqlTemplates> = {
  "tong-doanh-thu": "tongDoanhThu",
  "doanh-thu-khach": "doanhThuKhach",
  "so-check-in": "soCheckIn",
  "so-lich-hen": "soLichHen",
};

/**
 * Nguon DB: chay cau SQL cau hinh san (chi doc) tren DB cua dich.
 * Tham so theo thu tu: $1 ngay (YYYY-MM-DD), $2 nhan dien test
 * (AUTOTEST_<runId>), $3 tenant, $4 id khach chinh, $5 ho ten khach
 * chinh, $6 so dien thoai khach chinh. Ket qua doc o cot "gia_tri";
 * rieng doanh thu theo khach co the tra nhieu dong kem cot "khoa".
 */
export class DbNguonSoLieu implements NguonSoLieu {
  readonly ten = "db" as const;

  constructor(
    private readonly executor: DbExecutor | null,
    private readonly sql: DbSqlTemplates,
  ) {
    for (const [ten, cauSql] of Object.entries(sql)) {
      if (cauSql !== undefined && !laSqlChiDoc(cauSql)) {
        throw new Error(
          `Cấu hình SQL cho nguồn DB (${ten}) không phải câu chỉ-đọc SELECT/WITH — từ chối dùng`,
        );
      }
    }
  }

  async doc(loai: LoaiChiTieu, ctx: BoiCanhDoc): Promise<KetQuaDoc> {
    if (!this.executor) {
      return loi("Chưa cấu hình CRM_DB_READONLY_URL — không đọc được nguồn DB");
    }
    const cauSql = this.sql[SQL_THEO_LOAI[loai]];
    if (!cauSql) {
      return loi(`Chưa cấu hình câu SQL đọc ${loai} từ DB của đích kiểm thử`);
    }
    let rows: Array<Record<string, unknown>>;
    try {
      const res = await this.executor.query(cauSql, [
        ctx.ngay,
        ctx.nhanDienTest,
        ctx.tenant,
        ctx.khachChinh?.benhNhanId ?? "",
        ctx.khachChinh?.hoTen ?? "",
        ctx.khachChinh?.soDienThoai ?? "",
      ]);
      rows = res.rows;
    } catch (error) {
      return loi(
        `Không truy vấn được DB của đích kiểm thử: ${error instanceof Error ? error.message : "lỗi không rõ"}`,
      );
    }
    if (loai === "doanh-thu-khach" && rows.some((r) => "khoa" in r)) {
      if (!ctx.khachChinh) return loi("Không xác định được khách chính để đọc DB theo khách");
      const dong = rows.find(
        (r) =>
          String(r.khoa) === ctx.khachChinh?.benhNhanId ||
          String(r.khoa) === ctx.khachChinh?.hoTen ||
          String(r.khoa) === ctx.khachChinh?.soDienThoai,
      );
      if (!dong) return { ok: true, giaTri: 0 };
      const so = thanhSo(dong.gia_tri);
      return so === null
        ? loi("Dòng doanh thu của khách chính trong DB không có gia_tri hợp lệ")
        : { ok: true, giaTri: so };
    }
    const dongDau = rows[0];
    if (!dongDau) return loi("Truy vấn DB không trả dòng nào cho chỉ tiêu này");
    const so = thanhSo(dongDau.gia_tri ?? Object.values(dongDau)[0]);
    return so === null
      ? loi("Kết quả DB không có cột gia_tri hợp lệ cho chỉ tiêu này")
      : { ok: true, giaTri: so };
  }
}

/** Executor PostgreSQL that: moi truy van chay trong giao dich CHI DOC. */
export class PgDbExecutor implements DbExecutor {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query(text: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      try {
        const res = await client.query(text, params as unknown[]);
        return { rows: res.rows as Array<Record<string, unknown>> };
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
