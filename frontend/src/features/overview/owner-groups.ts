import { totalNsDiffCount } from "../pacing-overview/format";
import type { PacingRowV1 } from "../pacing-overview/types";

/** The group a pacing with no owner lands in — always rendered last. */
export const UNASSIGNED = "Unassigned";

/** Status sort priority inside a group (lower = earlier), same as the reference Overview. */
export const STATUS_PRIORITY: Record<string, number> = { Live: 0, Paused: 1, Complete: 2, Archive: 3 };

/** One owner's card: their pacings plus the header strip's aggregates. */
export interface OwnerGroup {
  owner: string;
  rows: PacingRowV1[];
  /** Σ line items across the group's pacings, preferring health's own count. */
  liTotal: number;
  /** How many of the group's pacings are under pace (`paceStatus === "under"`). */
  under: number;
  /** How many are over pace. */
  over: number;
}

/** The row's line-item count as the Overview shows it: health's own figure, falling back to the
 *  config's count on a row whose health has not computed yet. */
export function rowLiCount(row: PacingRowV1): number {
  return row.liCount ?? row.lineItemCount ?? 0;
}

/**
 * Whether a group belongs to the signed-in user. Matched by display name (case-insensitive, trimmed)
 * because that is the one identity both sides carry: Pacing's `ownerName` mirrors the same Hub
 * employee record the viewer's own `full_name` comes from. No match simply means no group floats to
 * the top — never a wrong one.
 */
function isOwnGroup(owner: string, currentUserName: string | undefined): boolean {
  if (!currentUserName) return false;
  return owner.trim().toLowerCase() === currentUserName.trim().toLowerCase();
}

/**
 * Groups pacing rows by owner for the Overview (§4's owner-grouped rebuild).
 *
 * Group key is `ownerName || "Unassigned"`. Inside a group, rows keep status priority
 * (Live, Paused, Complete, Archive) unless the caller passes an explicit comparator (a clicked
 * column header) — the sort is applied within each group, so the grouping itself never breaks.
 *
 * Group order — a deliberate simplification of the reference, which ordered by org-tree preorder
 * (manager above reports; the Hub has no such tree wired into this screen): the signed-in user's own
 * group first, then the rest alphabetically by owner name, "Unassigned" always last.
 *
 * @param rows            the (already filtered) pacing rows
 * @param currentUserName the signed-in user's display name, for own-group-first ordering
 * @param compare         optional row comparator from a clicked column header; defaults to status
 *                        priority
 */
export function buildOwnerGroups(
  rows: readonly PacingRowV1[],
  currentUserName?: string,
  compare?: (a: PacingRowV1, b: PacingRowV1) => number,
): OwnerGroup[] {
  const byOwner = new Map<string, PacingRowV1[]>();
  for (const row of rows) {
    const owner = row.ownerName || UNASSIGNED;
    const bucket = byOwner.get(owner);
    if (bucket) bucket.push(row);
    else byOwner.set(owner, [row]);
  }

  const sortRows =
    compare ?? ((a: PacingRowV1, b: PacingRowV1) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));

  const groups: OwnerGroup[] = [];
  for (const [owner, groupRows] of byOwner) {
    groupRows.sort(sortRows);
    let liTotal = 0;
    let under = 0;
    let over = 0;
    for (const row of groupRows) {
      liTotal += rowLiCount(row);
      if (row.paceStatus === "under") under++;
      else if (row.paceStatus === "over") over++;
    }
    groups.push({ owner, rows: groupRows, liTotal, under, over });
  }

  groups.sort((a, b) => {
    if (a.owner === UNASSIGNED) return 1;
    if (b.owner === UNASSIGNED) return -1;
    const aOwn = isOwnGroup(a.owner, currentUserName);
    const bOwn = isOwnGroup(b.owner, currentUserName);
    if (aOwn !== bOwn) return aOwn ? -1 : 1;
    return a.owner.localeCompare(b.owner);
  });

  return groups;
}

/** The columns of the group tables that can be ordered by. */
export type OverviewSortField =
  | "NAME"
  | "STATUS"
  | "BUDGET"
  | "MARGIN"
  | "PACING"
  | "FLIGHT"
  | "LINE_ITEMS"
  | "NS_DIFF";

export interface OverviewSort {
  field: OverviewSortField;
  direction: "ASC" | "DESC";
}

/**
 * Orders two rows by a clicked column header. Applied WITHIN each owner group — the grouping itself
 * never breaks. Null figures sort lowest ascending, same convention as the `/pacing` table.
 *
 * @param a    one row
 * @param b    the other
 * @param sort the active sort
 */
export function compareOverviewRows(a: PacingRowV1, b: PacingRowV1, sort: OverviewSort): number {
  const dir = sort.direction === "ASC" ? 1 : -1;
  switch (sort.field) {
    case "NAME":
      return dir * a.name.localeCompare(b.name);
    case "STATUS":
      return dir * ((STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
    case "BUDGET":
      return dir * ((a.budgetTotal ?? 0) - (b.budgetTotal ?? 0));
    case "MARGIN":
      return dir * ((a.marginActualPct ?? -Infinity) - (b.marginActualPct ?? -Infinity));
    case "PACING":
      return dir * ((a.pacingDeviationPct ?? -Infinity) - (b.pacingDeviationPct ?? -Infinity));
    case "FLIGHT":
      return dir * (a.flightStart ?? "").localeCompare(b.flightStart ?? "");
    case "LINE_ITEMS":
      return dir * (rowLiCount(a) - rowLiCount(b));
    case "NS_DIFF": {
      // A pacing never checked (no nsDiffSummary) sorts lowest, same convention as MARGIN/PACING
      // above — it must never out-rank one confirmed in sync at 0 differences.
      const av = a.nsDiffSummary ? totalNsDiffCount(a.nsDiffSummary) : -Infinity;
      const bv = b.nsDiffSummary ? totalNsDiffCount(b.nsDiffSummary) : -Infinity;
      return dir * (av - bv);
    }
    default:
      return 0;
  }
}

/**
 * Matches the search box against everything a person would plausibly name a pacing by on this
 * screen: the pacing's own name, its owner, any campaign it belongs to, and the agency/client names
 * — both Pacing's own strings and the Hub-resolved per-campaign ones.
 *
 * @param row  the pacing row
 * @param term the already-lowercased, trimmed search term; empty matches everything
 */
export function matchesOverviewSearch(row: PacingRowV1, term: string): boolean {
  if (!term) return true;
  if (row.name.toLowerCase().includes(term)) return true;
  if ((row.ownerName ?? "").toLowerCase().includes(term)) return true;
  if ((row.agency ?? "").toLowerCase().includes(term)) return true;
  if ((row.client ?? "").toLowerCase().includes(term)) return true;
  return (row.campaigns ?? []).some(
    (campaign) =>
      campaign.name.toLowerCase().includes(term) ||
      (campaign.agencyName ?? "").toLowerCase().includes(term) ||
      (campaign.clientName ?? "").toLowerCase().includes(term),
  );
}

/**
 * Whether a pacing belongs to the agency filter: it matches when ANY of its campaigns carries a
 * selected agency id. A pacing whose campaigns are unresolved (`campaigns` null, or none of them
 * Hub-resolvable) belongs to no agency — it shows when no filter is active and honestly drops out
 * when one is.
 *
 * @param row       the pacing row
 * @param agencyIds the selected agency ids; empty means no filter
 */
export function matchesAgencyFilter(row: PacingRowV1, agencyIds: readonly number[]): boolean {
  if (agencyIds.length === 0) return true;
  return (row.campaigns ?? []).some(
    (campaign) => campaign.agencyId != null && agencyIds.includes(campaign.agencyId),
  );
}
