/**
 * Hop dong dung chung cua worker (Epic 3).
 * Orchestrator la noi parse/validate kich ban (AD-2) va sinh du lieu (S2.3);
 * worker chi nhan "ke hoach thuc thi" dang JSON thuan va thuc thi tren
 * trinh duyet. Hai che do Xem/Nhanh dung chung engine nay (AD-8) - khac
 * biet duy nhat la cau hinh phien (SessionConfig).
 */

/** Che do phien o tang engine: xem = headed + stream + slow-mo; nhanh = headless. */
export type EngineMode = "xem" | "nhanh";

export interface StepPlan {
  /** Id buoc trong kich ban (slug). */
  stepId: string;
  /** Hanh dong trong thu vien buoc dung chung cua scenario-schema (AD-2). */
  actionId: string;
  /** Du lieu da duoc orchestrator giai tham chieu ($benhNhan[0]...) thanh gia tri that. */
  data?: Record<string, string | number | boolean>;
  /** Su kien phai cho truoc khi chay buoc (AD-3). */
  waitEvent?: string;
  /** Vai du kien phat su kien duoc cho - dua vao thong diep khi qua han. */
  waitFromRole?: string;
  /** Su kien phat ra sau khi buoc chay xong, payload = data + outputs cua buoc. */
  emitEvent?: string;
  /** Timeout cua diem dong bo (ms). Mac dinh DEFAULT_SYNC_TIMEOUT_MS. */
  syncTimeoutMs?: number;
  /** Timeout rieng cho thao tac cua buoc (ms). Mac dinh DEFAULT_STEP_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface SessionRequest {
  runId: string;
  roleId: string;
  mode: EngineMode;
  targetBaseUrl: string;
  /** Thong tin dang nhap chi truyen qua API noi bo orchestrator -> worker,
   *  chi nam trong bo nho cua phien, khong ghi log/khong vao ke hoach buoc. */
  username: string;
  password: string;
  /** Che do xem: khoi tao Xvnc + VNC de Stream Gateway phat hinh (AD-9). */
  stream: boolean;
  /** Do tre giua cac thao tac o che do xem (ms) - nhip "nguoi that" (S3.2 AC-4). */
  paceMs?: number;
  /** Thu muc luu video/anh cua lan chay (duoi runs/<runId>/...). */
  artifactsDir: string;
}

export type StepStatus = "qua" | "hong";

export interface StepOutcome {
  stepId: string;
  actionId: string;
  status: StepStatus;
  durationMs: number;
  /** Ly do loi (da gom ten buoc) khi status = hong. Khong chua thong tin dang nhap. */
  error?: string;
  /** Gia tri doc duoc tu giao dien (vd appointment_id, tong doanh thu). */
  outputs: Record<string, string | number>;
}

export interface SessionResult {
  sessionId: string;
  runId: string;
  roleId: string;
  status: StepStatus;
  steps: StepOutcome[];
  /** Duong dan video ban ghi cua phien (neu co). */
  videoPath: string | null;
  /** Anh chup cuoi moi buoc chinh (toi thieu: anh cuoi phien). */
  screenshots: string[];
  error?: string;
}

/** Loi cua mot buoc: luon neu ten buoc + ly do (S3.1 AC-2, S3.3 AC-3). */
export class StepError extends Error {
  readonly stepId: string;

  constructor(stepId: string, reason: string) {
    super(`Bước '${stepId}': ${reason}`);
    this.name = "StepError";
    this.stepId = stepId;
  }
}

export const DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const DEFAULT_SYNC_TIMEOUT_MS = 120_000;
export const DEFAULT_VIEW_PACE_MS = 400;
