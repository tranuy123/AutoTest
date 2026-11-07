/**
 * Helper phia server cua Control App: goi Orchestrator (S2.2).
 * Browser khong goi thang orchestrator (khac cong) - moi request di qua
 * route handler cua Next de giu cung origin va tap trung cau hinh.
 */
export const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:3101";

export interface ScenarioSummaryView {
  id: string;
  name: string;
  roles: string[];
  stepCount: number;
  metricCount: number;
  createdAt: string;
}

export async function fetchScenarios(): Promise<{ ok: boolean; scenarios: ScenarioSummaryView[] }> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/scenarios`, { cache: "no-store" });
    if (!res.ok) return { ok: false, scenarios: [] };
    const data = (await res.json()) as { scenarios: ScenarioSummaryView[] };
    return { ok: true, scenarios: data.scenarios ?? [] };
  } catch {
    return { ok: false, scenarios: [] };
  }
}

export interface EnvironmentView {
  ok: boolean;
  allowed: boolean;
  reason: string;
  targetBaseUrl: string;
}

export async function fetchEnvironment(): Promise<EnvironmentView> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/environment`, { cache: "no-store" });
    if (!res.ok) return { ok: false, allowed: false, reason: "Orchestrator trả lỗi", targetBaseUrl: "" };
    const data = (await res.json()) as {
      targetBaseUrl: string;
      targetEvaluation?: { allowed: boolean; reason: string };
    };
    return {
      ok: true,
      allowed: data.targetEvaluation?.allowed ?? false,
      reason: data.targetEvaluation?.reason ?? "",
      targetBaseUrl: data.targetBaseUrl,
    };
  } catch {
    return { ok: false, allowed: false, reason: "Chưa kết nối được Orchestrator", targetBaseUrl: "" };
  }
}

/** Nhan tieng Viet cua vai (tranh import goi schema vao bundle client). */
export const ROLE_LABELS: Record<string, string> = {
  "benh-nhan": "Bệnh nhân",
  "le-tan": "Lễ tân",
  "bac-si": "Bác sĩ",
  "thu-ngan": "Thu ngân",
  "quan-ly": "Quản lý",
};

export function roleLabel(id: string): string {
  return ROLE_LABELS[id] ?? id;
}
