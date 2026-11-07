/**
 * Tai file Excel mau theo dung mau cot da tai lieu hoa (S2.1 AC-3).
 * Sinh truc tiep tu goi scenario-schema de mau luon khop bo chuyen doi.
 */
import { buildExcelTemplate } from "@autotest/scenario-schema";

export async function GET() {
  const buffer = await buildExcelTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="mau-kich-ban-autotest.xlsx"',
    },
  });
}
