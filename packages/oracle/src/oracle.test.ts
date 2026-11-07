/**
 * Bo ca kiem thu tinh tay cua Oracle (S4.1 AC-3, AC-4).
 * Moi con so ky vong duoi day duoc tinh bang tay tu tai lieu
 * QUY-TAC-DOANH-THU.md (QT-1..QT-5) - doc lap voi code Oracle va doc
 * lap voi bat ky code bao cao nao cua CRM (AD-4).
 */
import { describe, expect, it } from "vitest";

import {
  giaoDichTuDuLieuSinh,
  ngaySaigon,
  soTienThucThu,
  tinhKyVongDoanhThu,
  type GiaoDich,
} from "./oracle.js";

function gd(partial: Partial<GiaoDich> & { id: string }): GiaoDich {
  return {
    benhNhanId: "BN-1",
    dichVuMa: "DV-1",
    thoiDiem: "2026-11-07T09:00:00+07:00",
    giaGoc: 0,
    trangThai: "da-thanh-toan",
    ...partial,
  };
}

describe("Oracle doanh thu — ca tính tay theo quy tắc", () => {
  it("QT-1: chỉ giao dịch đã thanh toán được tính; huỷ/hoàn/chưa thu đều bằng 0", () => {
    const ketQua = tinhKyVongDoanhThu([
      gd({ id: "A", giaGoc: 300000, trangThai: "da-thanh-toan" }),
      gd({ id: "B", giaGoc: 200000, trangThai: "da-huy" }),
      gd({ id: "C", giaGoc: 150000, trangThai: "da-hoan-tien" }),
      gd({ id: "D", giaGoc: 100000, trangThai: "chua-thanh-toan" }),
    ]);
    expect(ketQua.tongDoanhThu).toBe(300000);
    expect(ketQua.soGiaoDichDuocTinh).toBe(1);
    expect(ketQua.tongTheoNgay).toEqual({ "2026-11-07": 300000 });
  });

  it("QT-2 ví dụ 1: giảm tiền trực tiếp 300.000 − 20.000 = 280.000", () => {
    expect(soTienThucThu(gd({ id: "A", giaGoc: 300000, giamTien: 20000 }))).toBe(280000);
  });

  it("QT-2 ví dụ 2: giảm 10% trên 155.555 làm tròn xuống → thực thu 140.000", () => {
    // floor(155555 × 10 / 100) = floor(15555,5) = 15555; 155555 − 15555 = 140000.
    expect(soTienThucThu(gd({ id: "A", giaGoc: 155555, giamPhanTram: 10 }))).toBe(140000);
  });

  it("QT-2 ví dụ 3: kết hợp giảm tiền + giảm % trên giá gốc → 400.000", () => {
    // 500000 − 50000 (tiền) − 50000 (10% của giá gốc) = 400000.
    expect(
      soTienThucThu(gd({ id: "A", giaGoc: 500000, giamTien: 50000, giamPhanTram: 10 })),
    ).toBe(400000);
  });

  it("QT-3: giảm vượt giá gốc thì thực thu bằng 0, không âm", () => {
    expect(soTienThucThu(gd({ id: "A", giaGoc: 100000, giamTien: 120000 }))).toBe(0);
    const ketQua = tinhKyVongDoanhThu([gd({ id: "A", giaGoc: 100000, giamTien: 120000 })]);
    expect(ketQua.tongDoanhThu).toBe(0);
    expect(ketQua.soGiaoDichDuocTinh).toBe(1);
  });

  it("QT-5: ví dụ cộng dồn nhiều ngày/khách/dịch vụ trong tài liệu quy tắc", () => {
    const ketQua = tinhKyVongDoanhThu([
      gd({ id: "A", benhNhanId: "KH-A", dichVuMa: "X", giaGoc: 300000, thoiDiem: "2026-11-07T09:00:00+07:00" }),
      gd({ id: "B", benhNhanId: "KH-A", dichVuMa: "Y", giaGoc: 200000, thoiDiem: "2026-11-08T09:00:00+07:00" }),
      gd({ id: "C", benhNhanId: "KH-B", dichVuMa: "X", giaGoc: 300000, thoiDiem: "2026-11-08T10:00:00+07:00" }),
    ]);
    expect(ketQua.tongTheoNgay).toEqual({ "2026-11-07": 300000, "2026-11-08": 500000 });
    expect(ketQua.theoKhachHang).toEqual({ "KH-A": 500000, "KH-B": 300000 });
    expect(ketQua.theoDichVu).toEqual({ X: 600000, Y: 200000 });
    expect(ketQua.tongDoanhThu).toBe(800000);
    // Bat bien QT-5: ba chieu cong lai phai bang nhau.
    const cong = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    expect(cong(ketQua.tongTheoNgay)).toBe(ketQua.tongDoanhThu);
    expect(cong(ketQua.theoKhachHang)).toBe(ketQua.tongDoanhThu);
    expect(cong(ketQua.theoDichVu)).toBe(ketQua.tongDoanhThu);
  });

  it("ca huỷ lịch nằm giữa các giao dịch thật không làm lệch tổng theo khách", () => {
    const ketQua = tinhKyVongDoanhThu([
      gd({ id: "A", benhNhanId: "KH-A", giaGoc: 300000 }),
      gd({ id: "B", benhNhanId: "KH-A", giaGoc: 200000, trangThai: "da-huy" }),
      gd({ id: "C", benhNhanId: "KH-A", giaGoc: 100000 }),
    ]);
    expect(ketQua.theoKhachHang).toEqual({ "KH-A": 400000 });
    expect(ketQua.tongDoanhThu).toBe(400000);
  });

  it("danh sách rỗng cho kỳ vọng 0 ở mọi chiều", () => {
    const ketQua = tinhKyVongDoanhThu([]);
    expect(ketQua.tongDoanhThu).toBe(0);
    expect(ketQua.tongTheoNgay).toEqual({});
    expect(ketQua.theoKhachHang).toEqual({});
    expect(ketQua.theoDichVu).toEqual({});
  });

  it("đầu vào không hợp lệ bị từ chối và nêu rõ bản ghi", () => {
    expect(() => tinhKyVongDoanhThu([gd({ id: "GD-LE", giaGoc: 100.5 })])).toThrow(/GD-LE/);
    expect(() => tinhKyVongDoanhThu([gd({ id: "GD-PT", giaGoc: 100000, giamPhanTram: 120 })])).toThrow(
      /GD-PT/,
    );
    expect(() =>
      tinhKyVongDoanhThu([gd({ id: "GD-TG", giaGoc: 100000, thoiDiem: "khong-phai-ngay" })]),
    ).toThrow(/GD-TG/);
  });
});

describe("Oracle — biên ngày Asia/Saigon (S4.1 AC-4)", () => {
  it("23:59 và 00:01 thuộc hai ngày báo cáo khác nhau", () => {
    expect(ngaySaigon("2026-11-07T23:59:00+07:00")).toBe("2026-11-07");
    expect(ngaySaigon("2026-11-08T00:01:00+07:00")).toBe("2026-11-08");
    const ketQua = tinhKyVongDoanhThu([
      gd({ id: "A", giaGoc: 200000, thoiDiem: "2026-11-07T23:59:00+07:00" }),
      gd({ id: "B", giaGoc: 300000, thoiDiem: "2026-11-08T00:01:00+07:00" }),
    ]);
    expect(ketQua.tongTheoNgay).toEqual({ "2026-11-07": 200000, "2026-11-08": 300000 });
  });

  it("thời điểm dạng UTC được quy đổi sang ngày Saigon (QT-4 ví dụ 2)", () => {
    // 17:30 UTC = 00:30 ngay 08/11 gio Saigon.
    expect(ngaySaigon("2026-11-07T17:30:00Z")).toBe("2026-11-08");
    // 16:59 UTC = 23:59 ngay 07/11 gio Saigon.
    expect(ngaySaigon("2026-11-07T16:59:00Z")).toBe("2026-11-07");
  });

  it("giao dịch khác múi giờ (+09:00) vẫn quy về ngày Saigon", () => {
    // 2026-11-08T01:00:00+09:00 = 23:00 ngay 07/11 gio Saigon.
    expect(ngaySaigon("2026-11-08T01:00:00+09:00")).toBe("2026-11-07");
  });
});

describe("Oracle — chuyển dữ liệu sinh thành giao dịch (QT-6)", () => {
  const duLieu = {
    lichHen: [
      { id: "LH-1", benhNhanId: "BN-1", dichVuMa: "DV-KHAM-TQ", ngayGio: "2026-11-07T08:00:00+07:00", gia: 300000 },
      { id: "LH-2", benhNhanId: "BN-2", dichVuMa: "DV-TAI-KHAM", ngayGio: "2026-11-07T08:30:00+07:00", gia: 200000 },
    ],
  };

  it("chỉ lịch nằm trong tập đã thanh toán mới thành doanh thu", () => {
    const giaoDich = giaoDichTuDuLieuSinh(duLieu, { lichDaThanhToan: new Set(["LH-1"]) });
    const ketQua = tinhKyVongDoanhThu(giaoDich);
    expect(ketQua.tongDoanhThu).toBe(300000);
    expect(ketQua.theoKhachHang).toEqual({ "BN-1": 300000 });
    expect(ketQua.theoDichVu).toEqual({ "DV-KHAM-TQ": 300000 });
  });

  it("lịch đã huỷ và lịch chưa thanh toán đều cho doanh thu 0", () => {
    const giaoDich = giaoDichTuDuLieuSinh(duLieu, {
      lichDaThanhToan: new Set(),
      lichDaHuy: new Set(["LH-2"]),
    });
    expect(tinhKyVongDoanhThu(giaoDich).tongDoanhThu).toBe(0);
  });

  it("giảm giá theo lịch được áp đúng khi chuyển đổi", () => {
    const giaoDich = giaoDichTuDuLieuSinh(duLieu, {
      lichDaThanhToan: new Set(["LH-1", "LH-2"]),
      giamTienTheoLich: new Map([["LH-1", 30000]]),
      giamPhanTramTheoLich: new Map([["LH-2", 10]]),
    });
    // LH-1: 300000 − 30000 = 270000; LH-2: 200000 − 20000 = 180000.
    expect(tinhKyVongDoanhThu(giaoDich).tongDoanhThu).toBe(450000);
  });
});
