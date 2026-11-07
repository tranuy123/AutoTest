/**
 * Thu vien buoc dung chung (AD-2).
 * Kich ban chi duoc ghep cac hanh dong co trong danh sach nay; hanh dong
 * ngoai danh sach bi validate chan (AC S2.1-4: "buoc khong ton tai").
 * Hanh dong that (thao tac Playwright tren CRM) thuoc Epic 3 - o day moi
 * la dinh danh + mo ta de kich ban tham chieu.
 */
export interface StepAction {
  id: string;
  ten: string;
  moTa: string;
}

export const STEP_ACTIONS: readonly StepAction[] = [
  { id: "dang-nhap", ten: "Đăng nhập", moTa: "Đăng nhập bằng tài khoản của vai trên UAT" },
  { id: "mo-trang-chu", ten: "Mở trang chủ", moTa: "Mở trang chủ/dashboard của CRM" },
  { id: "dat-lich-hen", ten: "Đặt lịch hẹn", moTa: "Tạo lịch hẹn mới từ dữ liệu đã sinh" },
  { id: "xac-nhan-lich", ten: "Xác nhận lịch", moTa: "Lễ tân xác nhận lịch hẹn vừa đặt" },
  { id: "check-in", ten: "Check-in", moTa: "Check-in bệnh nhân khi tới phòng khám" },
  { id: "bat-dau-kham", ten: "Bắt đầu khám", moTa: "Bác sĩ bắt đầu lượt khám" },
  { id: "ket-thuc-kham", ten: "Kết thúc khám", moTa: "Bác sĩ kết thúc lượt khám" },
  { id: "thanh-toan", ten: "Thanh toán", moTa: "Thu ngân thu tiền theo hoá đơn của lịch hẹn" },
  { id: "in-hoa-don", ten: "In hoá đơn", moTa: "Mở/in hoá đơn sau thanh toán" },
  { id: "cong-diem", ten: "Cộng điểm", moTa: "Cộng điểm loyalty sau thanh toán" },
  { id: "doi-diem", ten: "Đổi điểm", moTa: "Đổi điểm loyalty lấy ưu đãi" },
  { id: "tao-chien-dich", ten: "Tạo chiến dịch", moTa: "Tạo chiến dịch chăm sóc khách hàng" },
  { id: "mo-bao-cao", ten: "Mở báo cáo", moTa: "Mở một báo cáo theo tham số" },
  {
    id: "xem-bao-cao-doanh-thu",
    ten: "Xem báo cáo doanh thu",
    moTa: "Mở báo cáo doanh thu (29.1/29.2) và đọc số liệu hiển thị",
  },
] as const;

export const STEP_ACTION_IDS: ReadonlySet<string> = new Set(STEP_ACTIONS.map((a) => a.id));

export function isKnownAction(id: string): boolean {
  return STEP_ACTION_IDS.has(id);
}
