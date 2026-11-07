/**
 * Cong kiem tra sandbox kenh ngoai truoc khi chay (S5.3, NFR-4).
 *
 * Kich ban co khai bao `kenhNgoai` (schema version 2) chi duoc chay khi
 * dich kiem thu duoc XAC NHAN dang o che do sandbox gui tin (Zalo/
 * Facebook/SMS khong gui that). Nguyen tac fail-closed nhu AD-6:
 * khong xac nhan duoc = chan, khong ngoai le.
 *
 * Tin hieu (AC-1: "tin hieu cau hinh/health cua CRM"):
 * 1. Health cua dich: GET {targetBaseUrl}{CRM_HEALTH_PATH} - dich tu bao
 *    co sandbox qua cac khoa JSON: sandbox / kenhNgoaiSandbox /
 *    channelsSandbox / kenhNgoai.sandbox (boolean).
 * 2. Cau hinh: CHANNELS_SANDBOX trong .env (khai bao cua nguoi van hanh
 *    tu S1.2).
 *
 * Cach ket hop (fail-closed):
 * - BAT KY tin hieu nao noi "khong sandbox" -> chan (ke ca khi tin hieu
 *   con lai noi nguoc lai - xung dot tin hieu cung chan).
 * - Health noi sandbox -> cho chay (tin hieu tu chinh dich la manh nhat).
 * - Health khong co co (khong tra loi/khong khai) -> dung tin hieu cau
 *   hinh: CHANNELS_SANDBOX=true moi cho chay.
 * - Khong tin hieu nao xac nhan duoc -> chan.
 *
 * Ket qua kiem tra duoc luu theo run_id va dua vao bao cao lan chay
 * (AC-3): thoi diem, ket qua, tin hieu dua vao.
 */
import type { ScenarioDefinition } from "@autotest/scenario-schema";
import { scenarioTouchesExternalChannels } from "@autotest/scenario-schema";

export type SandboxOutcome = "sandbox" | "khong-sandbox" | "khong-xac-dinh";

export interface SandboxCheckRecord {
  runId: string;
  /** Thoi diem kiem tra (ISO). */
  checkedAt: string;
  /** Cac kenh ngoai kich ban khai bao cham toi. */
  channels: string[];
  outcome: SandboxOutcome;
  allowed: boolean;
  /** Tin hieu da dung, dang van ban de dua vao bao cao (AC-3). */
  signals: string[];
  reason: string;
}

export interface SandboxProbeDeps {
  /** CHANNELS_SANDBOX tu cau hinh: true/false/null (chua khai bao). */
  channelsSandboxConfig: boolean | null;
  /** Duong dan health tren dich, mac dinh "/api/health". */
  healthPath: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface SandboxProbeResult {
  outcome: SandboxOutcome;
  signals: string[];
  reason: string;
}

/** Doc co sandbox tu JSON health - khong doan: khong co khoa boolean thi tra null. */
export function docCoSandboxTuHealth(body: unknown): boolean | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  for (const key of ["sandbox", "kenhNgoaiSandbox", "channelsSandbox"] as const) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  const nested = record.kenhNgoai;
  if (typeof nested === "object" && nested !== null) {
    const flag = (nested as Record<string, unknown>).sandbox;
    if (typeof flag === "boolean") return flag;
  }
  return null;
}

export async function probeSandbox(
  targetBaseUrl: string,
  deps: SandboxProbeDeps,
): Promise<SandboxProbeResult> {
  const signals: string[] = [];
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const healthPath = deps.healthPath.startsWith("/")
    ? deps.healthPath
    : `/${deps.healthPath}`;
  const healthUrl = `${targetBaseUrl.replace(/\/$/, "")}${healthPath}`;

  // --- Tin hieu 1: health cua dich ---
  let healthFlag: boolean | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(healthUrl, { signal: controller.signal });
    if (!res.ok) {
      signals.push(`health ${healthPath}: HTTP ${res.status} — không dùng được tín hiệu này`);
    } else {
      const body: unknown = await res.json().catch(() => null);
      healthFlag = docCoSandboxTuHealth(body);
      signals.push(
        healthFlag === null
          ? `health ${healthPath}: trả lời nhưng không có cờ sandbox`
          : `health ${healthPath}: sandbox=${healthFlag}`,
      );
    }
  } catch {
    signals.push(`health ${healthPath}: không trả lời (lỗi mạng hoặc quá ${timeoutMs}ms)`);
  } finally {
    clearTimeout(timer);
  }

  // --- Tin hieu 2: cau hinh ---
  const configFlag = deps.channelsSandboxConfig;
  signals.push(
    configFlag === null
      ? "cấu hình CHANNELS_SANDBOX: chưa khai báo"
      : `cấu hình CHANNELS_SANDBOX=${configFlag}`,
  );

  // --- Ket hop fail-closed ---
  if (healthFlag === false || configFlag === false) {
    const benPhu = healthFlag === false ? "health của đích" : "cấu hình CHANNELS_SANDBOX";
    const xungDot =
      (healthFlag === false && configFlag === true) ||
      (configFlag === false && healthFlag === true);
    return {
      outcome: "khong-sandbox",
      signals,
      reason: xungDot
        ? `Tín hiệu mâu thuẫn: ${benPhu} nói KHÔNG ở sandbox trong khi tín hiệu còn lại nói có — chặn theo nguyên tắc fail-closed`
        : `Đích KHÔNG ở chế độ sandbox kênh ngoài (theo ${benPhu}) — chặn để không gửi tin thật cho khách hàng`,
    };
  }
  if (healthFlag === true) {
    return {
      outcome: "sandbox",
      signals,
      reason: "Đích xác nhận đang ở sandbox qua health — được phép chạy kịch bản có kênh ngoài",
    };
  }
  if (configFlag === true) {
    return {
      outcome: "sandbox",
      signals,
      reason:
        "Health không có cờ sandbox; dùng tín hiệu cấu hình CHANNELS_SANDBOX=true — được phép chạy kịch bản có kênh ngoài",
    };
  }
  return {
    outcome: "khong-xac-dinh",
    signals,
    reason:
      "Không xác nhận được đích đang ở sandbox (health không có cờ, cấu hình chưa khai báo CHANNELS_SANDBOX) — chặn theo nguyên tắc fail-closed",
  };
}

/**
 * Cong sandbox dung trong vong doi lan chay: chi kiem tra khi kich ban
 * khai bao kenh ngoai; luu ban ghi theo run_id cho bao cao (AC-3).
 */
export class SandboxGate {
  private readonly records = new Map<string, SandboxCheckRecord>();

  constructor(private readonly deps: SandboxProbeDeps) {}

  /**
   * Tra ve ban ghi kiem tra, hoac null neu kich ban khong cham kenh
   * ngoai (AC-2: khong kiem tra, khong chan).
   */
  async checkForRun(input: {
    runId: string;
    scenario: Pick<ScenarioDefinition, "kenhNgoai">;
    targetBaseUrl: string;
  }): Promise<SandboxCheckRecord | null> {
    if (!scenarioTouchesExternalChannels(input.scenario)) return null;
    const probe = await probeSandbox(input.targetBaseUrl, this.deps);
    const record: SandboxCheckRecord = {
      runId: input.runId,
      checkedAt: new Date().toISOString(),
      channels: [...(input.scenario.kenhNgoai ?? [])],
      outcome: probe.outcome,
      allowed: probe.outcome === "sandbox",
      signals: probe.signals,
      reason: probe.reason,
    };
    this.records.set(input.runId, record);
    return record;
  }

  getRecord(runId: string): SandboxCheckRecord | null {
    return this.records.get(runId) ?? null;
  }
}
