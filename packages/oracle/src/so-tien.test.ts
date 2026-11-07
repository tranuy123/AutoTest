/**
 * Test bo phan tich so tien/so luong dung chung (S4.2 AC-3).
 * Ca trung tam la dinh dang "900.000 đ" - dinh dang tung lam hong spec
 * 29.2/38.6 cua CRM khi so sanh chuoi tho.
 */
import { describe, expect, it } from "vitest";

import { formatSoTien, parseSoLuong, parseSoTien } from "./so-tien.js";

describe("parseSoTien — định dạng tiền Việt Nam", () => {
  it("đọc đúng '900.000 đ' (định dạng từng làm hỏng spec 29.2/38.6)", () => {
    expect(parseSoTien("900.000 đ")).toBe(900000);
  });

  it("đọc các biến thể đơn vị và khoảng trang", () => {
    expect(parseSoTien("1.234.500₫")).toBe(1234500);
    expect(parseSoTien("300.000 VND")).toBe(300000);
    expect(parseSoTien("  200.000 đồng ")).toBe(200000);
    expect(parseSoTien("900.000\u00a0đ")).toBe(900000);
    expect(parseSoTien("500000")).toBe(500000);
    expect(parseSoTien("0 đ")).toBe(0);
  });

  it("'1.234' là gom nhóm nghìn (1234), không phải phần thập phân", () => {
    expect(parseSoTien("1.234")).toBe(1234);
  });

  it("chấp nhận phần thập phân bằng 0", () => {
    expect(parseSoTien("900.000,00 đ")).toBe(900000);
    expect(parseSoTien("1500,00")).toBe(1500);
  });

  it("từ chối định dạng mơ hồ hoặc sai thay vì đoán", () => {
    expect(parseSoTien("")).toBeNull();
    expect(parseSoTien(null)).toBeNull();
    expect(parseSoTien(undefined)).toBeNull();
    expect(parseSoTien("abc")).toBeNull();
    expect(parseSoTien("900,5")).toBeNull();
    expect(parseSoTien("12.34.567")).toBeNull();
    expect(parseSoTien("1.2345")).toBeNull();
    expect(parseSoTien("-5.000 đ")).toBeNull();
    expect(parseSoTien("900.000 đ (đã thu)")).toBeNull();
  });
});

describe("parseSoLuong — số đếm kèm đơn vị chữ", () => {
  it("đọc số đếm thuần và kèm đơn vị", () => {
    expect(parseSoLuong("12")).toBe(12);
    expect(parseSoLuong("1.234 lượt")).toBe(1234);
    expect(parseSoLuong("3 lượt check-in")).toBe(3);
    expect(parseSoLuong("0")).toBe(0);
  });

  it("từ chối chuỗi không bắt đầu bằng số hoặc còn số trong phần chữ", () => {
    expect(parseSoLuong("lượt: 3")).toBeNull();
    expect(parseSoLuong("12 ca 2")).toBeNull();
    expect(parseSoLuong("")).toBeNull();
    expect(parseSoLuong(null)).toBeNull();
  });
});

describe("formatSoTien", () => {
  it("định dạng số nguyên đồng kiểu Việt Nam", () => {
    expect(formatSoTien(900000)).toBe("900.000 đ");
    expect(formatSoTien(0)).toBe("0 đ");
    expect(formatSoTien(1234500)).toBe("1.234.500 đ");
  });

  it("đi vòng: format rồi parse trả lại đúng số", () => {
    for (const n of [0, 5, 999, 1000, 140000, 900000, 123456789]) {
      expect(parseSoTien(formatSoTien(n))).toBe(n);
    }
  });
});
