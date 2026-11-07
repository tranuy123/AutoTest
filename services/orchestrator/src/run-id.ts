/**
 * Cap ma lan chay (S1.3 AC-1): AUTOTEST_YYYYMMDD_NNN.
 * Ngay tinh theo mui gio Asia/Saigon (NFR-5).
 * Tinh duy nhat khi chay song song do lop repository dam bao bang
 * tang so nguyen tu (xem run-store.ts), module nay chi dinh dang.
 */

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Saigon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Tra ve chuoi YYYYMMDD cua moc thoi gian theo gio Saigon. */
export function formatRunDay(date: Date): string {
  const parts = dayFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** Ghep run_id tu ngay (YYYYMMDD) va so thu tu trong ngay. */
export function buildRunId(day: string, sequence: number): string {
  return `AUTOTEST_${day}_${String(sequence).padStart(3, "0")}`;
}
