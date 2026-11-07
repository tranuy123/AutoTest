/**
 * Bo phan tich so tien / so luong dung chung (S4.2 AC-3).
 *
 * Ly do ton tai: bao cao CRM hien so tien dang chuoi dinh dang Viet Nam
 * ("900.000 đ") - bo e2e cu cua CRM tung hong spec 29.2/38.6 vi so sanh
 * chuoi tho. Moi noi can doc so tu van ban hien thi (worker doc UI,
 * Reconciler doi chieu) deu phai qua bo phan tich nay, khong tu tach so.
 *
 * Nguyen tac:
 * - Chi tra so nguyen (VND khong co phan le; so luong la so nguyen).
 * - Khong doan: dinh dang mo ho (gom nhom sai, phan thap phan khac 0,
 *   con sot ky tu la) -> null, de tang doi chieu bao "khong doc duoc"
 *   thay vi so sanh bang mot con so sai.
 */

/** Bo khoang trang (ke ca NBSP) o hai dau. */
function chuanHoaKhoangTrang(text: string): string {
  return text.replace(/[\u00a0\u202f\u2009]/g, " ").trim();
}

const DON_VI_TIEN = ["vnd", "vnđ", "đồng", "đ", "₫"];

/** Cat bo don vi tien o cuoi chuoi (khong phan biet hoa thuong). */
function catDonViTien(text: string): string {
  let out = text;
  let thayDoi = true;
  while (thayDoi) {
    thayDoi = false;
    const lower = out.toLowerCase();
    for (const donVi of DON_VI_TIEN) {
      if (lower.endsWith(donVi)) {
        out = out.slice(0, out.length - donVi.length).trim();
        thayDoi = true;
        break;
      }
    }
  }
  return out;
}

function soAnToan(chuoiSo: string): number | null {
  if (!/^\d+$/.test(chuoiSo)) return null;
  const so = Number(chuoiSo);
  return Number.isSafeInteger(so) ? so : null;
}

/**
 * Phan tich so nguyen, cho phep phan thap phan bang 0 o cuoi:
 * - "900000" -> 900000
 * - Gom nhom "." (Viet Nam): "900.000", "1.234.500", kem thap phan ",00"
 * - Gom nhom "," (kieu My): "1,234,500", kem thap phan ".00"
 * - Mot dau tach + 1-2 chu so o cuoi = phan thap phan: "1500,00" -> 1500,
 *   "900,5" -> null (thap phan khac 0), "1.234" la gom nhom -> 1234.
 * Gom nhom sai (nhom khong dung 3 chu so) -> null.
 */
function phanTichSoNguyen(text: string, choPhepThapPhanKhong: boolean): number | null {
  if (/^\d+$/.test(text)) return soAnToan(text);

  const gomCham = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text);
  if (gomCham) {
    const thapPhan = gomCham[2];
    if (thapPhan !== undefined && (!choPhepThapPhanKhong || !/^0+$/.test(thapPhan))) {
      return null;
    }
    return soAnToan((gomCham[1] ?? "").replaceAll(".", ""));
  }
  const gomPhay = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(text);
  if (gomPhay) {
    const thapPhan = gomPhay[2];
    if (thapPhan !== undefined && (!choPhepThapPhanKhong || !/^0+$/.test(thapPhan))) {
      return null;
    }
    return soAnToan((gomPhay[1] ?? "").replaceAll(",", ""));
  }
  const motDau = /^(\d+)[.,](\d{1,2})$/.exec(text);
  if (motDau) {
    if (!choPhepThapPhanKhong || !/^0+$/.test(motDau[2] ?? "")) return null;
    return soAnToan(motDau[1] ?? "");
  }
  return null;
}

/**
 * Phan tich so tien tu van ban hien thi -> so nguyen dong, hoac null neu
 * khong doc duoc mot cach chac chan.
 * Chap nhan: "900.000 đ", "1.234.500₫", "300.000 VND", "500000",
 * "900.000,00 đ" (phan thap phan bang 0), khoang trang NBSP.
 * Tu choi: chu la, so am, phan thap phan khac 0 ("900,5"), gom nhom sai.
 */
export function parseSoTien(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = catDonViTien(chuanHoaKhoangTrang(String(input)));
  if (text.length === 0) return null;
  if (text.startsWith("-") || text.startsWith("+")) return null;
  if (!/^[\d.,]+$/.test(text)) return null;
  return phanTichSoNguyen(text, true);
}

/**
 * Phan tich so luong tu van ban hien thi: "12", "1.234 lượt",
 * "3 lượt check-in". So phai dung o dau chuoi; phan chu phia sau chi
 * duoc la don vi/chu thich khong chua chu so; so luong khong co phan
 * thap phan.
 */
export function parseSoLuong(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = chuanHoaKhoangTrang(String(input));
  if (text.length === 0) return null;
  const khop = /^([\d.,]+)(.*)$/.exec(text);
  if (!khop) return null;
  const phanSo = khop[1] ?? "";
  const phanChu = (khop[2] ?? "").trim();
  if (/\d/.test(phanChu)) return null;
  return phanTichSoNguyen(phanSo, false);
}

/** Dinh dang so nguyen dong thanh chuoi hien thi kieu Viet Nam: 900000 -> "900.000 đ". */
export function formatSoTien(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(`formatSoTien chi nhan so nguyen dong, nhan duoc: ${value}`);
  }
  const am = value < 0;
  const chuoi = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${am ? "-" : ""}${chuoi} đ`;
}
