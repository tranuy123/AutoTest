/**
 * Client noi bo worker -> orchestrator:
 * - Dong bo su kien (AD-3): cho/phat su kien qua bo dieu phoi cua orchestrator.
 * - Bao tien do: trang thai vai, ket qua tung buoc, thuc the da tao (S2.4),
 *   va ket qua cuoi phien ve orchestrator.
 * Chi gui id/run_id/du lieu buoc - khong bao gio gui thong tin dang nhap.
 */
import type { StepReporter, SyncClient, SyncEvent } from "./engine.js";
import type { SessionResult } from "./types.js";

export class SyncTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncTimeoutError";
  }
}

export class OrchestratorClient implements SyncClient, StepReporter {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async waitForEvent(input: {
    runId: string;
    roleId: string;
    name: string;
    timeoutMs: number;
    expectedFromRole?: string;
  }): Promise<SyncEvent> {
    const query = new URLSearchParams({
      name: input.name,
      role: input.roleId,
      timeoutMs: String(input.timeoutMs),
      ...(input.expectedFromRole ? { expectedFromRole: input.expectedFromRole } : {}),
    });
    const res = await fetch(
      this.url(`/api/internal/runs/${encodeURIComponent(input.runId)}/events/wait?${query}`),
    );
    if (res.status === 408) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new SyncTimeoutError(
        body.message ??
          `Vai '${input.roleId}' chờ sự kiện '${input.name}' quá hạn ${input.timeoutMs}ms`,
      );
    }
    if (!res.ok) {
      throw new Error(`Chờ sự kiện '${input.name}' thất bại: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      name: string;
      payload: Record<string, string | number | boolean>;
      fromRole: string;
    };
    return { name: body.name, payload: body.payload, fromRole: body.fromRole };
  }

  async emitEvent(input: {
    runId: string;
    roleId: string;
    name: string;
    payload: Record<string, string | number | boolean>;
  }): Promise<void> {
    const res = await fetch(
      this.url(`/api/internal/runs/${encodeURIComponent(input.runId)}/events`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          payload: input.payload,
          fromRole: input.roleId,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Phát sự kiện '${input.name}' thất bại: HTTP ${res.status}`);
    }
  }

  async roleStatus(input: {
    runId: string;
    roleId: string;
    sessionId: string;
    state: "dang-chay" | "xong" | "loi";
    currentStepId?: string;
  }): Promise<void> {
    await fetch(
      this.url(
        `/api/internal/runs/${encodeURIComponent(input.runId)}/roles/${encodeURIComponent(input.roleId)}/status`,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          state: input.state,
          ...(input.currentStepId ? { currentStepId: input.currentStepId } : {}),
        }),
      },
    );
  }

  async stepFinished(input: {
    runId: string;
    roleId: string;
    outcome: {
      stepId: string;
      actionId: string;
      status: "qua" | "hong";
      durationMs: number;
      error?: string;
    };
  }): Promise<void> {
    const { outcome } = input;
    await fetch(this.url(`/api/runs/${encodeURIComponent(input.runId)}/steps`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stepId: outcome.stepId,
        name: outcome.actionId,
        status: outcome.status,
        durationMs: outcome.durationMs,
        ...(outcome.error ? { errorCode: outcome.error } : {}),
      }),
    });
  }

  async entityCreated(input: {
    runId: string;
    roleId: string;
    type: string;
    entityId: string;
    stepId: string;
  }): Promise<void> {
    await fetch(
      this.url(`/api/internal/runs/${encodeURIComponent(input.runId)}/entities`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: input.type,
          entityId: input.entityId,
          createdByStepId: input.stepId,
          roleId: input.roleId,
        }),
      },
    );
  }

  /** Bao ket qua cuoi phien (ke ca khi phien hong) ve orchestrator. */
  async sessionFinished(result: SessionResult): Promise<void> {
    await fetch(
      this.url(`/api/internal/sessions/${encodeURIComponent(result.sessionId)}/finished`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
      },
    );
  }
}
