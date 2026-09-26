/**
 * Derives the KPI strip's Pace/Margin figures from the browser-computed `PacingMetricsBag`
 * instead of the server-computed `PacingRowV1` health fields (owner ask, 2026-09-25 — the strip
 * sat above the filter bar reading `row.*`, which never moves with a filter, while the widgets
 * beside it read `metrics` and do move: with `?ch=Meta` applied the strip showed Margin 90.3%
 * while the Delivery/Margin widget showed 93.87% for the SAME pacing).
 *
 * `metrics.campaign` is the RANGED `campM(LD0, LP, asOf, effLIs, range)` (owner decision,
 * 2026-09-25/26 - see `build-metrics.ts`'s comment at `const campaign = cm`) — `effLIs` carries the
 * Scope filters (channels/labels/selection), `range` carries the window, and `LD0` is unfiltered by
 * Lens (platforms/brkf). So reading `campaign.pac`/`mA`/`mT` here gives the strip the exact same
 * Scope/Lens split `engine/build-metrics.ts` already applies to `campaign`/`scalars` vs
 * `series`/`daily` — a Scope filter or a date range moves this strip, a Lens filter does not. With
 * no range chosen the window defaults to `{from: startDate, to: asOf}` — "so far", matching the
 * retired SPA's own headline (`makeCampMetricsSelector`).
 *
 * Field names are `pac`/`mA`/`mT` on `campM`'s return object (`engine/vendor/dashboard-metrics.js`,
 * search `const pac =`, `const mA =`, `const mT =` inside `function campM`) — a budget-weighted
 * average of each line item's `PacingCore.pacingIndex`/`PacingCore.margin`, the exact math
 * `dash-gate/lib/health.mjs` (`pacing_pp`/`margin_actual`/`margin_target`) already runs
 * server-side for `PacingRowV1`'s own fields, aggregated the same way (budget-weighted, `budget ||
 * 1` as the per-LI weight). The ±5pp bucketing below is `health.mjs`'s own
 * `PP_ON_PACE_LOW`/`PP_ON_PACE_HIGH` thresholds, so a value bucketed here reads the same as the
 * Overview list's own `paceStatus` would for the same figure.
 */
import type { PacingRowV1 } from "../pacing-overview/types";
import type { PacingMetricsBag } from "./types-metrics";

const PP_ON_PACE_LOW = -5;
const PP_ON_PACE_HIGH = 5;

export type PaceStatus = NonNullable<PacingRowV1["paceStatus"]>;

export interface HeroHealth {
  pacingDeviationPct: number | null;
  marginActualPct: number | null;
  marginTargetPct: number;
  paceStatus: PaceStatus;
}

/** Mirrors `dash-gate/lib/health.mjs`'s `pacingCategory(pp)` exactly (same thresholds, same
 *  bucket names) so a value derived here reads the same way the server's own field would. */
function paceStatusFromPp(pp: number | null): PaceStatus {
  if (pp == null || !Number.isFinite(pp)) return "no_data";
  if (pp >= PP_ON_PACE_LOW && pp <= PP_ON_PACE_HIGH) return "on_pace";
  return pp < PP_ON_PACE_LOW ? "under" : "over";
}

export type HeroHealthRowInput = Pick<PacingRowV1, "pacingDeviationPct" | "marginActualPct" | "marginTargetPct" | "paceStatus">;

/**
 * @param metrics  The current (filter-aware) metrics bag, or `null` while the dashboard query is
 *   still loading / failed / produced a malformed payload.
 * @param row      The pacings-list row backing this dashboard - the fallback source, and the sole
 *   source for `inactive` (a property of the PACING's own status, Complete/Archive, set by
 *   `health.mjs` before any campM-style computation runs - not something a filter can turn on or
 *   off, so a filtered recompute must never override it).
 */
export function deriveHeroHealth(metrics: PacingMetricsBag | null, row: HeroHealthRowInput): HeroHealth {
  if (row.paceStatus === "inactive") {
    return {
      pacingDeviationPct: null,
      marginActualPct: null,
      marginTargetPct: row.marginTargetPct ?? 0,
      paceStatus: "inactive",
    };
  }

  const campaign = metrics?.campaign as Record<string, unknown> | undefined;
  if (!campaign) {
    // No bag yet (dashboard query still loading/erroring, or a malformed payload) - keep showing
    // the server's own whole-pacing figures rather than flashing "No data".
    return {
      pacingDeviationPct: row.pacingDeviationPct ?? null,
      marginActualPct: row.marginActualPct ?? null,
      marginTargetPct: row.marginTargetPct ?? 0,
      paceStatus: row.paceStatus ?? "no_data",
    };
  }

  // hasImpr/hasClicks/hasViews (`imprPlan > 0` / `hasCpc` / `viewsPlan > 0 || hasCpv` in campM) -
  // true only when the CURRENT effLIs set carries a deliverable goal at all. A Scope filter that
  // narrows to zero line items, or to line items with no goal, must read as "No data", not as a
  // false "0.0pp / On pace" (pac/mA default to 0 rather than null when campM's weighted sums have
  // nothing to divide).
  const hasGoal = campaign.hasImpr === true || campaign.hasClicks === true || campaign.hasViews === true;
  const pac = hasGoal && typeof campaign.pac === "number" ? campaign.pac : null;
  const mA = hasGoal && typeof campaign.mA === "number" ? campaign.mA : null;
  const mT = typeof campaign.mT === "number" ? campaign.mT : (row.marginTargetPct ?? 0);

  return {
    pacingDeviationPct: pac,
    marginActualPct: mA,
    marginTargetPct: mT,
    paceStatus: hasGoal ? paceStatusFromPp(pac) : "no_data",
  };
}
