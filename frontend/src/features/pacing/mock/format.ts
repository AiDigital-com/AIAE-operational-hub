/**
 * Formatting and date-math helpers, ported verbatim from the mockup (including its exact string
 * formats, e.g. `daysLeft` returning `"22d"`) so pacing numbers/labels are bit-identical to the
 * reference design.
 */

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function parseMoney(value: string | number): number {
  return +String(value).replace(/[^0-9.]/g, "") || 0;
}

export function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function fmtBudget(n: number): string {
  if (!n) return "$0";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

/** "YYYY-MM-DD" -> "MM/DD" by plain substring split — no Date parsing, no timezone risk. */
export function fmtMD(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> "Jan 12, 2026" by plain substring split — no Date parsing, no timezone risk. */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS_SHORT[+m - 1]} ${+d}, ${y}`;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days remaining until `iso` (never negative), formatted like the mockup: e.g. "22d". */
export function daysLeft(iso: string): string {
  const d = Math.round((new Date(iso + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  return (d > 0 ? d : 0) + "d";
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86_400_000
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. labelDay("2026-07-01", 20) -> "Jul 20". */
export function labelDay(startIso: string, n: number): string {
  const d = new Date(startIso + "T00:00:00");
  d.setDate(d.getDate() + n - 1);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
