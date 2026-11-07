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
