/**
 * Trang xem mot lan chay (S3.2): luoi stream theo vai cho che do xem truc
 * tiep, lop phu khong-stream cho che do chay nhanh (S3.4 AC-1).
 * Trang thai ban dau lay phia server; client poll tiep moi 1.5 giay.
 */
import XemTrucTiepClient from "../../components/XemTrucTiepClient";
import { fetchRunStreams } from "../../../lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function TrangLanChay({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const streams = await fetchRunStreams(runId);
  return (
    <>
      <h1>Lần chạy {runId}</h1>
      <p className="mo-ta">
        Xem trực tiếp thao tác của từng vai trên UAT. Mỗi ô là một phiên trình duyệt
        riêng; viền vàng = đang chạy, xanh = xong, đỏ = lỗi, xám = đang chờ.
      </p>
      <XemTrucTiepClient runId={runId} banDau={streams} />
    </>
  );
}
