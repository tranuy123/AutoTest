/**
 * Bo sinh du lieu gia danh tinh theo run_id (S2.3, FR-3, AD-5).
 * - Danh tinh GIA: ten tu danh sach ten gia co dinh, so dien thoai dung dau
 *   so 011 (dai 01x da thu hoi sau doi so 2018, khong cap phat cho thue bao
 *   di dong hien nay - cac dai di dong dang dung la 03/05/07/08/09).
 * - Cau truc THAT: lich hen tro dung benh nhan/dich vu da sinh, gia lay tu
 *   dich vu, tong ket nhat quan voi chi tiet.
 * - Moi ban ghi mang runId + nhanDienTest = "AUTOTEST_<runId>".
 * - Co seed: cung seed + cung khai bao -> cung bo du lieu (tai hien loi).
 *   Mac dinh seed = runId nen 2 lan chay khac nhau khong trung khoa/du lieu.
 */
import type { DataGenBlock } from "@autotest/scenario-schema";

/* ---------------- RNG co seed (mulberry32 + FNV-1a hash) ---------------- */

export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- Danh sach ten gia co dinh ---------------- */

const HO = [
  "Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Vũ", "Võ",
  "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh",
];
const DEM_NAM = ["Văn", "Hữu", "Đức", "Minh", "Quốc", "Thanh", "Xuân", "Đình"];
const TEN_NAM = [
  "An", "Bình", "Cường", "Dũng", "Hiếu", "Khải", "Long", "Nam",
  "Phúc", "Quân", "Sơn", "Tuấn", "Việt", "Hùng", "Khoa", "Trung",
];
const DEM_NU = ["Thị", "Ngọc", "Thu", "Phương", "Thanh", "Mỹ", "Kim", "Bích"];
const TEN_NU = [
  "Anh", "Chi", "Dung", "Hà", "Hương", "Lan", "Linh", "Mai",
  "Ngân", "Oanh", "Phương", "Trang", "Tuyết", "Vy", "Yến", "Giang",
];

/* ---------------- Kieu du lieu sinh ra ---------------- */

export interface GeneratedPatient {
  id: string;
  runId: string;
  nhanDienTest: string;
  hoTen: string;
  soDienThoai: string;
  ngaySinh: string;
  gioiTinh: "nam" | "nu";
}

export interface GeneratedService {
  ma: string;
  runId: string;
  nhanDienTest: string;
  ten: string;
  gia: number;
}

export interface GeneratedAppointment {
  id: string;
  runId: string;
  nhanDienTest: string;
  benhNhanId: string;
  dichVuMa: string;
  ngayGio: string;
  gia: number;
  trangThai: "da-dat";
}

export interface GeneratedExtra {
  id: string;
  runId: string;
  nhanDienTest: string;
  loai: string;
  truong: Record<string, string | number | boolean>;
}

export interface GeneratedRunData {
  runId: string;
  seed: string;
  nhanDienTest: string;
  benhNhan: GeneratedPatient[];
  dichVu: GeneratedService[];
  lichHen: GeneratedAppointment[];
  phuTro: GeneratedExtra[];
  thongKe: {
    soBenhNhan: number;
    soDichVu: number;
    soLichHen: number;
    tongGiaLichHen: number;
  };
}

export interface BannedDataList {
  names: string[];
  phones: string[];
}

export const EMPTY_BANNED_LIST: BannedDataList = { names: [], phones: [] };

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Ngay nghiep vu cua lan chay: lay phan ngay tu run_id AUTOTEST_YYYYMMDD_NNN. */
function businessDay(runId: string): string {
  const match = /^AUTOTEST_(\d{4})(\d{2})(\d{2})_\d+$/.exec(runId);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

export function generateRunData(input: {
  runId: string;
  seed?: string;
  dataGen?: DataGenBlock;
  banned?: BannedDataList;
}): GeneratedRunData {
  const { runId } = input;
  const seed = input.seed ?? runId;
  const dataGen = input.dataGen ?? {};
  const marker = `AUTOTEST_${runId}`;
  const rand = mulberry32(hashSeed(seed));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  // --- Benh nhan ---
  const soBenhNhan = dataGen.benhNhan?.soLuong ?? 0;
  const usedPhones = new Set<string>();
  const benhNhan: GeneratedPatient[] = [];
  for (let i = 0; i < soBenhNhan; i++) {
    const gioiTinh = rand() < 0.5 ? "nam" : "nu";
    const hoTen =
      gioiTinh === "nam"
        ? `${pick(HO)} ${pick(DEM_NAM)} ${pick(TEN_NAM)}`
        : `${pick(HO)} ${pick(DEM_NU)} ${pick(TEN_NU)}`;
    let phone = "";
    do {
      phone = "011" + String(Math.floor(rand() * 10_000_000)).padStart(7, "0");
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    const year = int(1955, 2015);
    const month = int(1, 12);
    const day = int(1, 28);
    benhNhan.push({
      id: `${runId}-BN${pad(i + 1, 3)}`,
      runId,
      nhanDienTest: marker,
      hoTen,
      soDienThoai: phone,
      ngaySinh: `${year}-${pad(month, 2)}-${pad(day, 2)}`,
      gioiTinh,
    });
  }

  // --- Dich vu (theo khai bao cua kich ban) ---
  const dichVu: GeneratedService[] = (dataGen.dichVu ?? []).map((dv) => ({
    ma: dv.ma,
    runId,
    nhanDienTest: marker,
    ten: dv.ten,
    gia: dv.gia,
  }));

  // --- Lich hen (gan vong tron vao benh nhan/dich vu da sinh) ---
  const soLichHen = dataGen.lichHen?.soLuong ?? 0;
  const day = businessDay(runId);
  const lichHen: GeneratedAppointment[] = [];
  for (let i = 0; i < soLichHen; i++) {
    const bn = benhNhan.length ? benhNhan[i % benhNhan.length] : undefined;
    const dv = dichVu.length ? dichVu[i % dichVu.length] : undefined;
    if (!bn || !dv) break;
    const gio = 8 + Math.floor(i / 2);
    const phut = i % 2 === 0 ? "00" : "30";
    lichHen.push({
      id: `${runId}-LH${pad(i + 1, 3)}`,
      runId,
      nhanDienTest: marker,
      benhNhanId: bn.id,
      dichVuMa: dv.ma,
      ngayGio: `${day}T${pad(gio, 2)}:${phut}:00+07:00`,
      gia: dv.gia,
      trangThai: "da-dat",
    });
  }

  // --- Thuc the phu tro (theo khai bao) ---
  const phuTro: GeneratedExtra[] = [];
  for (const khai of dataGen.phuTro ?? []) {
    for (let i = 0; i < khai.soLuong; i++) {
      phuTro.push({
        id: `${runId}-PT-${khai.loai}-${pad(i + 1, 3)}`,
        runId,
        nhanDienTest: marker,
        loai: khai.loai,
        truong: { ...(khai.truong ?? {}) },
      });
    }
  }

  const data: GeneratedRunData = {
    runId,
    seed,
    nhanDienTest: marker,
    benhNhan,
    dichVu,
    lichHen,
    phuTro,
    thongKe: {
      soBenhNhan: benhNhan.length,
      soDichVu: dichVu.length,
      soLichHen: lichHen.length,
      tongGiaLichHen: lichHen.reduce((sum, lh) => sum + lh.gia, 0),
    },
  };

  const banned = input.banned ?? EMPTY_BANNED_LIST;
  const violations = findBannedData(data, banned);
  if (violations.length > 0) {
    throw new BannedDataError(violations);
  }
  return data;
}

export class BannedDataError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`Dữ liệu sinh ra chứa dữ liệu nằm trong danh sách cấm: ${violations.join("; ")}`);
    this.name = "BannedDataError";
    this.violations = violations;
  }
}

/** Kiem tra bo du lieu co chua ten/so dien thoai bi cam (du lieu that) hay khong. */
export function findBannedData(data: GeneratedRunData, banned: BannedDataList): string[] {
  const violations: string[] = [];
  const bannedNames = new Set(banned.names.map((n) => n.trim().toLowerCase()));
  const bannedPhones = new Set(banned.phones.map((p) => p.trim()));
  for (const bn of data.benhNhan) {
    if (bannedNames.has(bn.hoTen.trim().toLowerCase())) {
      violations.push(`tên '${bn.hoTen}' (${bn.id}) nằm trong danh sách cấm`);
    }
    if (bannedPhones.has(bn.soDienThoai)) {
      violations.push(`số điện thoại của ${bn.id} nằm trong danh sách cấm`);
    }
  }
  return violations;
}
