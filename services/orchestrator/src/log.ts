/**
 * Ghi nhat ky co cau truc cho orchestrator (S1.2 - ban toi thieu).
 * Chi ghi cac truong da biet (event + du lieu ngan gon nhu origin, run_id);
 * tuyet doi khong ghi secret hay du lieu ca nhan. S1.3 se mo rong thanh
 * bo ghi nhat ky lan chay voi redact tu dong (AC-3 cua S1.3).
 */

export interface LogFields {
  [key: string]: string | number | boolean | null;
}

export function logEvent(event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  console.log(line);
}
