/**
 * Trang thai phien theo vai cua tung lan chay - nguon cho luoi stream
 * tren giao dien (S3.2 AC-2). Worker bao trang thai qua API noi bo;
 * store nay chi giu trong bo nho (trang thai song, khong can luu DB).
 */
export type RoleSessionState = "cho" | "dang-chay" | "xong" | "loi";

export interface RoleStatus {
  runId: string;
  roleId: string;
  sessionId: string | null;
  state: RoleSessionState;
  currentStepId: string | null;
  updatedAt: string;
}

export class RoleStatusStore {
  private readonly byRun = new Map<string, Map<string, RoleStatus>>();

  set(input: {
    runId: string;
    roleId: string;
    sessionId?: string | null;
    state: RoleSessionState;
    currentStepId?: string | null;
  }): RoleStatus {
    let roles = this.byRun.get(input.runId);
    if (!roles) {
      roles = new Map();
      this.byRun.set(input.runId, roles);
    }
    const previous = roles.get(input.roleId);
    const status: RoleStatus = {
      runId: input.runId,
      roleId: input.roleId,
      sessionId: input.sessionId !== undefined ? input.sessionId : (previous?.sessionId ?? null),
      state: input.state,
      currentStepId:
        input.currentStepId !== undefined
          ? input.currentStepId
          : (previous?.currentStepId ?? null),
      updatedAt: new Date().toISOString(),
    };
    roles.set(input.roleId, status);
    return status;
  }

  listByRun(runId: string): RoleStatus[] {
    return [...(this.byRun.get(runId)?.values() ?? [])];
  }

  get(runId: string, roleId: string): RoleStatus | null {
    return this.byRun.get(runId)?.get(roleId) ?? null;
  }

  clearRun(runId: string): void {
    this.byRun.delete(runId);
  }
}
