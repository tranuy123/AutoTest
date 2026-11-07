/**
 * Client orchestrator -> worker (AD-1: orchestrator khong thao tac trinh
 * duyet truc tiep, moi thao tac qua API cua worker).
 * HttpWorkerClient la ban chay that; cac test cua orchestrator dung ban
 * gia lap cai dat cung giao dien nay (xem run-executor.test.ts).
 */
/**
 * Ket qua phien ma worker bao ve qua POST /api/internal/sessions/:id/finished.
 * Day la hop dong day (JSON qua HTTP) - dinh nghia doc lap voi kieu noi bo
 * cua worker de hai goi khong rang buoc ma nguon (AD-1).
 */
export interface WorkerStepOutcome {
  stepId: string;
  actionId: string;
  status: "qua" | "hong";
  durationMs: number;
  error?: string;
  outputs: Record<string, string | number>;
}

export interface WorkerSessionResult {
  sessionId: string;
  runId: string;
  roleId: string;
  status: "qua" | "hong";
  steps: WorkerStepOutcome[];
  videoPath: string | null;
  screenshots: string[];
  error?: string;
}

export interface WorkerSessionRequest {
  runId: string;
  roleId: string;
  mode: "xem" | "nhanh";
  targetBaseUrl: string;
  username: string;
  password: string;
  stream: boolean;
  paceMs?: number;
  artifactsDir: string;
}

export interface WorkerStepPlan {
  stepId: string;
  actionId: string;
  data?: Record<string, string | number | boolean>;
  waitEvent?: string;
  /** Vai du kien phat su kien duoc cho - dua vao thong diep khi qua han (S3.3 AC-3). */
  waitFromRole?: string;
  emitEvent?: string;
  syncTimeoutMs?: number;
  timeoutMs?: number;
}

export interface WorkerStreamInfo {
  sessionId: string;
  state: "dang-phat" | "mat-tin-hieu";
  viewers: number;
  bytesFromVnc: number;
  bytesToVnc: number;
  lastError: string | null;
}

export interface WorkerClient {
  createSession: (
    req: WorkerSessionRequest,
  ) => Promise<{ sessionId: string; stream: { vncPort: number; wsPath: string } | null }>;
  executeSession: (
    sessionId: string,
    steps: WorkerStepPlan[],
    orchestratorUrl: string,
  ) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  listStreams: () => Promise<WorkerStreamInfo[]>;
}

export class WorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerUnavailableError";
  }
}

export class HttpWorkerClient implements WorkerClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async createSession(req: WorkerSessionRequest) {
    let res: Response;
    try {
      res = await fetch(this.url("/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch (error) {
      throw new WorkerUnavailableError(
        `Không gọi được worker tại ${this.baseUrl}: ${error instanceof Error ? error.message : "lỗi mạng"}`,
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new WorkerUnavailableError(
        `Worker từ chối tạo phiên (HTTP ${res.status})${body.message ? `: ${body.message}` : ""}`,
      );
    }
    return (await res.json()) as {
      sessionId: string;
      stream: { vncPort: number; wsPath: string } | null;
    };
  }

  async executeSession(
    sessionId: string,
    steps: WorkerStepPlan[],
    orchestratorUrl: string,
  ): Promise<void> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}/execute`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps, orchestratorUrl }),
    });
    if (!res.ok) {
      throw new WorkerUnavailableError(
        `Worker từ chối thực thi phiên ${sessionId} (HTTP ${res.status})`,
      );
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
    }).catch(() => undefined);
  }

  async listStreams(): Promise<WorkerStreamInfo[]> {
    const res = await fetch(this.url("/streams"));
    if (!res.ok) return [];
    const body = (await res.json()) as { streams: WorkerStreamInfo[] };
    return body.streams;
  }
}
