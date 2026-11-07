/**
 * Bo chuyen doi Excel -> YAML (S2.1 AC-3, QD-2).
 * Mau cot da tai lieu hoa trong MAU-EXCEL.md cua goi nay:
 * - Sheet "KichBan": 2 cot Khoa | GiaTri (id, ten, moTa, cacVai cach nhau
 *   dau phay, kenhNgoai cach nhau dau phay - S5.3, khong bat buoc).
 * - Sheet "Buoc": id | vai | hanhDong | choSuKien | phatSuKien | thoiGianChoGiay.
 * - Sheet "SinhDuLieu": loai | ma | ten | gia | soLuong
 *   (loai: benhNhan/lichHen chi dung soLuong; dichVu dung ma/ten/gia;
 *    phuTro: ma = loai thuc the phu, soLuong).
 * - Sheet "KiemDem": id | ten | nguon (ui,api,db cach nhau dau phay) |
 *   kyVongTuDuLieu | kyVongGiaTri | donVi.
 * Loi o nao bao o do: ValidationIssue.cell = "Buoc!C3".
 */
import ExcelJS from "exceljs";
import { stringify as yamlStringify } from "yaml";

import { SCENARIO_SCHEMA_VERSION, type ScenarioDefinition } from "./schema.js";
import { parseScenarioYaml, type ValidationIssue } from "./validate.js";

export const EXCEL_SHEETS = ["KichBan", "Buoc", "SinhDuLieu", "KiemDem"] as const;

export type ExcelConvertResult =
  | { ok: true; yaml: string; scenario: ScenarioDefinition; errors: [] }
  | { ok: false; errors: ValidationIssue[] };

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text.trim();
  }
  if (typeof v === "object" && "result" in v) return cellText({ value: (v as { result: unknown }).result } as ExcelJS.Cell);
  return String(v).trim();
}

function headerIndex(sheet: ExcelJS.Worksheet, expected: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, col) => {
    const name = cellText(cell);
    if (expected.includes(name)) map.set(name, col);
  });
  return map;
}

export async function convertExcelToYaml(
  buffer: Buffer,
  file = "<excel>",
): Promise<ExcelConvertResult> {
  const errors: ValidationIssue[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      ok: false,
      errors: [{ file, line: null, field: "(file)", message: "Không đọc được file .xlsx (file hỏng hoặc sai định dạng)" }],
    };
  }

  const kichBanSheet = wb.getWorksheet("KichBan");
  const buocSheet = wb.getWorksheet("Buoc");
  if (!kichBanSheet) {
    errors.push({ file, line: null, field: "KichBan", cell: "KichBan", message: "Thiếu sheet 'KichBan'" });
  }
  if (!buocSheet) {
    errors.push({ file, line: null, field: "Buoc", cell: "Buoc", message: "Thiếu sheet 'Buoc'" });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (!kichBanSheet || !buocSheet) return { ok: false, errors }; // hep kieu TS

  // --- Sheet KichBan: khoa/gia tri ---
  const meta = new Map<string, { value: string; cell: string }>();
  kichBanSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // dong tieu de Khoa|GiaTri
    const key = cellText(row.getCell(1));
    const value = cellText(row.getCell(2));
    if (key) meta.set(key, { value, cell: `KichBan!B${rowNumber}` });
  });
  const metaGet = (key: string) => meta.get(key)?.value ?? "";
  const scenarioObj: Record<string, unknown> = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: metaGet("id"),
    ten: metaGet("ten"),
    cacVai: metaGet("cacVai")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cacBuoc: [],
  };
  if (metaGet("moTa")) scenarioObj.moTa = metaGet("moTa");
  // S5.3: khoa "kenhNgoai" (vd "zalo,sms") - khai bao kenh ngoai kich ban cham toi.
  const kenhNgoai = metaGet("kenhNgoai")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (kenhNgoai.length) scenarioObj.kenhNgoai = kenhNgoai;
  if (!metaGet("id")) {
    errors.push({ file, line: null, field: "id", cell: "KichBan!B2", message: "Thiếu 'id' trong sheet KichBan" });
  }
  if (!metaGet("ten")) {
    errors.push({ file, line: null, field: "ten", cell: meta.get("ten")?.cell ?? "KichBan", message: "Thiếu 'ten' trong sheet KichBan" });
  }

  // --- Sheet Buoc ---
  const buocCols = headerIndex(buocSheet, ["id", "vai", "hanhDong", "choSuKien", "phatSuKien", "thoiGianChoGiay"]);
  const steps: Record<string, unknown>[] = [];
  buocSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (name: string) => {
      const col = buocCols.get(name);
      return col ? cellText(row.getCell(col)) : "";
    };
    const id = get("id");
    if (!id && !get("vai") && !get("hanhDong")) return; // dong trong
    const step: Record<string, unknown> = { id, vai: get("vai"), hanhDong: get("hanhDong") };
    if (get("choSuKien")) step.choSuKien = get("choSuKien");
    if (get("phatSuKien")) step.phatSuKien = get("phatSuKien");
    const tg = get("thoiGianChoGiay");
    if (tg) {
      const n = Number(tg);
      if (Number.isNaN(n)) {
        errors.push({
          file,
          line: rowNumber,
          field: `cacBuoc[${steps.length}].thoiGianChoGiay`,
          cell: `Buoc!${columnLetter(buocCols.get("thoiGianChoGiay") ?? 6)}${rowNumber}`,
          message: `Ô thoiGianChoGiay phải là số, đang là '${tg}'`,
        });
      } else step.thoiGianChoGiay = n;
    }
    steps.push(step);
  });
  scenarioObj.cacBuoc = steps;

  // --- Sheet SinhDuLieu (tuy chon) ---
  const sdSheet = wb.getWorksheet("SinhDuLieu");
  if (sdSheet) {
    const cols = headerIndex(sdSheet, ["loai", "ma", "ten", "gia", "soLuong"]);
    const dataGen: Record<string, unknown> = {};
    const dichVu: Record<string, unknown>[] = [];
    const phuTro: Record<string, unknown>[] = [];
    sdSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (name: string) => {
        const col = cols.get(name);
        return col ? cellText(row.getCell(col)) : "";
      };
      const loai = get("loai");
      if (!loai) return;
      const soLuongText = get("soLuong");
      const soLuong = soLuongText ? Number(soLuongText) : NaN;
      // soLuong chi bat buoc voi benhNhan/lichHen/phuTro; dichVu dung ma/ten/gia.
      if (loai !== "dichVu" && Number.isNaN(soLuong)) {
        errors.push({
          file,
          line: rowNumber,
          field: `sinhDuLieu.${loai}`,
          cell: `SinhDuLieu!${columnLetter(cols.get("soLuong") ?? 5)}${rowNumber}`,
          message: `Ô soLuong phải là số, đang là '${soLuongText}'`,
        });
        return;
      }
      if (loai === "benhNhan") dataGen.benhNhan = { soLuong };
      else if (loai === "lichHen") dataGen.lichHen = { soLuong };
      else if (loai === "dichVu") {
        const giaText = get("gia");
        const gia = giaText ? Number(giaText) : NaN;
        if (Number.isNaN(gia)) {
          errors.push({
            file,
            line: rowNumber,
            field: "sinhDuLieu.dichVu",
            cell: `SinhDuLieu!${columnLetter(cols.get("gia") ?? 4)}${rowNumber}`,
            message: `Ô gia của dịch vụ phải là số, đang là '${giaText}'`,
          });
          return;
        }
        dichVu.push({ ma: get("ma"), ten: get("ten"), gia });
      } else if (loai === "phuTro") {
        phuTro.push({ loai: get("ma"), soLuong });
      } else {
        errors.push({
          file,
          line: rowNumber,
          field: `sinhDuLieu`,
          cell: `SinhDuLieu!${columnLetter(cols.get("loai") ?? 1)}${rowNumber}`,
          message: `Loại dữ liệu '${loai}' không hợp lệ (chỉ benhNhan, dichVu, lichHen, phuTro)`,
        });
      }
    });
    if (dichVu.length) dataGen.dichVu = dichVu;
    if (phuTro.length) dataGen.phuTro = phuTro;
    if (Object.keys(dataGen).length) scenarioObj.sinhDuLieu = dataGen;
  }

  // --- Sheet KiemDem (tuy chon) ---
  const kdSheet = wb.getWorksheet("KiemDem");
  if (kdSheet) {
    const cols = headerIndex(kdSheet, ["id", "ten", "nguon", "kyVongTuDuLieu", "kyVongGiaTri", "donVi"]);
    const metrics: Record<string, unknown>[] = [];
    kdSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (name: string) => {
        const col = cols.get(name);
        return col ? cellText(row.getCell(col)) : "";
      };
      if (!get("id")) return;
      const kyVong: Record<string, unknown> = {};
      if (get("kyVongTuDuLieu")) kyVong.tuDuLieuSinh = get("kyVongTuDuLieu");
      const gv = get("kyVongGiaTri");
      if (gv) {
        const n = Number(gv);
        if (Number.isNaN(n)) {
          errors.push({
            file,
            line: rowNumber,
            field: `kiemDem[${metrics.length}].kyVong`,
            cell: `KiemDem!${columnLetter(cols.get("kyVongGiaTri") ?? 5)}${rowNumber}`,
            message: `Ô kyVongGiaTri phải là số, đang là '${gv}'`,
          });
          return;
        }
        kyVong.giaTri = n;
      }
      const metric: Record<string, unknown> = {
        id: get("id"),
        ten: get("ten"),
        nguon: get("nguon").split(",").map((s) => s.trim()).filter(Boolean),
        kyVong,
      };
      if (get("donVi")) metric.donVi = get("donVi");
      metrics.push(metric);
    });
    if (metrics.length) scenarioObj.kiemDem = metrics;
  }

  if (errors.length > 0) return { ok: false, errors };

  const yaml = yamlStringify(scenarioObj);
  const validated = parseScenarioYaml(yaml, file);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  return { ok: true, yaml, scenario: validated.scenario, errors: [] };
}

function columnLetter(col: number): string {
  let out = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

/** Tao file .xlsx mau theo dung mau cot da tai lieu hoa (dung cho test va tai xuong). */
export async function buildExcelTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const kichBan = wb.addWorksheet("KichBan");
  kichBan.addRow(["Khoa", "GiaTri"]);
  kichBan.addRow(["id", "dat-lich-den-bao-cao"]);
  kichBan.addRow(["ten", "Đặt lịch đến báo cáo doanh thu"]);
  kichBan.addRow(["moTa", "Kịch bản mẫu: đặt lịch → xác nhận → check-in → khám → thanh toán → báo cáo"]);
  kichBan.addRow(["cacVai", "benh-nhan,le-tan,bac-si,thu-ngan,quan-ly"]);
  kichBan.addRow(["kenhNgoai", ""]);

  const buoc = wb.addWorksheet("Buoc");
  buoc.addRow(["id", "vai", "hanhDong", "choSuKien", "phatSuKien", "thoiGianChoGiay"]);
  buoc.addRow(["dang-nhap-le-tan", "le-tan", "dang-nhap", "", "le-tan-san-sang", ""]);
  buoc.addRow(["dat-lich", "benh-nhan", "dat-lich-hen", "le-tan-san-sang", "lich-da-dat", ""]);
  buoc.addRow(["xac-nhan-lich", "le-tan", "xac-nhan-lich", "lich-da-dat", "lich-da-xac-nhan", ""]);
  buoc.addRow(["check-in", "benh-nhan", "check-in", "lich-da-xac-nhan", "da-check-in", ""]);
  buoc.addRow(["bat-dau-kham", "bac-si", "bat-dau-kham", "da-check-in", "dang-kham", ""]);
  buoc.addRow(["ket-thuc-kham", "bac-si", "ket-thuc-kham", "dang-kham", "kham-xong", ""]);
  buoc.addRow(["thanh-toan", "thu-ngan", "thanh-toan", "kham-xong", "da-thanh-toan", ""]);
  buoc.addRow(["xem-bao-cao", "quan-ly", "xem-bao-cao-doanh-thu", "da-thanh-toan", "", ""]);

  const sd = wb.addWorksheet("SinhDuLieu");
  sd.addRow(["loai", "ma", "ten", "gia", "soLuong"]);
  sd.addRow(["benhNhan", "", "", "", 2]);
  sd.addRow(["dichVu", "DV-KHAM-TQ", "Khám tổng quát", 300000, ""]);
  sd.addRow(["dichVu", "DV-TAI-KHAM", "Tái khám", 200000, ""]);
  sd.addRow(["lichHen", "", "", "", 2]);

  const kd = wb.addWorksheet("KiemDem");
  kd.addRow(["id", "ten", "nguon", "kyVongTuDuLieu", "kyVongGiaTri", "donVi"]);
  kd.addRow(["doanh-thu-ngay", "Doanh thu trong ngày", "ui,api,db", "tongGiaLichHenDaThanhToan", "", "VND"]);
  kd.addRow(["so-lich-hen", "Số lịch hẹn đã tạo", "ui,db", "soLichHen", "", "lịch"]);
  kd.addRow(["so-luot-check-in", "Số lượt check-in", "ui,db", "soCheckIn", "", "lượt"]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
