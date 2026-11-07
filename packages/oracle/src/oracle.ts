/**
 * Oracle tinh ky vong doanh thu doc lap (S4.1, FR-7, AD-4).
 *
 * Cong thuc viet tu tai lieu QUY-TAC-DOANH-THU.md trong chinh goi nay
 * (QT-1..QT-6) - TUYET DOI khong import/sao chep code tinh bao cao cua
 * CRM. Oracle chi doc du lieu dau vao cua lan chay (du lieu da sinh o
 * S2.3 + ket qua luan chuyen cua lan chay), khong bao gio doc so tu he
 * thong dich: so cua dich la doi tuong bi kiem tra o Reconciler (S4.2).
 *
 * Tien lam viec bang so nguyen dong; dau vao khong nguyen bi tu choi.
 */

export type TrangThaiGiaoDich =
  | "da-thanh-toan"
  | "da-huy"
  | "da-hoan-tien"
  | "chua-thanh-toan";

/** Mot giao dich ky vong - dau vao cua Oracle. */
export interface GiaoDich {
  /** Dinh danh ban ghi (lich hen/hoa don cua lan chay). */
  id: string;
  benhNhanId: string;
  dichVuMa: string;
  /** Thoi diem thanh toan dang ISO 8601 (co mui gio, vd "2026-11-07T09:00:00+07:00"). */
  thoiDiem: string;
  /** Gia goc cua dich vu, so nguyen dong (QT-2). */
  giaGoc: number;
  /** So tien giam truc tiep, so nguyen dong, mac dinh 0 (QT-2). */
  giamTien?: number;
  /** Phan tram giam tren gia goc, 0-100, mac dinh 0 (QT-2). */
  giamPhanTram?: number;
  trangThai: TrangThaiGiaoDich;
}

export interface KyVongDoanhThu {
  /** Tong doanh thu theo ngay lich Asia/Saigon: { "2026-11-07": 300000 }. */
  tongTheoNgay: Record<string, number>;
  /** Doanh thu theo benh nhan: { benhNhanId: tong }. */
  theoKhachHang: Record<string, number>;
  /** Doanh thu theo dich vu: { dichVuMa: tong }. */
  theoDichVu: Record<string, number>;
  /** Tong toan bo - bang tong cua ca ba chieu (bat bien QT-5). */
  tongDoanhThu: number;
  /** So giao dich duoc ghi nhan doanh thu (trang thai da-thanh-toan). */
  soGiaoDichDuocTinh: number;
}

function loiDauVao(gd: GiaoDich, lyDo: string): Error {
  return new Error(`Oracle: giao dịch '${gd.id}' không hợp lệ — ${lyDo}`);
}

function kiemTraGiaoDich(gd: GiaoDich): void {
  if (!Number.isInteger(gd.giaGoc) || gd.giaGoc < 0) {
    throw loiDauVao(gd, `giaGoc phải là số nguyên đồng >= 0, nhận được ${gd.giaGoc}`);
  }
  const giamTien = gd.giamTien ?? 0;
  if (!Number.isInteger(giamTien) || giamTien < 0) {
    throw loiDauVao(gd, `giamTien phải là số nguyên đồng >= 0, nhận được ${giamTien}`);
  }
  const giamPhanTram = gd.giamPhanTram ?? 0;
  if (!Number.isFinite(giamPhanTram) || giamPhanTram < 0 || giamPhanTram > 100) {
    throw loiDauVao(gd, `giamPhanTram phải trong [0, 100], nhận được ${giamPhanTram}`);
  }
  if (Number.isNaN(new Date(gd.thoiDiem).getTime())) {
    throw loiDauVao(gd, `thoiDiem không phải thời gian ISO hợp lệ: '${gd.thoiDiem}'`);
  }
}

const dinhDangNgaySaigon = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Saigon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Ngay lich (YYYY-MM-DD) tai Asia/Saigon cua mot thoi diem ISO (QT-4). */
export function ngaySaigon(thoiDiem: string): string {
  const date = new Date(thoiDiem);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Oracle: thoiDiem không hợp lệ: '${thoiDiem}'`);
  }
  return dinhDangNgaySaigon.format(date);
}

/**
 * So tien thuc thu cua mot giao dich (QT-1, QT-2, QT-3).
 * Trang thai khong phai da-thanh-toan -> 0. Giam gia khong lam am tien.
 */
export function soTienThucThu(gd: GiaoDich): number {
  kiemTraGiaoDich(gd);
  if (gd.trangThai !== "da-thanh-toan") return 0;
  const giamTien = gd.giamTien ?? 0;
  const giamTheoPhanTram = Math.floor((gd.giaGoc * (gd.giamPhanTram ?? 0)) / 100);
  const thucThu = gd.giaGoc - giamTien - giamTheoPhanTram;
  return Math.max(0, thucThu);
}

/** Tinh toan bo ky vong doanh thu tu danh sach giao dich (QT-1..QT-5). */
export function tinhKyVongDoanhThu(giaoDich: readonly GiaoDich[]): KyVongDoanhThu {
  const tongTheoNgay: Record<string, number> = {};
  const theoKhachHang: Record<string, number> = {};
  const theoDichVu: Record<string, number> = {};
  let tongDoanhThu = 0;
  let soGiaoDichDuocTinh = 0;

  for (const gd of giaoDich) {
    const thucThu = soTienThucThu(gd);
    if (gd.trangThai !== "da-thanh-toan") continue;
    soGiaoDichDuocTinh++;
    if (thucThu === 0) continue;
    const ngay = ngaySaigon(gd.thoiDiem);
    tongTheoNgay[ngay] = (tongTheoNgay[ngay] ?? 0) + thucThu;
    theoKhachHang[gd.benhNhanId] = (theoKhachHang[gd.benhNhanId] ?? 0) + thucThu;
    theoDichVu[gd.dichVuMa] = (theoDichVu[gd.dichVuMa] ?? 0) + thucThu;
    tongDoanhThu += thucThu;
  }

  return { tongTheoNgay, theoKhachHang, theoDichVu, tongDoanhThu, soGiaoDichDuocTinh };
}

/* ------------- Chuyen du lieu sinh (S2.3) thanh giao dich ------------- */

/** Hinh dang toi thieu cua mot lich hen da sinh - doc lap voi orchestrator. */
export interface LichHenSinhToiThieu {
  id: string;
  benhNhanId: string;
  dichVuMa: string;
  ngayGio: string;
  gia: number;
}

export interface DuLieuSinhToiThieu {
  lichHen: readonly LichHenSinhToiThieu[];
}

/**
 * Ket qua luan chuyen cua lan chay do orchestrator xac dinh tu ket qua
 * cac buoc (buoc thanh toan/huy nao da qua) - Oracle khong tu suy doan.
 */
export interface KetQuaLuanChuyen {
  /** Id cac lich da thanh toan thanh cong trong lan chay. */
  lichDaThanhToan: ReadonlySet<string>;
  /** Id cac lich bi huy trong lan chay. */
  lichDaHuy?: ReadonlySet<string>;
  /** Giam tien truc tiep theo lich (dong). */
  giamTienTheoLich?: ReadonlyMap<string, number>;
  /** Giam theo phan tram theo lich (0-100). */
  giamPhanTramTheoLich?: ReadonlyMap<string, number>;
}

/**
 * Chuyen bo du lieu da sinh thanh danh sach giao dich cua Oracle (QT-6):
 * lich da thanh toan -> da-thanh-toan (thoi diem thanh toan mac dinh bang
 * thoi diem lich hen), lich da huy -> da-huy, con lai -> chua-thanh-toan.
 */
export function giaoDichTuDuLieuSinh(
  data: DuLieuSinhToiThieu,
  ketQua: KetQuaLuanChuyen,
): GiaoDich[] {
  return data.lichHen.map((lh) => {
    const trangThai: TrangThaiGiaoDich = ketQua.lichDaThanhToan.has(lh.id)
      ? "da-thanh-toan"
      : ketQua.lichDaHuy?.has(lh.id)
        ? "da-huy"
        : "chua-thanh-toan";
    return {
      id: lh.id,
      benhNhanId: lh.benhNhanId,
      dichVuMa: lh.dichVuMa,
      thoiDiem: lh.ngayGio,
      giaGoc: lh.gia,
      ...(ketQua.giamTienTheoLich?.has(lh.id)
        ? { giamTien: ketQua.giamTienTheoLich.get(lh.id) as number }
        : {}),
      ...(ketQua.giamPhanTramTheoLich?.has(lh.id)
        ? { giamPhanTram: ketQua.giamPhanTramTheoLich.get(lh.id) as number }
        : {}),
      trangThai,
    };
  });
}
