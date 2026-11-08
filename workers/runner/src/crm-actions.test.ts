/**
 * Test hanh dong bao cao cua worker (S4.2 AC-3 phia worker + S4.3):
 * so doc tu giao dien phai giu van ban tho va phan tich bang bo phan
 * tich dung chung cua @autotest/oracle - khong con tach so thu cong.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CRM_PATHS, getCrmAction, type ActionContext } from "./crm-actions.js";
import { FakePageDriver } from "./page-driver.js";

function boiCanh(driver: FakePageDriver, data: Record<string, string | number | boolean> = {}): ActionContext {
  return {
    driver,
    baseUrl: "https://uat.example.invalid",
    paths: DEFAULT_CRM_PATHS,
    credentials: { username: "quan-ly-mau@example.invalid", password: "mat-khau-gia-test" },
    data,
    registerEntity: async () => undefined,
    step: { stepId: "xem-bao-cao" },
    artifactsDir: "/tmp",
  };
}

function driverBaoCao() {
  const driver = new FakePageDriver();
  driver.setElement({ by: "testid", id: "tong-doanh-thu" }, { visible: true, text: "300.000 đ" });
  driver.setElement({ by: "testid", id: "so-lich-hen" }, { visible: true, text: "1" });
  driver.setElement({ by: "testid", id: "so-luot-check-in" }, { visible: true, text: "1" });
  driver.setElement({ by: "testid", id: "doanh-thu-khach-hang" }, { visible: true, text: "300.000 đ" });
  return driver;
}

describe("xem-bao-cao-doanh-thu — đọc số báo cáo (S4.2/S4.3)", () => {
  it("giữ văn bản thô và số đã phân tích cho tổng doanh thu + số check-in", async () => {
    const action = getCrmAction("xem-bao-cao-doanh-thu");
    const { outputs } = await action(boiCanh(driverBaoCao()));
    expect(outputs.tong_doanh_thu_text).toBe("300.000 đ");
    expect(outputs.tong_doanh_thu).toBe(300000);
    expect(outputs.so_lich_hen).toBe(1);
    expect(outputs.so_luot_check_in_text).toBe("1");
    expect(outputs.so_luot_check_in).toBe(1);
    // Khong khai bao doc theo khach thi khong co outputs theo khach.
    expect(outputs.doanh_thu_khach).toBeUndefined();
  });

  it("doc: theo-khach đọc thêm doanh thu của khách chính (29.2)", async () => {
    const action = getCrmAction("xem-bao-cao-doanh-thu");
    const { outputs } = await action(boiCanh(driverBaoCao(), { doc: "theo-khach" }));
    expect(outputs.doanh_thu_khach_text).toBe("300.000 đ");
    expect(outputs.doanh_thu_khach).toBe(300000);
  });

  it("số tiền định dạng lạ không bị tách sai: '1.234.500 đ' → 1234500", async () => {
    const driver = driverBaoCao();
    driver.setElement({ by: "testid", id: "tong-doanh-thu" }, { visible: true, text: "1.234.500 đ" });
    const action = getCrmAction("xem-bao-cao-doanh-thu");
    const { outputs } = await action(boiCanh(driver));
    expect(outputs.tong_doanh_thu).toBe(1234500);
  });
});

describe("dang-nhap — khớp form thật của CRM_Loyalty (sửa theo log máy thật 2026-11-08)", () => {
  function driverFormNhanVien() {
    const driver = new FakePageDriver();
    driver.setElement({ by: "testid", id: "admin-input-email" }, { visible: true });
    driver.setElement({ by: "testid", id: "admin-input-password" }, { visible: true });
    driver.setElement({ by: "testid", id: "admin-nut-dang-nhap" }, { visible: true });
    driver.setElement({ by: "testid", id: "app-shell" }, { visible: true });
    return driver;
  }

  function boiCanhVai(driver: FakePageDriver, roleId: string): ActionContext {
    return { ...boiCanh(driver), roleId, step: { stepId: "dang-nhap-le-tan" } };
  }

  it("nhân viên: mở /quan-tri/dang-nhap và điền đúng testid thật của CRM", async () => {
    const driver = driverFormNhanVien();
    const action = getCrmAction("dang-nhap");
    await action(boiCanhVai(driver, "le-tan"));
    const mo = driver.ops.find((o) => o.op === "goto");
    expect(mo && "url" in mo ? mo.url : "").toBe(
      "https://uat.example.invalid/quan-tri/dang-nhap",
    );
    const cacDien = driver.ops.filter((o) => o.op === "fill").map((o) => ("key" in o ? o.key : ""));
    expect(cacDien).toContain("testid:admin-input-email");
    expect(cacDien).toContain("testid:admin-input-password");
    const cacBam = driver.ops.filter((o) => o.op === "click").map((o) => ("key" in o ? o.key : ""));
    expect(cacBam).toContain("testid:admin-nut-dang-nhap");
  });

  it("bệnh nhân: mở cổng riêng /dang-nhap, không lạc vào cổng nhân viên", async () => {
    const driver = driverFormNhanVien();
    const action = getCrmAction("dang-nhap");
    await action(boiCanhVai(driver, "benh-nhan"));
    const mo = driver.ops.find((o) => o.op === "goto");
    expect(mo && "url" in mo ? mo.url : "").toBe(
      "https://uat.example.invalid/dang-nhap",
    );
  });

  it("CRM đòi mã TOTP sau mật khẩu → lỗi nói rõ TOTP thay vì chờ khung ứng dụng", async () => {
    const driver = new FakePageDriver();
    driver.setElement({ by: "testid", id: "admin-input-email" }, { visible: true });
    driver.setElement({ by: "testid", id: "admin-input-password" }, { visible: true });
    driver.setElement({ by: "testid", id: "admin-nut-dang-nhap" }, { visible: true });
    driver.setElement({ by: "testid", id: "admin-input-totp" }, { visible: true });
    const action = getCrmAction("dang-nhap");
    await expect(action(boiCanhVai(driver, "le-tan"))).rejects.toThrow(/TOTP/);
  });

  it("trang không có form (trường hợp cũ ở trang gốc) → vẫn lỗi định danh, nhưng đã tới đúng địa chỉ trước", async () => {
    const driver = new FakePageDriver();
    const action = getCrmAction("dang-nhap");
    await expect(action(boiCanhVai(driver, "le-tan"))).rejects.toThrow(
      /Không tìm thấy phần tử/,
    );
    const mo = driver.ops.find((o) => o.op === "goto");
    expect(mo && "url" in mo ? mo.url : "").toBe(
      "https://uat.example.invalid/quan-tri/dang-nhap",
    );
  });

  it("lỗi không thấy form kèm địa chỉ trang lúc lỗi để log tự nói rõ trình duyệt đã đứng ở đâu", async () => {
    const driver = new FakePageDriver();
    const action = getCrmAction("dang-nhap");
    await expect(action(boiCanhVai(driver, "le-tan"))).rejects.toThrow(
      /địa chỉ trang lúc lỗi: https:\/\/uat\.example\.invalid\/quan-tri\/dang-nhap/,
    );
  });
});
