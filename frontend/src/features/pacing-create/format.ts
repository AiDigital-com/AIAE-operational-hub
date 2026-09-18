/**
 * Formatting/parsing helpers for the Create Pacing review panel (§8). These only format numbers for
 * humans and parse what a human typed back into a number - none of them derive a figure that was not
 * already in the draft response.
 */

/** Strips thousands separators so a typed/formatted string can be parsed as a number. */
export function rawNumber(value: string): string {
  return value.replace(/,/g, "").trim();
}

/** A comma-grouped display string for an editable numeric field; empty input stays empty. */
export function fmtEditableNumber(value: string): string {
  const raw = rawNumber(value);
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Parses an editable numeric field into a finite number, or undefined when empty/invalid. */
export function parseEditableNumber(value: string): number | undefined {
  const raw = rawNumber(value);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** A read-only integer for humans - never a raw/over-precise float. */
export function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** A read-only money figure for humans, prefixed with the given currency's symbol/code. */
export function fmtMoneyIn(value: number | null | undefined, currency?: string | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const amount = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency && currency !== "USD" ? `${currency} ${amount}` : `$${amount}`;
}

/** "YYYY-MM-DD" -> "Jan 12, 2026"; blank/malformed input renders as an em dash, never "undefined". */
export function fmtDate(iso: string | null | undefined): string {
  const [y, m, d] = (iso ?? "").split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m) - 1];
  return month === undefined ? "—" : `${month} ${Number(d)}, ${y}`;
}
