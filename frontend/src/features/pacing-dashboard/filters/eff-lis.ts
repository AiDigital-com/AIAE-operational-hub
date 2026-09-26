/**
 * Line-item-level filtering (`channels`/`labels`/`selection` narrow `effLIs`) and window
 * resolution (`range`/`customRange` narrow the flight window), ported from the retired SPA's
 * `workspace/src/lib/dashboard/config.js` - `computeEffLIs` verbatim (~12 lines), `getEffRange`
 * trimmed of its `splitScopedMode`/`splitScopedPlans` branch (container period-scope), which is out
 * of scope for the dashboard filter bar - containers stay unfiltered reference readings here,
 * matching `dash-gate/lib/merge.mjs`'s own `buildContainerReadings` call (`{}`, "No URL filters
 * server-side... A filtered view is the reader's own business").
 */
import { getPacingCore } from "../engine/engine-loader";
import type { DateRange, LiPlanMap } from "../engine/vendor-types";
import type { DashboardFilters } from "./types";

/** Which line items pass the LI-level filters: `channels` (channel match), `labels` (any overlap),
 *  `selection` (explicit id pick). Each filter narrows further when non-empty; empty = no-op. */
export function computeEffLIs(
  liPlan: LiPlanMap | null | undefined,
  filters: Pick<DashboardFilters, "channels" | "labels" | "selection">
): string[] {
  if (!liPlan) return [];
  let ids = Object.keys(liPlan);
  if (filters.channels?.length) {
    ids = ids.filter((id) => filters.channels.includes(liPlan[id].ch));
  }
  if (filters.labels?.length) {
    ids = ids.filter((id) => filters.labels.some((l) => (liPlan[id].labels || []).includes(l)));
  }
  if (filters.selection?.length) {
    ids = ids.filter((id) => filters.selection.includes(id));
  }
  return ids;
}

/**
 * The active window: a `custom` range when both ends are set, an `Nd` quick range clipped back
 * from `asOf`, else the whole flight clamped at the data edge (`dash-gate/lib/merge.mjs`'s default:
 * `{from: campaign.startDate, to: asOf || campaign.endDate}`) - which is exactly what this returns
 * when `filters.range === 'all'`, so the crown test's no-filter case needs no special-casing here.
 */
export function getEffRange(
  filters: Pick<DashboardFilters, "range" | "customRange">,
  campaign: { startDate: string; endDate: string },
  asOf: string | null
): DateRange {
  if (filters.range === "custom" && filters.customRange?.from && filters.customRange?.to) {
    return { from: filters.customRange.from, to: filters.customRange.to };
  }
  if (filters.range !== "all" && filters.range !== "custom" && asOf) {
    const days = Number(filters.range.replace("d", ""));
    const PacingCore = getPacingCore();
    const cut = PacingCore._parseUTC(asOf);
    cut.setUTCDate(cut.getUTCDate() - (days - 1));
    return { from: cut.toISOString().slice(0, 10), to: asOf };
  }
  return { from: campaign.startDate, to: asOf || campaign.endDate };
}
