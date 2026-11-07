/**
 * Spike S3.0 - bo ma hoa/giai ma "dong ho khoi" dung chung.
 * Trang dich ve mot bo dem mili-giay (9 chu so) bang o khoi 3x5 rat lon.
 * Phia xem (canvas cua CDP viewer hoac canvas noVNC) doc lai cac o khoi
 * bang cach lay mau diem anh o tam o - khong can OCR, chiu duoc nen JPEG.
 * Ham decode phai TU CHUA (self-contained) de truyen qua page.evaluate.
 */

export const CLOCK_GEOMETRY = {
  /** Vi tri canvas dong ho trong trang (px). */
  originX: 10,
  originY: 10,
  /** Vi tri bat dau ve chu so ben trong canvas. */
  padX: 10,
  padY: 10,
  /** Kich thuoc 1 o khoi (px). */
  cell: 12,
  /** Buoc ngang giua 2 chu so: 3 o * cell + khoang 6px. */
  digitStep: 42,
  digits: 9,
  regionW: 392,
  regionH: 80,
};

/** Bang khoi 3x5 cho chu so 0-9 (dong tu tren xuong duoi, "1" = sang). */
export const DIGIT_BLOCKS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "010", "010", "010", "010"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

/**
 * Giai ma gia tri dong ho tu 1 canvas. Tra ve so ms da hien thi hoac null
 * neu chua doc duoc (canvas trong/khac dinh dang). Self-contained: chi
 * dung tham so truyen vao.
 */
export function decodeClockFromCanvas(canvas, geo) {
  if (!canvas || canvas.width < geo.regionW || canvas.height < geo.regionH) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let full;
  try {
    full = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  // Tim neo magenta (#FF00FF) o goc tren-trai viewport: diem anh dau tien
  // (quet tu tren xuong, trai sang phai) co R,B cao va G thap.
  const fd = full.data;
  const fw = full.width;
  let anchorX = -1;
  let anchorY = -1;
  outer: for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < fw; x++) {
      const idx = (y * fw + x) * 4;
      if (fd[idx] > 170 && fd[idx + 1] < 130 && fd[idx + 2] > 170) {
        anchorX = x;
        anchorY = y;
        break outer;
      }
    }
  }
  if (anchorX < 0) return null;
  const originX = anchorX + geo.originX;
  const originY = anchorY + geo.originY;
  if (originX + geo.regionW > canvas.width || originY + geo.regionH > canvas.height) return null;
  let img;
  try {
    img = ctx.getImageData(originX, originY, geo.regionW, geo.regionH);
  } catch {
    return null;
  }
  const { data, width } = img;
  const blocks = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "010", "010", "010", "010"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
  };
  const byPattern = new Map(
    Object.entries(blocks).map(([digit, rows]) => [rows.join("/"), digit]),
  );
  let text = "";
  for (let d = 0; d < geo.digits; d++) {
    const rows = [];
    for (let r = 0; r < 5; r++) {
      let row = "";
      for (let c = 0; c < 3; c++) {
        const x = geo.padX + d * geo.digitStep + c * geo.cell + Math.floor(geo.cell / 2);
        const y = geo.padY + r * geo.cell + Math.floor(geo.cell / 2);
        const idx = (y * width + x) * 4;
        const lum = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
        row += lum > 110 ? "1" : "0";
      }
      rows.push(row);
    }
    const digit = byPattern.get(rows.join("/"));
    if (digit === undefined) return null;
    text += digit;
  }
  return Number.parseInt(text, 10);
}
