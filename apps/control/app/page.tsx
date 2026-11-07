/**
 * Trang chinh - khung S1.1: hien trang thai san sang va ket qua goi
 * kiem tra suc khoe cua orchestrator (phia server).
 * Giao dien chay kich ban day du se duoc xay dung o cac story Epic 2/3/5.
 */
export const dynamic = "force-dynamic";

interface HealthKetQua {
  ok: boolean;
  chiTiet: string;
}

async function kiemTraOrchestrator(): Promise<HealthKetQua> {
  const url = process.env.ORCHESTRATOR_URL ?? "http://localhost:3101";
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false, chiTiet: `Orchestrator trả mã ${res.status}` };
    const data: unknown = await res.json();
    const status =
      typeof data === "object" && data !== null && "status" in data
        ? String((data as { status: unknown }).status)
        : "không rõ";
    return { ok: status === "ok", chiTiet: `Orchestrator: status = ${status}` };
  } catch {
    return { ok: false, chiTiet: "Chưa kết nối được Orchestrator" };
  }
}

export default async function TrangChinh() {
  const health = await kiemTraOrchestrator();
  return (
    <>
      <h1>AutoTest</h1>
      <p className="mo-ta">
        Hệ thống tự động kiểm thử trên môi trường UAT cho CRM_Loyalty. Trang khung của
        Story S1.1 — chức năng nạp kịch bản và chạy kiểm thử sẽ xuất hiện ở các story tiếp
        theo.
      </p>
      <div className="the">
        <p style={{ marginTop: 0 }}>
          {health.ok ? (
            <span className="trang-thai ok">● Hệ thống sẵn sàng</span>
          ) : (
            <span className="trang-thai xau">● Hệ thống chưa sẵn sàng</span>
          )}
        </p>
        <p className="so-lieu" style={{ marginBottom: 0 }}>
          {health.chiTiet}
        </p>
      </div>
    </>
  );
}
