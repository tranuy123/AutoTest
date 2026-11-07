/**
 * Bo dieu phoi su kien trong mot lan chay (AD-3, S3.3).
 * - Moi su kien mang run_id va chi co hieu luc trong lan chay cua no:
 *   vai o lan chay khac cho cung ten su kien se khong bao gio nhan duoc.
 * - Su kien da phat duoc luu lai: vai bat dau cho sau van nhan duoc ngay
 *   (phat truoc - cho sau la nhip binh thuong cua luong nhieu vai).
 * - Moi diem cho co timeout; qua han nem SyncTimeoutError neu ro vai nao
 *   cho su kien nao, tu vai nao (S3.3 AC-3).
 */
export interface RunEvent {
  runId: string;
  name: string;
  payload: Record<string, string | number | boolean>;
  fromRole: string;
  emittedAt: string;
}

export class SyncTimeoutError extends Error {
  readonly runId: string;
  readonly eventName: string;
  readonly waitingRole: string;
  readonly expectedFromRole: string | null;

  constructor(input: {
    runId: string;
    eventName: string;
    waitingRole: string;
    expectedFromRole?: string | null;
    timeoutMs: number;
  }) {
    super(
      `Vai '${input.waitingRole}' chờ sự kiện '${input.eventName}'` +
        (input.expectedFromRole ? ` từ vai '${input.expectedFromRole}'` : "") +
        ` quá hạn ${input.timeoutMs}ms trong lần chạy ${input.runId}`,
    );
    this.name = "SyncTimeoutError";
    this.runId = input.runId;
    this.eventName = input.eventName;
    this.waitingRole = input.waitingRole;
    this.expectedFromRole = input.expectedFromRole ?? null;
  }
}

interface Waiter {
  name: string;
  resolve: (event: RunEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RunEventBus {
  /** runId -> (ten su kien -> su kien da phat gan nhat) */
  private readonly emitted = new Map<string, Map<string, RunEvent>>();
  /** runId -> danh sach vai dang cho */
  private readonly waiters = new Map<string, Set<Waiter>>();
  /** runId -> lich su su kien theo thu tu phat (cho bao cao lan chay) */
  private readonly historyLog = new Map<string, RunEvent[]>();

  emit(input: {
    runId: string;
    name: string;
    payload: Record<string, string | number | boolean>;
    fromRole: string;
  }): RunEvent {
    const event: RunEvent = {
      runId: input.runId,
      name: input.name,
      payload: { ...input.payload },
      fromRole: input.fromRole,
      emittedAt: new Date().toISOString(),
    };
    let byName = this.emitted.get(input.runId);
    if (!byName) {
      byName = new Map();
      this.emitted.set(input.runId, byName);
    }
    byName.set(input.name, event);
    const log = this.historyLog.get(input.runId) ?? [];
    log.push(event);
    this.historyLog.set(input.runId, log);

    const pending = this.waiters.get(input.runId);
    if (pending) {
      for (const waiter of [...pending]) {
        if (waiter.name === input.name) {
          pending.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(event);
        }
      }
    }
    return event;
  }

  waitFor(input: {
    runId: string;
    name: string;
    waitingRole: string;
    timeoutMs: number;
    expectedFromRole?: string | null;
  }): Promise<RunEvent> {
    const existing = this.emitted.get(input.runId)?.get(input.name);
    if (existing) return Promise.resolve(existing);
    return new Promise<RunEvent>((resolve, reject) => {
      const waiter: Waiter = {
        name: input.name,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.get(input.runId)?.delete(waiter);
          reject(
            new SyncTimeoutError({
              runId: input.runId,
              eventName: input.name,
              waitingRole: input.waitingRole,
              expectedFromRole: input.expectedFromRole ?? null,
              timeoutMs: input.timeoutMs,
            }),
          );
        }, input.timeoutMs),
      };
      let set = this.waiters.get(input.runId);
      if (!set) {
        set = new Set();
        this.waiters.set(input.runId, set);
      }
      set.add(waiter);
    });
  }

  /** Lich su su kien cua lan chay (ban sao) - phuc vu bao cao va debug. */
  history(runId: string): RunEvent[] {
    return [...(this.historyLog.get(runId) ?? [])];
  }

  /** Don trang thai khi lan chay ket thuc han (tranh ro bo nho). */
  clearRun(runId: string): void {
    const pending = this.waiters.get(runId);
    if (pending) {
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(`Lần chạy ${runId} đã kết thúc khi đang chờ sự kiện '${waiter.name}'`),
        );
      }
    }
    this.waiters.delete(runId);
    this.emitted.delete(runId);
    this.historyLog.delete(runId);
  }
}
