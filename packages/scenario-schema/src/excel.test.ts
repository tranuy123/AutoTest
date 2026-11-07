import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildExcelTemplate, convertExcelToYaml } from "./excel.js";
import { parseScenarioYaml } from "./validate.js";

describe("S2.1 - chuyen doi Excel -> YAML (AC-3)", () => {
  it("file mau .xlsx chuyen thanh YAML dung schema va parse lai duoc", async () => {
    const buffer = await buildExcelTemplate();
    const r = await convertExcelToYaml(buffer, "mau.xlsx");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scenario.id).toBe("dat-lich-den-bao-cao");
      expect(r.scenario.cacBuoc).toHaveLength(8);
      expect(r.scenario.kiemDem).toHaveLength(3);
      const reParsed = parseScenarioYaml(r.yaml, "mau.yaml");
      expect(reParsed.ok).toBe(true);
    }
  });

  it("o so bi sai kieu -> bao loi dung o do", async () => {
    const buffer = await buildExcelTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sd = wb.getWorksheet("SinhDuLieu");
    if (!sd) throw new Error("thieu sheet SinhDuLieu trong mau");
    // Dong 4 (dichVu DV-KHAM-TQ) cot gia (D) doi thanh chu
    sd.getCell("D3").value = "ba-tram-nghin";
    const out = await wb.xlsx.writeBuffer();
    const r = await convertExcelToYaml(Buffer.from(out as ArrayBuffer), "sai-o.xlsx");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.cell);
      expect(e?.cell).toBe("SinhDuLieu!D3");
      expect(e?.message).toContain("phải là số");
    }
  });

  it("thieu sheet Buoc -> bao loi ro rang", async () => {
    const wb = new ExcelJS.Workbook();
    const kb = wb.addWorksheet("KichBan");
    kb.addRow(["Khoa", "GiaTri"]);
    kb.addRow(["id", "thu"]);
    kb.addRow(["ten", "Thu"]);
    kb.addRow(["cacVai", "le-tan"]);
    const out = await wb.xlsx.writeBuffer();
    const r = await convertExcelToYaml(Buffer.from(out as ArrayBuffer), "thieu-sheet.xlsx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("Thiếu sheet 'Buoc'"))).toBe(true);
  });

  it("file khong phai xlsx -> loi de hieu", async () => {
    const r = await convertExcelToYaml(Buffer.from("day khong phai excel"), "hong.xlsx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("Không đọc được file .xlsx");
  });
});
