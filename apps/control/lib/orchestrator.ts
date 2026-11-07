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

/* ---------------- Xem truc tiep (S3.2) + chay nhanh (S3.4) ---------------- */

export interface RoleStreamView {
  roleId: string;
  label: string;
  state: "cho" | "dang-chay" | "xong" | "loi";
  stateLabel: string;
  currentStepId: string | null;
  currentStepLabel: string | null;
  sessionId: string | null;
  stream: { state: string; wsUrl: string | null } | null;
}

export interface RunStreamsView {
  runId: string;
  mode: string;
  fastMode: boolean;
  roles: RoleStreamView[];
  /** S5.2 AC-1: vi tri hang doi lan chay (null = khong xep hang). */
  queuePosition?: number | null;
  runStatus?: string;
}

export async function fetchRunStreams(runId: string): Promise<RunStreamsView | null> {
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/streams`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as RunStreamsView;
  } catch {
    return null;
  }
}

export interface RunDetailView {
  runId: string;
  status: string;
  resultLabel: string;
  cleanupStatus: string | null;
  videoPath: string | null;
}

export async function fetchRunDetail(runId: string): Promise<RunDetailView | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RunDetailView;
    return data;
  } catch {
    return null;
  }
}

/* ---------------- Trang ket qua lan chay (S5.1) ---------------- */

export interface DoiChieuDongView {
  id: string;
  ten: string;
  donVi: string;
  kyVong: number | null;
  ui: number | null;
  api: number | null;
  db: number | null;
  ketQua: "khop" | "lech" | "khong-kiem-chung-duoc";
  doLech: Record<string, number>;
  ghiChu: string[];
}

export interface BangDoiChieuView {
  runId: string;
  ngay: string;
  cacChiTieu: DoiChieuDongView[];
  ketQua: "qua" | "hong";
  soKhop: number;
  soLech: number;
  soKhongKiemChung: number;
}

export interface RoleVideoView {
  roleId: string;
  label: string;
  available: boolean;
  url: string | null;
  reason: string | null;
}

export interface RunStepView {
  stepId: string;
  name: string;
  roleId: string;
  status: string;
  error: string | null;
}

export interface CleanupLeftoverView {
  type: string;
  entityId: string;
  lyDo: string;
}

export interface CleanupReportView {
  runId: string;
  daDon: number;
  conSot: CleanupLeftoverView[];
  sach: boolean;
  duong: string;
}

export interface SandboxCheckView {
  runId: string;
  checkedAt: string;
  channels: string[];
  outcome: string;
  allowed: boolean;
  reason: string;
}

export interface RunResultView {
  runId: string;
  scenarioId: string;
  scenarioName: string | null;
  mode: string;
  modeLabel: string;
  status: string;
  resultLabel: string;
  startedAt: string;
  finishedAt: string | null;
  ketLuan: string | null;
  steps: RunStepView[];
  kiemDem: BangDoiChieuView | null;
  videos: RoleVideoView[];
  cleanup: CleanupReportView | null;
  sandboxCheck: SandboxCheckView | null;
  /** S5.2: thong tin dung theo yeu cau (null = lan chay khong bi dung). */
  stop: { requestedAt: string; forcedSessions: number; note: string } | null;
  input: {
    seed: string;
    data: {
      thongKe: {
        soBenhNhan: number;
        soDichVu: number;
        soLichHen: number;
        tongGiaLichHen: number;
      };
    };
  } | null;
  reportDownloadUrl: string;
}

export async function fetchRunResult(runId: string): Promise<RunResultView | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as RunResultView;
  } catch {
    return null;
  }
}

/** URL phat video qua proxy cua Control (cung origin voi trang). */
export function videoProxyUrl(runId: string, roleId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/videos/${encodeURIComponent(roleId)}`;
}

/** URL tai bao cao .md qua proxy cua Control. */
export function reportProxyUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/report.md`;
}
