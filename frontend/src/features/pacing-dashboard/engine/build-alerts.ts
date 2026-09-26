/**
 * Computes this pacing's alerts in the browser, filter-aware - item 3 of the 2026-09-25 dashboard
 * filters follow-up: `AlertsBlock` used to read `row.alerts`, computed server-side for the WHOLE
 * pacing by `dash-gate/lib/health.mjs` (no URL filter ever reaches it), so a Scope filter that
 * changed every other figure on the page left the alert list exactly as it was.
 *
 * This ports the retired SPA's own client-side compute, `workspace/src/pages/Dashboard/components/
 * AlertsBlock.jsx`'s `computeDashboardAlerts` (read in full before writing this), onto the SAME
 * engine `./engine-loader.ts` already loads and the SAME `effLIs`/`LD0` split `build-metrics.ts`
 * uses for every other campaign-level, Scope-filtered-but-Lens-unfiltered reading (`cm`/`flCM`/
 * `scalars`) - so "a Scope filter (channels/labels/selection/range) changes the alert set, a Lens
 * filter (platforms/brk/brkf) does not" holds here for the exact same reason it holds there.
 *
 * NOT ported from `computeDashboardAlerts`:
 *   - `splitScopedMode`/`splitScopedPlans`/`selectedPeriodKey` - the retired SPA's dim-scope engine
 *     (`dim-scope.js`), which this Hub build has never vendored (see `../filters/spotlight-core.ts`'s
 *     own docblock on why porting it is a separate task). Every call below passes `false`/`null` for
 *     these, which is exactly what the reference itself does whenever no dim-split Scope is active -
 *     the common case, and the ONLY case this Hub build can represent today.
 *   - the conversion-only-day skip inside the reference's own `alertsDailyInput` (`cvOnlyDaysOf`,
 *     `primary-cv.js`) - a Primary Conversions overlay that mutates `liDaily` maps elsewhere in the
 *     retired SPA's store. This Hub's `factsDaily` never goes through that overlay, so there is no
 *     conversion-only day to skip; every day in `LD0[liId]` is a real delivery day already.
 *
 * REVOKED (owner, 2026-09-26): the 2026-09-25 "with no filters, the alert set must be exactly what
 * the server produced" contract, and the two departures it forced (a per-LI flight-window clip on
 * `scopedLiDaily` copied from `health.mjs`'s `liFacts`, and `today: asOf` copied from `health.mjs`'s
 * `today: latestDate`). `health.mjs` computes alerts for the Overview LIST - a different surface;
 * for a DASHBOARD the reference is `AlertsBlock.jsx`, whose `alertsDailyInput` never clips to a
 * line item's flight window and whose `today` is wall-clock (`AlertsBlock.jsx`:
 * `today: new Date().toISOString().slice(0, 10)`). Both are restored below to match the reference
 * exactly. Consequences accepted with the decision: a post-flight delivery row counts as fresh data
 * (`stale_data` measures against the true latest date, and `post_flight_delivery` can actually see
 * the post-flight rows it exists to detect), and staleness is judged against the real today, not
 * the data's own high-water mark.
 *
 * OUTPUT shaping mirrors `dash-gate/lib/health.mjs`'s own `row.alerts` construction (the function
 * this view no longer reads), not the retired SPA's rendering: `type`/`severity`/`text` straight off
 * the detector, `value`/`label` off `AlertsCore.displayParts`, `name` off the line item's OWN
 * description/channel (`LP[id].desc || LP[id].ch`) - matching health.mjs's `liCfgById[id].
 * description || liCfgById[id].channel`, because the Hub's contract carries no `display.liNames`
 * override map (the retired SPA's own source for that field) to prefer over it.
 */
import { createPacingEngine, getAlertsCore, getPacingCore } from "./engine-loader";
import { toEngineRaw } from "./build-metrics";
import type { LiDaily, NormalizedLiPlan } from "./vendor-types";
import { computeEffLIs } from "../filters/eff-lis";
import type { DashboardFilters } from "../filters/types";
import type { PacingAlertsConfigV1, PacingDashboardV1 } from "../types";
import type { PacingAlertV1 } from "../../pacing-overview/types";

/** The 13 configurable detectors, camelCase (the Hub's `PacingAlertsConfigV1`) bridged to the
 *  snake_case keys/fields `AlertsCore.computeAlerts`'s `cfg` argument reads (`shared/alerts-
 *  core.js`'s own `run('bid_fact_above_plan', ...)` etc.). `post_flight_delivery`/
 *  `paused_li_delivering` have no entry on either side - both detectors just run at their built-in
 *  defaults, on this codebase's server side too (`health.mjs` passes the same 13-key object). */
function toEngineAlertsConfig(cfg: PacingAlertsConfigV1 | undefined): Record<string, unknown> {
  if (!cfg) return {};
  return {
    bid_fact_above_plan: {
      enabled: cfg.bidFactAbovePlan.enabled,
      slack: cfg.bidFactAbovePlan.slack,
      window: cfg.bidFactAbovePlan.window,
      threshold_pct: cfg.bidFactAbovePlan.thresholdPct,
    },
    data_gap: { enabled: cfg.dataGap.enabled, slack: cfg.dataGap.slack, gap_days: cfg.dataGap.gapDays },
    ctr_below_target: { enabled: cfg.ctrBelowTarget.enabled, slack: cfg.ctrBelowTarget.slack, factor: cfg.ctrBelowTarget.factor },
    vcr_below_target: { enabled: cfg.vcrBelowTarget.enabled, slack: cfg.vcrBelowTarget.slack, factor: cfg.vcrBelowTarget.factor },
    ctr_above_target: { enabled: cfg.ctrAboveTarget.enabled, slack: cfg.ctrAboveTarget.slack, factor: cfg.ctrAboveTarget.factor },
    vcr_over_100: { enabled: cfg.vcrOver100.enabled, slack: cfg.vcrOver100.slack },
    no_impressions_yet: { enabled: cfg.noImpressionsYet.enabled, slack: cfg.noImpressionsYet.slack },
    pacing_off_pace: { enabled: cfg.pacingOffPace.enabled, slack: cfg.pacingOffPace.slack, low: cfg.pacingOffPace.low, high: cfg.pacingOffPace.high },
    margin_below_target: { enabled: cfg.marginBelowTarget.enabled, slack: cfg.marginBelowTarget.slack, gap_pp: cfg.marginBelowTarget.gapPp },
    spend_overspend: { enabled: cfg.spendOverspend.enabled, slack: cfg.spendOverspend.slack, warn_pct: cfg.spendOverspend.warnPct, bad_pct: cfg.spendOverspend.badPct },
    dsp_forecast_overspend: { enabled: cfg.dspForecastOverspend.enabled, slack: cfg.dspForecastOverspend.slack },
    stale_data: { enabled: cfg.staleData.enabled, slack: cfg.staleData.slack, days: cfg.staleData.days },
    rate_cost_above_plan: { enabled: cfg.rateCostAbovePlan.enabled, slack: cfg.rateCostAbovePlan.slack, threshold_pct: cfg.rateCostAbovePlan.thresholdPct },
  };
}

/** This line item's own display name for an alert, matching `health.mjs`'s `liCfgById[id].
 *  description || liCfgById[id].channel || null` exactly (see this file's own docblock). */
function liLabel(plan: NormalizedLiPlan | undefined): string | undefined {
  return plan?.desc || plan?.ch || undefined;
}

/** `computeDashboardAlerts`'s `scopeObjectByIds`, ported verbatim. */
function scopeObjectByIds<T, R>(obj: Record<string, T> | undefined, ids: string[], mapValue: (v: T, id: string) => R): Record<string, R> {
  const out: Record<string, R> = {};
  for (const id of ids || []) {
    if (obj && obj[id] !== undefined) out[id] = mapValue(obj[id], id);
  }
  return out;
}

/**
 * Computes this pacing's alerts for the given filters, shaped as `PacingAlertV1[]` - the same shape
 * `row.alerts` already carried, so `AlertsBlock` (`../pacing-overview/alerts-block.tsx`) needs no
 * change. Returns `[]` on any failure or missing input, matching `computeDashboardAlerts`'s own
 * early return and `build-metrics.ts`'s "failure is NOT fatal" fallback.
 */
export function buildPacingAlerts(
  data: PacingDashboardV1 | null | undefined,
  filters: DashboardFilters,
  // Wall-clock, exactly the value `AlertsBlock.jsx` passes its own `computeDashboardAlerts`
  // (`today: new Date().toISOString().slice(0, 10)`). A parameter (as in the reference) so tests
  // can pin a date; production callers take the default.
  today: string = new Date().toISOString().slice(0, 10)
): PacingAlertV1[] {
  if (!data || !data.campaign || !data.planByLineItem) return [];
  try {
    const engine = createPacingEngine();
    const PacingCore = getPacingCore();
    const AlertsCore = getAlertsCore();
    const raw = toEngineRaw(data);
    const { LP, LD: LD0, asOf } = engine.normalize(raw);
    if (!asOf) return [];

    const effLIs = computeEffLIs(LP, filters);
    if (!effLIs.length) return [];

    // Campaign-level reading for the state's `pacing.cost_budget_total`/`plan_impressions_total`:
    // the full-flight `campM(LD0, LP, asOf, effLIs, null)`, computed HERE on purpose - alerts are
    // judged against the whole flight, never the reader's current window, exactly as the retired
    // SPA's `computeDashboardAlerts` takes `flCM` explicitly in its own signature (`AlertsBlock.
    // jsx`). `metrics.campaign` is the RANGED reading since 2026-09-26 and must not feed this.
    // (LD0 - unfiltered by Lens, matching every other campaign-level reading.)
    const flCM = engine.campM(LD0, LP, asOf, effLIs, null);

    // `Record<string, unknown>`, not `LiPlanMap`: `AlertsCore.buildState` (untyped, like every
    // vendored engine call below `Record<string, unknown>`) reads a `.name` field per line item that
    // `NormalizedLiPlan` does not declare - see this file's own docblock.
    const scopedLiPlan: Record<string, unknown> = scopeObjectByIds(LP, effLIs, (plan) => ({ ...plan, name: liLabel(plan) }));
    // UNCLIPPED, matching the reference's `alertsDailyInput` (`AlertsBlock.jsx`) exactly: it scopes
    // by `effLIs`, drops conversion-only days (not applicable here - see this file's docblock), and
    // windows by the selected period ONLY when Period Scope is on - which this Hub build has no way
    // to switch on, so there is nothing to window. No `rd < plan.fs || rd > plan.fe` clip: that
    // predicate is `health.mjs`'s (the Overview list's), revoked here 2026-09-26 (docblock above).
    const scopedLiDaily: LiDaily = scopeObjectByIds(LD0, effLIs, (dd) => dd);

    const liMetrics: Record<string, unknown> = {};
    for (const id of effLIs) {
      const m = engine.liM(id, LD0, LP, asOf, null, false, null);
      if (!m) continue;
      // `mT` is NOT one of `liM`'s own fields - verified by reading it (`engine/vendor/
      // dashboard-metrics.js`'s `function liM`: `{...t, ...pr, mA, pI, au, ctr, vcr, cvr, cpm,
      // clientPr, eCl}`, no `mT`) and by running this file's own test against the crown fixture
      // before adding this line: `margin_below_target` never fired, because `detectMarginBelowTarget`
      // reads `+m.mT` and `NaN - gap_pp` makes every comparison false. The retired SPA's own
      // `liM` (`workspace/src/lib/dashboard/metrics.js`) has the identical gap - `campM` computes a
      // budget-weighted `mT` for the WHOLE campaign, but no per-LI `liM` ever did. Server-side,
      // `health.mjs` sidesteps this by hand-building `liMetricsForAlerts[id]` with `mT: plan.mTgt`
      // instead of calling `liM` at all - the same fix, applied here so the browser-computed alert
      // set actually contains what `row.alerts` (the thing this view no longer reads) always did.
      //
      // This is therefore the ONE deliberate departure from `AlertsBlock.jsx` in this file, and it
      // is the owner's call (2026-09-26), not an oversight: every other rule here follows the
      // reference exactly, but the reference's own `margin_below_target` is dead for the reason
      // above, and a margin warning that works is worth more than bug-for-bug fidelity. Remove this
      // line and the dashboard silently stops warning about margin; the Overview list and the Slack
      // summary would keep doing so, because they go through `health.mjs`, which already patches it.
      liMetrics[id] = { ...m, mT: LP[id]?.mTgt };
    }

    const pausedById: Record<string, boolean> = {};
    for (const id of effLIs) pausedById[id] = PacingCore.isLiPaused(LP[id], asOf);

    const campaign = data.campaign;
    const state = AlertsCore.buildState({
      pacing: {
        id: campaign.pacingId,
        dash_slug: campaign.slug,
        name: campaign.name,
        flight_start: campaign.startDate,
        flight_end: campaign.endDate,
        cost_budget_total: flCM.costBudTotal,
        plan_impressions_total: flCM.imprPlan,
      },
      liPlan: scopedLiPlan,
      liDaily: scopedLiDaily,
      liMetrics,
      // `flCM` wholesale, exactly as the reference passes `flightMetrics: flCM || {}` - which means
      // `forecastDspSpend` IS in here (campM returns it - vendored `dashboard-metrics.js`, search
      // `const forecastDspSpend`), so `dsp_forecast_overspend` is live here exactly as it is in the
      // reference; it just needs the forecast to actually exceed `costBudTotal` to fire.
      flightMetrics: flCM || {},
      // Wall-clock (the `today` parameter), matching `AlertsBlock.jsx`'s own
      // `today: new Date().toISOString().slice(0, 10)`. The 2026-09-25 `today: asOf` departure is
      // revoked - see this file's docblock.
      today,
      pausedById,
    });

    const { alerts: coreAlerts } = AlertsCore.computeAlerts(state, toEngineAlertsConfig(data.notify?.alerts));

    // Shaped exactly as `health.mjs` shapes `row.alerts` (see this file's own docblock) - the same
    // contract `AlertsBlock` already renders, so nothing downstream of this function changes.
    return coreAlerts.map((a) => {
      const alert = a as Record<string, unknown>;
      const parts = AlertsCore.displayParts(alert);
      const liId = alert.li_id != null ? String(alert.li_id) : undefined;
      return {
        type: alert.type as string,
        severity: alert.severity as PacingAlertV1["severity"],
        text: alert.text as string,
        value: parts.value ?? undefined,
        label: parts.label,
        liId,
        name: liId != null ? liLabel(LP[liId]) : undefined,
      };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pacing-dashboard] alerts unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
