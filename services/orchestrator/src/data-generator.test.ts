import { describe, expect, it } from "vitest";

import {
  BannedDataError,
  findBannedData,
  generateRunData,
} from "./data-generator.js";
import type { DataGenBlock } from "@autotest/scenario-schema";

const BLOCK: DataGenBlock = {
  benhNhan: { soLuong: 3 },
  dichVu: [
    { ma: "DV-KHAM-TQ", ten: "Khám tổng quát", gia: 300000 },
    { ma: "DV-TAI-KHAM", ten: "Tái khám", gia: 200000 },
  ],
  lichHen: { soLuong: 3 },
  phuTro: [{ loai: "khuyenMai", soLuong: 1, truong: { ma: "KM10", phanTram: 10 } }],
};

describe("S2.3 - bo sinh du lieu (AC-1, AC-2, AC-4)", () => {
  it("sinh du benh nhan/dich vu/lich hen va quan he nhat quan", () => {
    const data = generateRunData({ runId: "AUTOTEST_20261107_001", dataGen: BLOCK });
    expect(data.benhNhan).toHaveLength(3);
    expect(data.dichVu).toHaveLength(2);
    expect(data.lichHen).toHaveLength(3);
    const patientIds = new Set(data.benhNhan.map((b) => b.id));
    const serviceMas = new Set(data.dichVu.map((d) => d.ma));
    for (const lh of data.lichHen) {
      expect(patientIds.has(lh.benhNhanId)).toBe(true);
      expect(serviceMas.has(lh.dichVuMa)).toBe(true);
      const dv = data.dichVu.find((d) => d.ma === lh.dichVuMa);
      expect(lh.gia).toBe(dv?.gia);
    }
    expect(data.thongKe.tongGiaLichHen).toBe(
      data.lichHen.reduce((s, lh) => s + lh.gia, 0),
    );
    expect(data.phuTro).toHaveLength(1);
    expect(data.phuTro[0]?.truong.ma).toBe("KM10");
  });

  it("moi ban ghi mang run_id va tien to nhan dien test; SDT dung dai 011", () => {
    const data = generateRunData({ runId: "AUTOTEST_20261107_001", dataGen: BLOCK });
    const all = [
      ...data.benhNhan,
      ...data.dichVu,
      ...data.lichHen,
      ...data.phuTro,
    ] as Array<{ runId: string; nhanDienTest: string }>;
    for (const rec of all) {
      expect(rec.runId).toBe("AUTOTEST_20261107_001");
      expect(rec.nhanDienTest).toBe("AUTOTEST_AUTOTEST_20261107_001");
    }
    for (const bn of data.benhNhan) {
      expect(bn.soDienThoai).toMatch(/^011\d{7}$/);
      expect(bn.hoTen.length).toBeGreaterThan(3);
    }
  });

  it("cung seed -> cung bo du lieu (tai hien loi)", () => {
    const a = generateRunData({ runId: "AUTOTEST_20261107_001", seed: "seed-co-dinh", dataGen: BLOCK });
    const b = generateRunData({ runId: "AUTOTEST_20261107_001", seed: "seed-co-dinh", dataGen: BLOCK });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("2 run_id khac nhau (seed mac dinh) -> khong trung khoa va khong trung SDT", () => {
    const a = generateRunData({ runId: "AUTOTEST_20261107_001", dataGen: BLOCK });
    const b = generateRunData({ runId: "AUTOTEST_20261107_002", dataGen: BLOCK });
    const idsA = new Set([...a.benhNhan.map((x) => x.id), ...a.lichHen.map((x) => x.id)]);
    for (const id of [...b.benhNhan.map((x) => x.id), ...b.lichHen.map((x) => x.id)]) {
      expect(idsA.has(id)).toBe(false);
    }
    const phonesA = new Set(a.benhNhan.map((x) => x.soDienThoai));
    for (const bn of b.benhNhan) expect(phonesA.has(bn.soDienThoai)).toBe(false);
  });

  it("danh sach cam rong -> khong vi pham; cam dung ten da sinh -> bi chan", () => {
    const data = generateRunData({ runId: "AUTOTEST_20261107_001", dataGen: BLOCK });
    expect(findBannedData(data, { names: [], phones: [] })).toEqual([]);
    const tenBiCam = data.benhNhan[0]?.hoTen as string;
    expect(() =>
      generateRunData({
        runId: "AUTOTEST_20261107_001",
        dataGen: BLOCK,
        banned: { names: [tenBiCam], phones: [] },
      }),
    ).toThrow(BannedDataError);
  });

  it("khong khai bao sinhDuLieu -> bo du lieu rong nhung hop le", () => {
    const data = generateRunData({ runId: "AUTOTEST_20261107_003" });
    expect(data.thongKe).toEqual({ soBenhNhan: 0, soDichVu: 0, soLichHen: 0, tongGiaLichHen: 0 });
  });
});
