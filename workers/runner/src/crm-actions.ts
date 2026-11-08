/**
 * Anh xa hanh dong kich ban (thu vien buoc dung chung cua scenario-schema,
 * AD-2) sang thao tac CRM cu the, ghep tu thu vien buoc co ban (steps.ts).
 *
 * Quy uoc du lieu buoc (orchestrator da giai tham chieu truoc khi gui):
 * - data["benhNhan.hoTen"], data["benhNhan.soDienThoai"], data["benhNhan.id"]
 * - data["dichVu"] = ma dich vu; data["lichHen.id"] = id lich hen da tao
 * - data["ngayGio"] = thoi diem hen dang text (neu kich ban khai bao)
 *
 * Dinh danh phan tu: uu tien role/label/test-id (ben truoc thay doi giao
 * dien), CSS chi la ung vien cuoi. Duong dan trang gom trong CRM_PATHS va
 * ghi de duoc bang bien moi truong CRM_PATH_* o tang server - cau truc route
 * cua CRM_Loyalty se xac nhan lai o vong UAT that (ban giao S5.4).
 */
import { parseSoLuong, parseSoTien } from "@autotest/oracle";

import type { LocatorSpec, PageDriver } from "./page-driver.js";
import {
  bamNut,
  choPhanTu,
  chupAnhManHinh,
  dienTruong,
  docGiaTriHienThi,
  moTrang,
  type StepContext,
} from "./steps.js";
import { StepError } from "./types.js";

export interface CrmPaths {
  dangNhapNhanVien: string;
  dangNhapBenhNhan: string;
  datLich: string;
  lichHen: string;
  kham: string;
  thanhToan: string;
  baoCaoDoanhThu: string;
  chienDich: string;
  diem: string;
}

export const DEFAULT_CRM_PATHS: CrmPaths = {
  // Da xac nhan tu ma nguon CRM_Loyalty (route group quan-tri / benh-nhan):
  // nhan vien dang nhap o /quan-tri/dang-nhap, benh nhan o /dang-nhap.
  dangNhapNhanVien: "/quan-tri/dang-nhap",
  dangNhapBenhNhan: "/dang-nhap",
  datLich: "/dat-lich",
  lichHen: "/lich-hen",
  kham: "/kham",
  thanhToan: "/thu-ngan",
  baoCaoDoanhThu: "/bao-cao/doanh-thu",
  chienDich: "/chien-dich",
  diem: "/diem-thuong",
};

export function crmPathsFromEnv(env: NodeJS.ProcessEnv): CrmPaths {
  const pick = (name: string, fallback: string) => {
    const v = env[name]?.trim();
    return v ? v : fallback;
  };
  return {
    dangNhapNhanVien: pick(
      "CRM_PATH_DANG_NHAP_NHAN_VIEN",
      DEFAULT_CRM_PATHS.dangNhapNhanVien,
    ),
    dangNhapBenhNhan: pick(
      "CRM_PATH_DANG_NHAP_BENH_NHAN",
      DEFAULT_CRM_PATHS.dangNhapBenhNhan,
    ),
    datLich: pick("CRM_PATH_DAT_LICH", DEFAULT_CRM_PATHS.datLich),
    lichHen: pick("CRM_PATH_LICH_HEN", DEFAULT_CRM_PATHS.lichHen),
    kham: pick("CRM_PATH_KHAM", DEFAULT_CRM_PATHS.kham),
    thanhToan: pick("CRM_PATH_THANH_TOAN", DEFAULT_CRM_PATHS.thanhToan),
    baoCaoDoanhThu: pick("CRM_PATH_BAO_CAO_DOANH_THU", DEFAULT_CRM_PATHS.baoCaoDoanhThu),
    chienDich: pick("CRM_PATH_CHIEN_DICH", DEFAULT_CRM_PATHS.chienDich),
    diem: pick("CRM_PATH_DIEM", DEFAULT_CRM_PATHS.diem),
  };
}

export interface ActionContext {
  driver: PageDriver;
  baseUrl: string;
  paths: CrmPaths;
  /** Vai dang thuc thi (engine truyen vao) - dang-nhap chon dung form theo vai. */
  roleId?: string;
  /** Chi dung boi hanh dong dang-nhap; khong bao gio dua vao outputs/log. */
  credentials: { username: string; password: string };
  data: Record<string, string | number | boolean>;
  /** Dang ky thuc the vua tao tren CRM de S2.4 don theo run_id (AD-5). */
  registerEntity: (type: string, entityId: string) => Promise<void>;
  step: StepContext;
  artifactsDir: string;
}

export type ActionResult = { outputs: Record<string, string | number> };
export type CrmAction = (ctx: ActionContext) => Promise<ActionResult>;

const L = {
  // Dinh danh that cua form dang nhap nhan vien CRM_Loyalty (da xac nhan tu
  // ma nguon, ca luot-564 lan luot-836): testid admin-input-email /
  // admin-input-password / admin-nut-dang-nhap, nhan "Email" / "Mat khau",
  // input name="email" / name="password". Cac ung vien cu giu lam du phong.
  username: [
    { by: "testid", id: "admin-input-email" },
    { by: "label", text: "Email" },
    { by: "css", selector: "input[name='email']" },
    { by: "label", text: "Tên đăng nhập" },
    { by: "testid", id: "login-username" },
    { by: "css", selector: "input[name='username']" },
  ],
  password: [
    { by: "testid", id: "admin-input-password" },
    { by: "label", text: "Mật khẩu" },
    { by: "css", selector: "input[name='password']" },
    { by: "testid", id: "login-password" },
    { by: "css", selector: "input[type='password']" },
  ],
  loginButton: [
    { by: "testid", id: "admin-nut-dang-nhap" },
    { by: "role", role: "button", name: "Đăng nhập" },
    { by: "testid", id: "login-submit" },
  ],
  // O nhap ma TOTP cua CRM (buoc 2FA sau mat khau, neu tai khoan co bat).
  totpCode: [{ by: "testid", id: "admin-input-totp" }],
  appShell: [
    { by: "testid", id: "app-shell" },
    { by: "role", role: "navigation" },
  ],
  patientName: [
    { by: "label", text: "Họ tên bệnh nhân" },
    { by: "label", text: "Bệnh nhân" },
    { by: "testid", id: "booking-patient-name" },
  ],
  patientPhone: [
    { by: "label", text: "Số điện thoại" },
    { by: "testid", id: "booking-patient-phone" },
  ],
  service: [
    { by: "label", text: "Dịch vụ" },
    { by: "testid", id: "booking-service" },
  ],
  datetime: [
    { by: "label", text: "Ngày giờ hẹn" },
    { by: "testid", id: "booking-datetime" },
  ],
  submitBooking: [
    { by: "role", role: "button", name: "Đặt lịch" },
    { by: "role", role: "button", name: "Lưu" },
    { by: "testid", id: "booking-submit" },
  ],
  successToast: [
    { by: "testid", id: "toast-success" },
    { by: "text", text: "thành công" },
  ],
  appointmentId: [{ by: "testid", id: "lich-hen-id" }],
  confirmButton: [
    { by: "role", role: "button", name: "Xác nhận" },
    { by: "testid", id: "appointment-confirm" },
  ],
  checkInButton: [
    { by: "role", role: "button", name: "Check-in" },
    { by: "testid", id: "appointment-checkin" },
  ],
  startExamButton: [
    { by: "role", role: "button", name: "Bắt đầu khám" },
    { by: "testid", id: "exam-start" },
  ],
  finishExamButton: [
    { by: "role", role: "button", name: "Kết thúc khám" },
    { by: "testid", id: "exam-finish" },
  ],
  payButton: [
    { by: "role", role: "button", name: "Thanh toán" },
    { by: "role", role: "button", name: "Thu tiền" },
    { by: "testid", id: "payment-submit" },
  ],
  printInvoiceButton: [
    { by: "role", role: "button", name: "In hoá đơn" },
    { by: "testid", id: "invoice-print" },
  ],
  invoiceTotal: [
    { by: "testid", id: "tong-tien" },
    { by: "label", text: "Tổng tiền" },
  ],
  invoiceId: [{ by: "testid", id: "hoa-don-id" }],
  revenueTotal: [
    { by: "testid", id: "tong-doanh-thu" },
    { by: "testid", id: "report-revenue-total" },
  ],
  revenueCount: [{ by: "testid", id: "so-lich-hen" }],
  checkInCount: [{ by: "testid", id: "so-luot-check-in" }],
  customerRevenue: [
    { by: "testid", id: "doanh-thu-khach-hang" },
    { by: "label", text: "Doanh thu khách hàng" },
  ],
  addPointsButton: [
    { by: "role", role: "button", name: "Cộng điểm" },
    { by: "testid", id: "points-add" },
  ],
  redeemPointsButton: [
    { by: "role", role: "button", name: "Đổi điểm" },
    { by: "testid", id: "points-redeem" },
  ],
  campaignName: [
    { by: "label", text: "Tên chiến dịch" },
    { by: "testid", id: "campaign-name" },
  ],
  createCampaignButton: [
    { by: "role", role: "button", name: "Tạo chiến dịch" },
    { by: "testid", id: "campaign-submit" },
  ],
} satisfies Record<string, LocatorSpec[]>;

function s(value: string | number | boolean | undefined): string {
  return value === undefined ? "" : String(value);
}

function url(base: string, path: string): string {
  const goc = base.replace(/\/$/, "");
  // Neu URL dich da chua san phan dau cua duong dan (vd. dich khai bao la
  // https://crm.../quan-tri con duong dan dang nhap la /quan-tri/dang-nhap)
  // thi khong noi trung doan do. Da gap tren may that 2026-11-08, log
  // AUTOTEST_20261108_005: trinh duyet dung o /quan-tri/quan-tri/dang-nhap
  // (trang khong ton tai) nen khong thay form dang nhap.
  try {
    const phanDau = new URL(goc).pathname.replace(/\/$/, "");
    if (
      phanDau &&
      phanDau !== "/" &&
      (path === phanDau || path.startsWith(`${phanDau}/`))
    ) {
      return `${goc}${path.slice(phanDau.length)}`;
    }
  } catch {
    // base khong phai URL day du thi giu cach noi thang nhu cu.
  }
  return `${goc}${path}`;
}

/** Mo trang lich hen cua mot lich cu the neu biet id, nguoc lai mo danh sach. */
async function moTrangLichHen(ctx: ActionContext): Promise<void> {
  const id = s(ctx.data["lichHen.id"]);
  const target = id
    ? url(ctx.baseUrl, `${ctx.paths.lichHen}/${encodeURIComponent(id)}`)
    : url(ctx.baseUrl, ctx.paths.lichHen);
  await moTrang(ctx.driver, ctx.step, target);
}

export const CRM_ACTIONS: Record<string, CrmAction> = {
  "dang-nhap": async (ctx) => {
    // CRM_Loyalty co 2 cong dang nhap rieng: nhan vien o /quan-tri/dang-nhap,
    // benh nhan o /dang-nhap. Ban cu mo thang trang goc (khong co form) nen
    // buoc dang nhap het han o o ten dang nhap - da gap tren may that
    // 2026-11-08 (lan chay AUTOTEST_20261108_003).
    const duongDan =
      ctx.roleId === "benh-nhan"
        ? ctx.paths.dangNhapBenhNhan
        : ctx.paths.dangNhapNhanVien;
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, duongDan));
    try {
      // Cho form toi 30 giay (thay vi mac dinh 15): trang dang nhap o lan
      // cham dau tien thuong phai cho CRM bien dich + hydrate xong moi co
      // form. Kem dia chi trang thuc te luc loi vao thong diep de log lan
      // sau tu noi ro trinh duyet da dung o dau (chuyen huong? 404?).
      await choPhanTu(
        ctx.driver,
        { ...ctx.step, timeoutMs: 30_000 },
        L.username,
      );
    } catch (loi) {
      throw new StepError(
        ctx.step.stepId,
        `${(loi instanceof Error ? loi.message : String(loi)).replace(/^Bước '[^']*': /, "")} (địa chỉ trang lúc lỗi: ${ctx.driver.currentUrl()})`,
      );
    }
    await dienTruong(ctx.driver, ctx.step, L.username, ctx.credentials.username);
    await dienTruong(ctx.driver, ctx.step, L.password, ctx.credentials.password);
    await bamNut(ctx.driver, ctx.step, L.loginButton);
    try {
      await choPhanTu(ctx.driver, ctx.step, L.appShell);
    } catch (loiGoc) {
      // Neu CRM bat buoc ma TOTP (2FA) sau mat khau thi bao ro ly do thay vi
      // de nguoi dung thay loi cho khung ung dung mo ho.
      const coTotp = await ctx.driver
        .waitFirstVisible(L.totpCode, { timeoutMs: 800 })
        .then(() => true)
        .catch(() => false);
      if (coTotp) {
        throw new StepError(
          ctx.step.stepId,
          "Tài khoản yêu cầu mã xác thực TOTP (2FA) sau khi nhập mật khẩu — AutoTest chưa có mã bí mật TOTP của vai này. Hãy tắt 2FA cho tài khoản test trên UAT, hoặc cấp mã bí mật TOTP để bổ sung khai báo.",
        );
      }
      throw new StepError(
        ctx.step.stepId,
        `${(loiGoc instanceof Error ? loiGoc.message : String(loiGoc)).replace(/^Bước '[^']*': /, "")} (địa chỉ trang lúc lỗi: ${ctx.driver.currentUrl()})`,
      );
    }
    return { outputs: {} };
  },

  "mo-trang-chu": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, ctx.baseUrl);
    await choPhanTu(ctx.driver, ctx.step, L.appShell);
    return { outputs: {} };
  },

  "dat-lich-hen": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.datLich));
    const hoTen = s(ctx.data["benhNhan.hoTen"]);
    const soDienThoai = s(ctx.data["benhNhan.soDienThoai"]);
    if (!hoTen || !soDienThoai) {
      throw new StepError(
        ctx.step.stepId,
        "Thiếu dữ liệu bệnh nhân đã sinh (benhNhan.hoTen / benhNhan.soDienThoai)",
      );
    }
    await dienTruong(ctx.driver, ctx.step, L.patientName, hoTen);
    await dienTruong(ctx.driver, ctx.step, L.patientPhone, soDienThoai);
    const dichVu = s(ctx.data["dichVu"]);
    if (dichVu) {
      await dienTruong(ctx.driver, ctx.step, L.service, dichVu);
    }
    const ngayGio = s(ctx.data["ngayGio"]);
    if (ngayGio) {
      await dienTruong(ctx.driver, ctx.step, L.datetime, ngayGio);
    }
    await bamNut(ctx.driver, ctx.step, L.submitBooking);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    await chupAnhManHinh(
      ctx.driver,
      ctx.step,
      `${ctx.artifactsDir}/dat-lich-hen.png`,
    );
    const outputs: Record<string, string | number> = {};
    try {
      const appointmentId = await docGiaTriHienThi(ctx.driver, ctx.step, L.appointmentId);
      if (appointmentId) {
        outputs.appointment_id = appointmentId;
        await ctx.registerEntity("lich-hen", appointmentId);
      }
    } catch {
      // CRM khong hien id tren giao dien: bo qua, doi chieu dung khoa khac o Epic 4.
    }
    return { outputs };
  },

  "xac-nhan-lich": async (ctx) => {
    await moTrangLichHen(ctx);
    await bamNut(ctx.driver, ctx.step, L.confirmButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: {} };
  },

  "check-in": async (ctx) => {
    await moTrangLichHen(ctx);
    await bamNut(ctx.driver, ctx.step, L.checkInButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: { check_in: 1 } };
  },

  "bat-dau-kham": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.kham));
    await bamNut(ctx.driver, ctx.step, L.startExamButton);
    return { outputs: {} };
  },

  "ket-thuc-kham": async (ctx) => {
    await bamNut(ctx.driver, ctx.step, L.finishExamButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: {} };
  },

  "thanh-toan": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.thanhToan));
    const outputs: Record<string, string | number> = {};
    try {
      const totalText = await docGiaTriHienThi(ctx.driver, ctx.step, L.invoiceTotal);
      // Giu van ban tho + so da phan tich bang bo phan tich dung chung
      // (S4.2 AC-3) - khong tu tach so tai day.
      outputs.so_tien_text = totalText;
      const amount = parseSoTien(totalText);
      if (amount !== null && amount > 0) outputs.so_tien = amount;
    } catch {
      // Khong doc duoc tong tien: van tiep tuc thanh toan, Epic 4 doi chieu bang API/DB.
    }
    await bamNut(ctx.driver, ctx.step, L.payButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    try {
      const invoiceId = await docGiaTriHienThi(ctx.driver, ctx.step, L.invoiceId);
      if (invoiceId) {
        outputs.invoice_id = invoiceId;
        await ctx.registerEntity("hoa-don", invoiceId);
      }
    } catch {
      // Khong hien id hoa don: bo qua dang ky, don du lieu se bao con sot neu co.
    }
    return { outputs };
  },

  "in-hoa-don": async (ctx) => {
    await bamNut(ctx.driver, ctx.step, L.printInvoiceButton);
    return { outputs: {} };
  },

  "cong-diem": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.diem));
    await bamNut(ctx.driver, ctx.step, L.addPointsButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: {} };
  },

  "doi-diem": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.diem));
    await bamNut(ctx.driver, ctx.step, L.redeemPointsButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: {} };
  },

  "tao-chien-dich": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.chienDich));
    const ten = s(ctx.data["tenChienDich"]);
    if (ten) {
      await dienTruong(ctx.driver, ctx.step, L.campaignName, ten);
    }
    await bamNut(ctx.driver, ctx.step, L.createCampaignButton);
    await choPhanTu(ctx.driver, ctx.step, L.successToast);
    return { outputs: {} };
  },

  "mo-bao-cao": async (ctx) => {
    const path = s(ctx.data["duongDan"]) || ctx.paths.baoCaoDoanhThu;
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, path));
    return { outputs: {} };
  },

  "xem-bao-cao-doanh-thu": async (ctx) => {
    await moTrang(ctx.driver, ctx.step, url(ctx.baseUrl, ctx.paths.baoCaoDoanhThu));
    // Moi so deu giu ca van ban tho (tong_doanh_thu_text...) de Reconciler
    // tu phan tich bang bo phan tich dung chung (S4.2 AC-3); so da phan
    // tich tai day chi la tien ich hien thi. Dinh danh phan tu la quy uoc
    // tam - khop lai o vong dich that (ghi chu nhu S3.1).
    const outputs: Record<string, string | number> = {};
    const totalText = await docGiaTriHienThi(ctx.driver, ctx.step, L.revenueTotal);
    outputs.tong_doanh_thu_text = totalText;
    const total = parseSoTien(totalText);
    if (total !== null) outputs.tong_doanh_thu = total;
    try {
      const countText = await docGiaTriHienThi(ctx.driver, ctx.step, L.revenueCount);
      outputs.so_lich_hen_text = countText;
      const count = parseSoLuong(countText);
      if (count !== null) outputs.so_lich_hen = count;
    } catch {
      // Bao cao khong hien so lich hen: chi tieu nay doi chieu bang nguon khac.
    }
    try {
      const checkInText = await docGiaTriHienThi(ctx.driver, ctx.step, L.checkInCount);
      outputs.so_luot_check_in_text = checkInText;
      const checkIns = parseSoLuong(checkInText);
      if (checkIns !== null) outputs.so_luot_check_in = checkIns;
    } catch {
      // Bao cao khong hien so luot check-in: doi chieu bang nguon khac.
    }
    if (s(ctx.data["doc"]) === "theo-khach") {
      const khachText = await docGiaTriHienThi(ctx.driver, ctx.step, L.customerRevenue);
      outputs.doanh_thu_khach_text = khachText;
      const khach = parseSoTien(khachText);
      if (khach !== null) outputs.doanh_thu_khach = khach;
    }
    return { outputs };
  },
};

export function getCrmAction(actionId: string): CrmAction {
  const action = CRM_ACTIONS[actionId];
  if (!action) {
    throw new StepError(actionId, `Hành động '${actionId}' chưa có bản cài đặt trong worker`);
  }
  return action;
}
