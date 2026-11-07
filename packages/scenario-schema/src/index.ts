/**
 * @autotest/scenario-schema - khung (S1.1).
 * Cac kieu du lieu nen tang cho kich ban kiem thu.
 * Schema validate day du se duoc xay dung o Story S2.1 - o day chi co
 * kieu khai bao va hang so dung chung, chua co logic nghiep vu.
 */

/** Vai nguoi dung tham gia kich ban (khop 5 vai tren UAT cua CRM). */
export type RoleId = "benh-nhan" | "le-tan" | "bac-si" | "thu-ngan" | "quan-ly";

/** Danh sach vai theo dung thu tu hien thi tren giao dien. */
export const ROLE_IDS: readonly RoleId[] = [
  "benh-nhan",
  "le-tan",
  "bac-si",
  "thu-ngan",
  "quan-ly",
] as const;

/** Che do chay: xem truc tiep (co stream) hoac chay nhanh (headless). */
export type RunMode = "xem-truc-tiep" | "chay-nhanh";

/** Mot buoc trong kich ban: mot vai thuc hien mot hanh dong. */
export interface ScenarioStep {
  /** Ma buoc duy nhat trong kich ban, vi du "dat-lich". */
  id: string;
  /** Vai thuc hien buoc. */
  role: RoleId;
  /** Ten hanh dong trong thu vien buoc dung chung (AD-2). */
  action: string;
  /** Ten su kien dong bo phai cho truoc khi chay buoc nay (AD-3), neu co. */
  syncEvent?: string;
}

/** Khai bao mot kich ban kiem thu (dang khung, se mo rong o S2.1). */
export interface Scenario {
  id: string;
  name: string;
  roles: RoleId[];
  steps: ScenarioStep[];
}

/** Tra ve danh sach vai duoi dang mang moi (khong sua hang so goc). */
export function listRoleIds(): RoleId[] {
  return [...ROLE_IDS];
}
