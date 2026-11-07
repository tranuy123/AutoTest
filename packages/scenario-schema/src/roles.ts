/** Dinh nghia vai dung chung (khop 5 vai tren UAT cua CRM). */

export type RoleId = "benh-nhan" | "le-tan" | "bac-si" | "thu-ngan" | "quan-ly";

/** Danh sach vai theo dung thu tu hien thi tren giao dien. */
export const ROLE_IDS: readonly RoleId[] = [
  "benh-nhan",
  "le-tan",
  "bac-si",
  "thu-ngan",
  "quan-ly",
] as const;

/** Nhan tieng Viet cua vai de hien thi. */
export const ROLE_LABELS: Record<RoleId, string> = {
  "benh-nhan": "Bệnh nhân",
  "le-tan": "Lễ tân",
  "bac-si": "Bác sĩ",
  "thu-ngan": "Thu ngân",
  "quan-ly": "Quản lý",
};

/** Tra ve danh sach vai duoi dang mang moi (khong sua hang so goc). */
export function listRoleIds(): RoleId[] {
  return [...ROLE_IDS];
}
