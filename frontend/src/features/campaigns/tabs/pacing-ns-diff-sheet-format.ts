/**
 * Pure grouping/formatting helpers for the "Missing from this pacing" part of the NetSuite diff
 * sheet (§13, US-136 follow-up). Split out of `pacing-ns-diff-sheet.tsx` the same way the Overview
 * keeps its own `format.ts` alongside `pacing-overview.tsx`.
 */
import { fmtDate } from "../../pacing/mock/format";
import type { PacingNsDiffMissingInPacingV1 } from "../../pacing-overview/types";

export interface FlightGroup {
  flightStart: string | null;
  flightEnd: string | null;
  entries: PacingNsDiffMissingInPacingV1[];
}

/**
 * Groups `missingInPacing` entries by their `(flightStart, flightEnd)` pair, sorted by
 * `flightStart` ascending — entries missing a flight start sort last, since there is nothing to
 * order them by. Entries with no flight dates at all form their own single group rather than being
 * dropped. A real production example (campaign 40539) split 90 otherwise-identical-looking entries
 * into "Apr 1–5: 80" and "Apr 1–6: 10" — the point of grouping is to make that split visible at a
 * glance instead of scrolled past as 90 near-duplicate cards.
 */
export function groupByFlight(entries: readonly PacingNsDiffMissingInPacingV1[]): FlightGroup[] {
  const groups = new Map<string, FlightGroup>();
  for (const entry of entries) {
    const flightStart = entry.flightStart ?? null;
    const flightEnd = entry.flightEnd ?? null;
    const key = `${flightStart ?? ""}::${flightEnd ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { flightStart, flightEnd, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.flightStart === b.flightStart) return 0;
    if (a.flightStart === null) return 1;
    if (b.flightStart === null) return -1;
    return a.flightStart < b.flightStart ? -1 : 1;
  });
}

/** "Apr 1, 2026 – Apr 5, 2026 · 80", or "No flight dates · 80" when neither date is present. */
export function formatFlightGroupHeader(flightStart: string | null, flightEnd: string | null, count: number): string {
  const period =
    !flightStart && !flightEnd
      ? "No flight dates"
      : `${flightStart ? fmtDate(flightStart) : "—"} – ${flightEnd ? fmtDate(flightEnd) : "—"}`;
  return `${period} · ${count}`;
}

export interface CoveredByGroup {
  pacingId: string;
  pacingName: string;
  /** One entry's own `campaignId` per group — the covering pacing is on the SAME campaign by
   *  construction, so any entry in the group carries the destination campaign; the first is used. */
  campaignId?: string;
  entries: PacingNsDiffMissingInPacingV1[];
}

/**
 * Groups the `coveredBy`-carrying entries by `coveredBy.pacingId` — usually one pacing, but a
 * campaign could in principle have more than one other pacing covering different line items, so
 * this does not assume exactly one group.
 */
export function groupByCoveredBy(entries: readonly PacingNsDiffMissingInPacingV1[]): CoveredByGroup[] {
  const groups = new Map<string, CoveredByGroup>();
  for (const entry of entries) {
    const coveredBy = entry.coveredBy;
    if (!coveredBy) continue;
    let group = groups.get(coveredBy.pacingId);
    if (!group) {
      group = { pacingId: coveredBy.pacingId, pacingName: coveredBy.pacingName, campaignId: entry.campaignId, entries: [] };
      groups.set(coveredBy.pacingId, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
