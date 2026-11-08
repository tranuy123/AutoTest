/**
 * Trang nhat ky lan chay (S5.6): xem toan bo log cua mot lan chay khi
 * khong xem truc tiep duoc (stream mat tin hieu/trinh duyet chan), va
 * tai file .txt gui di ho tro. Du lieu ban dau lay phia server; client
 * poll tiep moi ~3 giay khi lan chay dang chay.
 */
import Link from "next/link";

import NhatKyClient from "../../../components/NhatKyClient";
import { fetchRunLogs } from "../../../../lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function TrangNhatKy({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const logs = await fetchRunLogs(runId);
  return (
    <>
      <p className="mo-ta" style={{ marginBottom: 4 }}>
        <Link href={`/lan-chay/${encodeURIComponent(runId)}`}>
          ← Về trang lần chạy (xem trực tiếp)
        </Link>
      </p>
      <h1>Nhật ký lần chạy {runId}</h1>
      <p className="mo-ta">
        Toàn bộ dòng nhật ký của lần chạy theo thứ tự thời gian (giờ Asia/Saigon):
        dòng lỗi đỏ, cảnh báo vàng. Log đã được hệ thống tự che dữ liệu nhạy cảm
        (số điện thoại, email, mật khẩu) trước khi lưu — cần hỗ trợ thì bấm
        &quot;Tải log (.txt)&quot; và gửi nguyên file đó.
      </p>
      <NhatKyClient runId={runId} banDau={logs} />
    </>
  );
}
