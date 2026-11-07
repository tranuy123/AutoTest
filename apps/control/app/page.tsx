/**
 * Trang chinh (S2.2): khu "Bat dau o day - 3 buoc" theo ban mau da duyet.
 * Du lieu ban dau (thu vien + trang thai moi truong) lay phia server tu
 * orchestrator; tuong tac nap/chon/chay nam o TrangChinhClient.
 */
import TrangChinhClient from "./components/TrangChinhClient";
import { fetchEnvironment, fetchScenarios } from "../lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function TrangChinh() {
  const [scenariosRes, env] = await Promise.all([fetchScenarios(), fetchEnvironment()]);
  return (
    <TrangChinhClient
      scenariosBanDau={scenariosRes.scenarios}
      orchestratorOk={scenariosRes.ok && env.ok}
      envAllowed={env.allowed}
      envReason={env.reason}
      targetBaseUrl={env.targetBaseUrl}
    />
  );
}
