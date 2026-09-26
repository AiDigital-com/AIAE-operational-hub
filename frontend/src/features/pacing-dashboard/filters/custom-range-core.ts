/**
 * The two decisions the FilterBar's Custom segment makes, as pure functions - ported from the
 * retired SPA's `workspace/src/lib/dashboard/custom-range.js` (Task 2 of the 2026-09-25 filter bar
 * brief). Together with `formatRangeLabel` (ported from that file's sibling
 * `workspace/src/lib/dashboard/range-label.js`, the compact "Sep 1 – Sep 10" the segment reads
 * once a range lands), this is the whole non-visual half of the date range control -
 * `date-range-control.tsx` is the React shell.
 *
 * A custom range counts only when BOTH ends are picked. `?range=custom` with no dates (an old
 * shared link) filters nothing - `eff-lis.ts`'s `getEffRange` falls through to the flight window -
 * so it must not light the bar, offer Clear, or leave the segmented group with no selected
 * segment: for display it IS Flight.
 */
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";

export interface CustomRangeState {
  from: string;
  to: string;
  /** A complete custom range is applied. */
  customActive: boolean;
  /** The range control narrows the data at all (drives Clear + the bar's active border). */
  rangeActive: boolean;
  /** Which segment to light: the applied range, or 'all' for a dangling custom without dates. */
  shownRange: string;
}

export function customRangeState(filters: Pick<DashboardFilters, "range" | "customRange"> | null | undefined): CustomRangeState {
  const range = filters?.range || "all";
  const from = filters?.customRange?.from || "";
  const to = filters?.customRange?.to || "";
  const customActive = range === "custom" && !!from && !!to;
  const rangeActive = range === "custom" ? customActive : range !== "all";
  const shownRange = range === "custom" && !customActive ? "all" : range;
  return { from, to, customActive, rangeActive, shownRange };
}

export interface PickedRange {
  from?: string;
  to?: string;
}

/**
 * What the calendar's answer does to the filters. A complete pick applies it; an empty answer
 * (the calendar's Reset) clears a custom range back to Flight and is a no-op otherwise - the
 * calendar opened over 7d never had a custom range to clear.
 * @returns the `setFilters` patch, or `null` for "change nothing"
 */
export function customRangePatch(
  filters: Pick<DashboardFilters, "range"> | null | undefined,
  picked: PickedRange | null | undefined
): DashboardFiltersPatch | null {
  if (picked?.from && picked?.to) return { range: "custom", customRange: { from: picked.from, to: picked.to } };
  if ((filters?.range || "all") === "custom") return { range: "all", customRange: { from: "", to: "" } };
  return null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> {y,m,d}, or null for anything else - the segment must answer nothing for
 *  garbage, not "Invalid Date". */
function parts(ymd: unknown): { y: number; m: number; d: number } | null {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (!(y > 0) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function longLabel(ymd: string): string {
  const p = parts(ymd);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.d}, ${p.y}` : "";
}
function shortLabel(ymd: string): string {
  const p = parts(ymd);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.d}` : "";
}

function localTodayYmd(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/**
 * The compact label the Custom segment shows in place of the word "Custom" once a range is
 * picked: "Sep 1 – Sep 10". Only writes the year where it carries information - a range outside
 * the current year, or crossing a year boundary - so the common case stays short enough for a
 * segmented control. Ported verbatim from `range-label.js`'s `formatRangeLabel`.
 *
 * @param today reference day whose year is "the current year" - defaults to the real local today,
 *   passed explicitly by tests.
 * @returns '' when either end is missing or malformed.
 */
export function formatRangeLabel(from: string, to: string, today: string = localTodayYmd()): string {
  let a = parts(from);
  let b = parts(to);
  if (!a || !b) return "";
  let orderedFrom = from;
  let orderedTo = to;
  if (from > to) {
    [a, b] = [b, a];
    [orderedFrom, orderedTo] = [to, from];
  }
  const currentYear = parts(today)?.y ?? a.y;
  if (a.y !== b.y) return `${longLabel(orderedFrom)} – ${longLabel(orderedTo)}`;
  const single = orderedFrom === orderedTo;
  if (a.y !== currentYear) return single ? longLabel(orderedFrom) : `${shortLabel(orderedFrom)} – ${longLabel(orderedTo)}`;
  return single ? shortLabel(orderedFrom) : `${shortLabel(orderedFrom)} – ${shortLabel(orderedTo)}`;
}
