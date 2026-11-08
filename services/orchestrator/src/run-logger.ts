/**
 * Bo ghi nhat ky lan chay (S1.3 AC-3).
 * Hai lop bao ve:
 * 1) Danh sach trang (whitelist): chi cac truong da biet moi duoc ghi -
 *    truong la (vi du ho ten benh nhan gui thua) bi loai bo hoan toan.
 * 2) Redact theo mau: moi chuoi van ban tu do (thong diep loi) deu bi che
 *    so dien thoai, email va cap khoa=gia-tri chua secret truoc khi ghi.
 * Nhat ky lan chay chi chua: event, run_id, role_id, step_id,
 * duration_ms, error_code va thong diep loi da redact.
 * role_id/step_id la dinh danh noi bo (khong phai du lieu ca nhan) nen
 * nam trong danh sach trang; S5.6 luu cac ban ghi DA sanitize nay vao
 * kho nhat ky theo lan chay (run-log-store.ts) de xem/tai qua giao dien.
 */

const REDACTED = "[da-che]";

// So dien thoai Viet Nam (0xxxxxxxxx, +84xxxxxxxxx) va dang quoc te chung.
const PHONE_PATTERN = /(?:\+84|0)(?:[\s.-]?\d){9}\b/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const SECRET_KV_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key|mat[_-]?khau)\s*[:=]\s*\S+/gi;

export function redactText(text: string): string {
  return text
    .replace(SECRET_KV_PATTERN, `$1=${REDACTED}`)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED);
}

export interface RunLogEntry {
  event: string;
  runId?: string;
  roleId?: string;
  stepId?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  result?: string;
  [key: string]: unknown;
}

const ALLOWED_FIELDS = [
  "event",
  "runId",
  "roleId",
  "stepId",
  "durationMs",
  "errorCode",
  "errorMessage",
  "result",
];

export function sanitizeLogEntry(entry: RunLogEntry): Record<string, unknown> {
  const clean: Record<string, unknown> = { ts: new Date().toISOString() };
  for (const field of ALLOWED_FIELDS) {
    const value = entry[field];
    if (value === undefined) continue;
    clean[field] = typeof value === "string" ? redactText(value) : value;
  }
  return clean;
}

export type LogSink = (line: string) => void;

export function createRunLogger(sink: LogSink = (line) => console.log(line)) {
  return {
    log(entry: RunLogEntry): void {
      sink(JSON.stringify(sanitizeLogEntry(entry)));
    },
  };
}

export type RunLogger = ReturnType<typeof createRunLogger>;
