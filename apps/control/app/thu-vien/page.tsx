/**
 * Trang Thu vien kich ban (S2.2 AC-3): danh sach lay phia server,
 * tim/chi tiet/xoa o ThuVienClient.
 */
import ThuVienClient from "../components/ThuVienClient";
import { fetchScenarios } from "../../lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function ThuVien() {
  const res = await fetchScenarios();
  return <ThuVienClient scenariosBanDau={res.scenarios} orchestratorOk={res.ok} />;
}
