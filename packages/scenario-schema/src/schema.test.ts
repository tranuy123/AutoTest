import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseScenarioYaml } from "./validate.js";

const samplePath = join(fileURLToPath(new URL(".", import.meta.url)), "../samples/dat-lich-den-bao-cao.yaml");
const sampleYaml = readFileSync(samplePath, "utf8");

const BASE = `schemaVersion: 1
id: kich-ban-thu
ten: Kịch bản thử
cacVai: [benh-nhan, le-tan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
    phatSuKien: san-sang
  - id: dat-lich
    vai: benh-nhan
    hanhDong: dat-lich-hen
    choSuKien: san-sang
`;

describe("S2.1 - kich ban hop le", () => {
  it("kich ban mau day du (dat lich -> bao cao) parse thanh cong", () => {
    const r = parseScenarioYaml(sampleYaml, "mau.yaml");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scenario.cacVai).toHaveLength(5);
      expect(r.scenario.cacBuoc).toHaveLength(8);
      expect(r.scenario.kiemDem).toHaveLength(3);
      expect(r.scenario.sinhDuLieu?.dichVu).toHaveLength(2);
    }
  });

  it("kich ban nen toi thieu parse thanh cong va tra doi tuong da parse", () => {
    const r = parseScenarioYaml(BASE, "nen.yaml");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scenario.id).toBe("kich-ban-thu");
  });
});

describe("S2.1 - cac truong hop sai dien hinh (AC-4)", () => {
  it("1. thieu vai: buoc dung vai khong khai bao trong cacVai", () => {
    // BASE co cacVai [benh-nhan, le-tan]; doi vai cua buoc dat-lich thanh bac-si (khong khai bao)
    const yaml = BASE.replace("vai: benh-nhan", "vai: bac-si");
    const r = parseScenarioYaml(yaml, "thieu-vai.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.field.includes("cacBuoc"));
      expect(e?.message).toContain("không nằm trong cacVai");
    }
  });

  it("2. vai khong ton tai trong he thong (giam-doc)", () => {
    const r = parseScenarioYaml(BASE.replace("benh-nhan", "giam-doc"), "vai-la.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field.startsWith("cacVai"))).toBe(true);
  });

  it("3. buoc khong ton tai trong thu vien buoc dung chung", () => {
    const r = parseScenarioYaml(BASE.replace("hanhDong: dat-lich-hen", "hanhDong: lam-bua"), "buoc-la.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.field.endsWith("hanhDong"));
      expect(e?.message).toContain("không có trong thư viện bước dùng chung");
      expect(e?.line).toBe(12); // dong "hanhDong: lam-bua" trong BASE
    }
  });

  it("4. diem dong bo khong co su kien sinh", () => {
    const r = parseScenarioYaml(BASE.replace("choSuKien: san-sang", "choSuKien: khong-ai-phat"), "dong-bo.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.field.endsWith("choSuKien"));
      expect(e?.message).toContain("không có bước nào phát sự kiện này");
    }
  });

  it("5. chi tieu kiem dem thieu nguon doi chieu", () => {
    const yaml = BASE + `kiemDem:
  - id: doanh-thu
    ten: Doanh thu
    nguon: []
    kyVong:
      giaTri: 0
`;
    const r = parseScenarioYaml(yaml, "thieu-nguon.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field.includes("nguon"))).toBe(true);
  });

  it("6. chi tieu kiem dem thieu ky vong", () => {
    const yaml = BASE + `kiemDem:
  - id: doanh-thu
    ten: Doanh thu
    nguon: [ui]
    kyVong: {}
`;
    const r = parseScenarioYaml(yaml, "thieu-ky-vong.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("kỳ vọng"))).toBe(true);
  });

  it("7. thieu truong bat buoc (ten)", () => {
    const r = parseScenarioYaml(BASE.replace("ten: Kịch bản thử\n", ""), "thieu-ten.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.field === "ten");
      expect(e?.message).toBe("Thiếu trường bắt buộc");
      expect(e?.file).toBe("thieu-ten.yaml");
    }
  });

  it("8. sai phien ban schema", () => {
    const r = parseScenarioYaml(BASE.replace("schemaVersion: 1", "schemaVersion: 2"), "sai-version.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "schemaVersion")).toBe(true);
  });

  it("9. trung id buoc", () => {
    const r = parseScenarioYaml(BASE.replace("id: dat-lich", "id: dang-nhap"), "trung-buoc.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("bị trùng"))).toBe(true);
  });

  it("10. nhung code vao kich ban bi chan (AD-2)", () => {
    const yaml = BASE.replace(
      "    choSuKien: san-sang\n",
      "    choSuKien: san-sang\n    script: 'process.exit(1)'\n",
    );
    const r = parseScenarioYaml(yaml, "nhung-code.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("không được phép"))).toBe(true);
  });

  it("11. loi cu phap YAML tra ve so dong", () => {
    const r = parseScenarioYaml("schemaVersion: 1\nid: [chua-dong\n", "hong.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.field).toBe("(cú pháp YAML)");
      expect(typeof r.errors[0]?.line).toBe("number");
    }
  });
});
