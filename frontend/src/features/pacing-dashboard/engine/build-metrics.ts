/**
 * Computes a `PacingMetricsBag` in the browser, from a dashboard payload plus the current filters -
 * the wrapper the Operational Hub migration brief calls for (§6/filters): "bring dashboard filters
 * back by moving the metric calculation back into the browser".
 *
 * This is `buildMetricBag` from `AIAE-paicing/dash-gate/lib/merge.mjs` (starts ~line 523) - the
 * named reference for this file - with `effLIs` and `range` derived from the current
 * `DashboardFilters` instead of hardcoded to "everything, whole flight to date". Every other line
 * is the same four-piece shape: `cm`/`flCM` (campM, ranged and full-flight), `scalars`
 * (campaignScalars + the per-LI window sum), `series` (aggregateDateRows), `daily` (buildRows),
 * plus `sources`/`readings`/`containers`/`bound` off the same `brickCtx`.
 *
 * THE ACCEPTANCE TEST this file exists to pass: with every filter at its default (`DEFAULT_FILTERS`
 * from `filters/types.ts`), `buildPacingMetrics(data, DEFAULT_FILTERS)` must equal
 * `data.metrics` byte-for-byte - with ONE deliberate exception, `campaign`, published RANGED here
 * where the server publishes full-flight (see the comment at `const campaign = cm` below) - see
 * `build-metrics.crown.test.ts`. Every "uniform range" choice documented below was checked against
 * that requirement, not assumed.
 *
 * Closed gap (was documented here as out-of-scope; closed once the contract carried the fields):
 * the Hub's contract now carries the campaign's currency `rate` (`PacingDashboardCampaignV1.rate`)
 * and a line item's `costCoef`/`converted`/`currency` (`PacingLineItemPlanV1`) - both MATH inputs
 * the engine reads (`Currency.currencyToUsd` for delivery-cost conversion; `cost_coef` switches a
 * line item into per-fact-row coefficient-cost margin resolution). `toEngineRaw` below bridges them
 * to the snake_case shape the vendored engine expects. `converted`/`currency` on a plan are
 * display-only (feed the contract-total badge) and are bridged alongside `nativeBudget` for the same
 * reason that field already was.
 */
import { createPacingEngine, getPacingCore } from "./engine-loader";
import type {
  DashboardMetricsEngine,
  EngineRawPayload,
  FactRow,
  LiDaily,
  LiPlanMap,
} from "./vendor-types";
import { buildBreakdownFacts } from "../filters/breakdown-filter";
import { computeEffLIs, getEffRange } from "../filters/eff-lis";
import type { DashboardFilters } from "../filters/types";
import type { PacingDashboardV1 } from "../types";
import type { ContainerChildReading, ContainerReading, PacingMetricsBag } from "../types-metrics";

/** Bridges the Hub's `PacingDashboardV1` (camelCase-everywhere-except-`nativeBudget`/`cost_coef`
 *  contract) to the raw wire shape `DashboardMetrics.normalize()` expects - Pacing's own response
 *  object, which is NOT byte-identical to the Hub's contract at the edges (`campaign.id` vs `slug`,
 *  `native_budget`/`cost_coef` vs `nativeBudget`/`costCoef`, no `types` array on the Hub side). */
export function toEngineRaw(data: PacingDashboardV1): EngineRawPayload {
  const campaign = data.campaign ?? ({} as NonNullable<PacingDashboardV1["campaign"]>);
  const planByLineItem: Record<string, Record<string, unknown>> = {};
  for (const [id, plan] of Object.entries(data.planByLineItem ?? {})) {
    const p = plan as Record<string, unknown>;
    planByLineItem[id] = {
      channel: p.channel,
      dsp: p.dsp,
      rateType: p.rateType,
      clientBudget: p.clientBudget,
      plannedImpressions: p.plannedImpressions,
      marginTargetPct: p.marginTargetPct,
      ctrTargetPct: p.ctrTargetPct,
      vcrTargetPct: p.vcrTargetPct,
      flightStart: p.flightStart,
      flightEnd: p.flightEnd,
      containers: p.containers,
      pauseIntervals: p.pauseIntervals,
      // labels/description: added to PacingLineItemPlanV1 by STEP 7 of the migration brief.
      labels: p.labels,
      description: p.description,
      native_budget: p.nativeBudget,
      // cost_coef is a MATH input (per-fact-row coefficient-cost margin resolution, see
      // PacingLineItemPlanV1.costCoef's javadoc); converted/currency are display-only, bridged for
      // the same reason native_budget already was.
      cost_coef: p.costCoef,
      converted: p.converted,
      currency: p.currency,
    };
  }
  return {
    campaign: {
      startDate: campaign.startDate ?? "",
      endDate: campaign.endDate ?? "",
      // A MATH input (Currency.currencyToUsd converts delivery cost with it) - see
      // PacingDashboardCampaignV1.rate's javadoc. Always present on the contract (defaults to 1 for
      // a USD campaign), so `undefined` here only happens when `campaign` itself is absent.
      rate: campaign.rate,
    },
    factsDaily: (data.factsDaily ?? []) as FactRow[],
    planByLineItem,
    types: [],
  };
}

/** Every distinct `source` string a brick in this pacing's widgets names (ported from
 *  `merge.mjs:collectSources`). */
function collectSources(display: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.source === "string" && obj.source) found.add(obj.source);
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk((display as { widgets?: unknown })?.widgets ?? [], 0);
  return found;
}

/** The `series` names the rateRows bricks in this pacing ask for (ported from
 *  `merge.mjs:collectRateSeries`). */
function collectRateSeries(display: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === "rateRows" && typeof obj.series === "string" && obj.series) found.add(obj.series);
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk((display as { widgets?: unknown })?.widgets ?? [], 0);
  return found;
}

/** What one `source` name resolves to (ported from `merge.mjs:detailOrNote`). */
function detailOrNote(
  engine: DashboardMetricsEngine,
  name: string,
  ctx: { cm: Record<string, unknown>; flCM: Record<string, unknown>; effLIs: string[]; facts: { asOf: string | null } }
): { lines: unknown[]; sub: string | null } | null {
  const detail = engine.detailSource(name, ctx);
  if (detail && ((detail.lines && detail.lines.length) || detail.sub)) return detail;
  const note = engine.canonicalNote(name, ctx.cm, ctx.flCM, ctx.effLIs, ctx.facts);
  return note ? { lines: [], sub: note } : detail;
}

/** Every binding in this pacing's widgets, resolved to a number (ported from
 *  `merge.mjs:resolveBinds`). */
function resolveBinds(
  engine: DashboardMetricsEngine,
  display: unknown,
  brickCtx: Record<string, unknown>,
  scalars: Record<string, number>
): Record<string, unknown> {
  const ctx = { get: (name: string) => (name in scalars ? scalars[name] : null) };
  const bound: Record<string, unknown> = {};

  const resolve = (binding: unknown): void => {
    if (!binding || typeof binding !== "object") return;
    const key = JSON.stringify(binding);
    if (key in bound) return;
    const b = binding as { metric?: unknown; expr?: unknown };
    try {
      if (typeof b.metric === "string") {
        const v = engine.brickValue({ bind: binding as Record<string, unknown> }, brickCtx);
        bound[key] =
          v && (v.value != null || v.absent)
            ? { value: v.value, target: v.target ?? null, invert: !!v.invert, sub: v.sub ?? null }
            : v
              ? { value: v.value ?? null, target: v.target ?? null, invert: !!v.invert, sub: v.sub ?? null }
              : null;
      } else if (typeof b.expr === "string" && b.expr.trim()) {
        const parsed = engine.parse(b.expr);
        bound[key] = parsed && parsed.ok ? { value: engine.evaluateOne(parsed.ast, ctx).value } : null;
      }
    } catch {
      bound[key] = null;
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const k of ["bind", "target", "tick"]) resolve(obj[k]);
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };

  walk((display as { widgets?: unknown })?.widgets ?? [], 0);
  return bound;
}

/**
 * Per-container and per-child readings (ported from `merge.mjs:buildContainerReadings`).
 * Deliberately UNFILTERED on every axis - not just `platforms`/`brk`, but `channels`/`labels`/
 * `selection` too (it walks `Object.keys(LP)`, not `effLIs`) - matching the server's own comment:
 * "No URL filters server-side: this is the unfiltered reading, the one the plan is judged against.
 * A filtered view is the reader's own business."
 */
function buildContainerReadings(
  engine: DashboardMetricsEngine,
  raw: EngineRawPayload,
  LP: LiPlanMap,
  LD: LiDaily,
  asOf: string | null,
  campaignRate: number | null | undefined,
  notify: unknown
): Record<string, ContainerReading[]> {
  const out: Record<string, ContainerReading[]> = {};
  const withContainers = Object.keys(LP).filter((id) => (LP[id].containers || []).length > 0);
  if (!withContainers.length) return out;

  const LSD = engine.buildLiSplitDaily(raw.factsDaily, campaignRate, LP);
  const facts = { factsDaily: raw.factsDaily, liDaily: LD, liSplitDaily: LSD, asOf, rate: campaignRate };
  const scopeIdx = engine.buildScopedDaily(facts, LP, campaignRate, {});

  // `notify` here is the Hub's OWN camelCase `PacingNotifySettingsV1` contract (already reshaped
  // by PacingDashboardContractMapper.toV1), NOT Pacing's raw snake_case `config.notify` that
  // merge.mjs reads server-side (`alerts.margin_below_target.gap_pp`) - the field this wrapper
  // reads is `alerts.marginBelowTarget.gapPp`, same value, different casing at this one edge.
  const notifyObj = (notify as { alerts?: { marginBelowTarget?: { gapPp?: number } } }) || {};
  const marginWarn = -(notifyObj.alerts?.marginBelowTarget?.gapPp ?? 3);

  for (const liId of withContainers) {
    const plan = LP[liId];
    const rt = plan.rateType || "CPM";
    const nativeUnits = (a: Record<string, number>) =>
      rt === "CPC" ? a.cl || 0 : rt === "CPV" ? a.co || 0 : a.im || 0;

    out[liId] = (plan.containers || []).map((containerRaw) => {
      const container = containerRaw as Record<string, unknown>;
      const fs = (container.fs as string) || plan.fs;
      const fe = (container.fe as string) || plan.fe;
      const dateDaily = engine.dailyForContainer(scopeIdx, liId, container, LD);

      const child = (kind: "date" | "dim", cRaw: unknown) => {
        const c = cRaw as Record<string, unknown>;
        const act =
          kind === "date"
            ? engine.sumDateChild(liId, c, container, null, dateDaily)
            : engine.sumDimChild(liId, c, container, null, LSD);
        const cfs = kind === "date" ? (c.fs as string) || fs : fs;
        const cfe = kind === "date" ? (c.fe as string) || fe : fe;
        const ti =
          kind === "date"
            ? c.target_impressions
              ? Number(c.target_impressions)
              : 0
            : getPacingCore().resolveDimAbs(c, container);
        const units = kind === "date" ? nativeUnits(act) : act.im || 0;
        return {
          id: (c.id as string) || null,
          kind,
          label: kind === "date" ? (c.name as string) || null : `${c.dim_key as string}: ${c.dim_value as string}`,
          dimKey: kind === "dim" ? (c.dim_key as string) : null,
          dimValue: kind === "dim" ? (c.dim_value as string) : null,
          fs: cfs,
          fe: cfe,
          target: ti,
          actual: units,
          spend: act.sp || 0,
          clientCost: act.dc || 0,
          progress: engine.childProgress({ ti, au: units, fs: cfs, fe: cfe, asOf }),
          margin: engine.splitActualMargin(act, c, container, plan, marginWarn),
        } as unknown as ContainerChildReading;
      };

      const own = engine.sumDateChild(liId, { fs, fe }, container, null, dateDaily);
      const ownUnits = nativeUnits(own);
      const ownTarget = Number(container.target_impressions) || 0;
      return {
        id: (container.id as string) || null,
        name: (container.name as string) || null,
        fs,
        fe,
        target: ownTarget,
        actual: ownUnits,
        spend: own.sp || 0,
        clientCost: own.dc || 0,
        progress: engine.childProgress({ ti: ownTarget, au: ownUnits, fs, fe, asOf }),
        margin: engine.splitActualMargin(own, null, container, plan, marginWarn),
        dateChildren: ((container.date_children as unknown[]) || []).map((c) => child("date", c)),
        dimChildren: ((container.dim_children as unknown[]) || []).map((c) => child("dim", c)),
      } as unknown as ContainerReading;
    });
  }
  return out;
}

/**
 * Computes this pacing's `PacingMetricsBag` for the given filters. Returns `null` on any failure -
 * malformed payload, missing plan - same fallback `merge.mjs` uses server-side ("failure is NOT
 * fatal... a null bag means 'no figures'").
 */
export function buildPacingMetrics(
  data: PacingDashboardV1 | null | undefined,
  filters: DashboardFilters
): PacingMetricsBag | null {
  if (!data || !data.campaign || !data.planByLineItem) return null;
  try {
    const engine = createPacingEngine();
    const raw = toEngineRaw(data);
    const { LP, LD: LD0, asOf } = engine.normalize(raw);

    const effLIs = computeEffLIs(LP, filters);

    // Fact-row-level filtering (platforms/brk/brkf) is NOT uniform - verified against the
    // retired SPA's own split, `workspace/src/lib/dashboard/selectors.js` +
    // `workspace/src/pages/Dashboard/components/Widgets/useWidgetData.js`:
    //
    //   - `campM` (`selectCampMetrics`/`makeCampMetricsSelector`) reads `selectPeriodDaily` -
    //     channels/labels/selection/range apply (via effLIs/range), platforms/brk/brkf do NOT.
    //     The plan (client budget, planned impressions, margin target) lives per line item and
    //     is not split by platform or breakdown dimension, so campM has to compare a WHOLE
    //     actual against the WHOLE plan.
    //   - Charts (`makeChartSelector`) and the Daily Performance table (`useWidgetData.js`'s
    //     `sources.liDaily`, built off `readers.delivery` = `makeDeliveryFactsSelector` =
    //     `buildBreakdownFacts`) DO read the platforms/brk/brkf-filtered facts - the file's own
    //     comment: "Plan evaluation uses Scope facts. Analytical readings apply the entire Lens,
    //     including platform, on the original rows so multiple cuts compose exactly."
    //
    // So: `LD0` (unfiltered by platforms/brk/brkf; effLIs/range still narrow it downstream) feeds
    // every campaign-level reading - `cm`, `flCM`, `campaign`, the scalars window-sum, `brickCtx`
    // (and therefore `sources`/`readings`/`bound`). `LD` (platform/brk/brkf-filtered) feeds only
    // `series` and `daily` - the delivery-row-level views, matching the Lens/Scope split above.
    const filtered = buildBreakdownFacts(
      { factsDaily: raw.factsDaily, liDaily: LD0, asOf, rate: raw.campaign.rate },
      filters,
      raw.campaign.rate,
      LP,
      (factsDaily, rate, planMap) => engine.buildFactsAggregates(factsDaily, rate, planMap)
    );
    const LD = filtered?.liDaily ?? LD0;

    // range/customRange clip the window, replacing merge.mjs's hardcoded default - which is
    // exactly what getEffRange returns when filters.range === 'all' (no filter applied), so `cm`,
    // `series` and `daily` below all stay byte-identical to the server bag in the no-filter case
    // whether they're handed `range` or (as merge.mjs did) `null` - see eff-lis.ts's docblock.
    const range = getEffRange(filters, { startDate: raw.campaign.startDate, endDate: raw.campaign.endDate }, asOf);

    // Campaign-level readings: UNFILTERED by platforms/brk/brkf (LD0), per the split above.
    const cm = engine.campM(LD0, LP, asOf, effLIs, range);
    const flCM = engine.campM(LD0, LP, asOf, effLIs, null);
    // The published bag is the RANGED reading (owner decision, 2026-09-25/26): everything that
    // shows `metrics.campaign` - the Daily Performance table's totals, the KPI strip's Pace/Margin
    // (`pacing-dashboard-health.ts`), CPM to date - follows the chosen window, same as the rows and
    // charts beside it. The retired SPA reads the same way: its headline campM is ranged
    // (`workspace/src/lib/dashboard/selectors.js`, `makeCampMetricsSelector` takes `rangeKeyOf`),
    // and with no range chosen its default window is `{from: startDate, to: asOf}` - "so far", not
    // "the whole plan".
    //
    // The server glue (`vendor/dashboard-metrics-glue.js`) publishes `flCM` instead - but its rule
    // ("the table's totals have to add up to buildRows' rows beside them") holds THERE because its
    // buildRows is unranged too; ours takes `range` (see `daily` below), so here it's `cm` that
    // makes the totals add up to the rows and `flCM` that doesn't. This is the ONE deliberate
    // divergence from the server bag, so `build-metrics.crown.test.ts` pins `campaign` to its own
    // stated rule (the engine's ranged campM) and every other field to the server byte-for-byte.
    //
    // `flCM` stays computed: `brickCtx` and the readings (flightProgress, marginTone, rateRows)
    // still take the full-flight reading, and `build-alerts.ts` computes its own `flCM` - alerts
    // are judged against the whole flight, never the reader's window.
    const campaign = cm;

    const scalars = engine.campaignScalars(
      LP,
      effLIs,
      asOf,
      raw.campaign.startDate,
      raw.campaign.endDate,
      range
    );
    // Flow + expected fields, summed over every line item's own flight window - NOT range-clipped,
    // matching merge.mjs's literal `{ from: plan.fs, to: asOf }` exactly (a cumulative to-date
    // total feeding `costBud` and friends, independent of the visible window). Campaign-level, so
    // LD0 (unfiltered by platforms/brk/brkf) - same reasoning as cm/flCM above.
    for (const id of effLIs) {
      const plan = LP[id];
      const win = engine.sumLiWindow(LD0, plan, id, null, { from: plan.fs, to: asOf });
      for (const [k, v] of Object.entries(win)) scalars[k] = (scalars[k] || 0) + v;
    }

    const series = engine.aggregateDateRows(
      {
        liDaily: LD,
        liPlan: LP,
        effLIs,
        flightStart: raw.campaign.startDate,
        flightEnd: raw.campaign.endDate,
        asOf,
      },
      range,
      "ts"
    );

    // Campaign-level context (detail cards, verdict, margin tone, rate rows, resolveBinds
    // expressions): LD0, matching cm/flCM above - a card asking a question about the facts has
    // to ask the same (unfiltered) facts cm/flCM's own numbers came from.
    const brickCtx = {
      cm,
      flCM,
      facts: { asOf },
      effLIs,
      data: { sources: { liDaily: LD0, liPlan: LP, effLIs } },
    };
    const sources: Record<string, unknown> = {};
    for (const name of collectSources(data.display)) {
      try {
        sources[name] = detailOrNote(engine, name, brickCtx);
      } catch {
        sources[name] = null;
      }
    }

    const readings: Record<string, unknown> = {};
    const reading = (name: string, fn: () => unknown) => {
      try {
        readings[name] = fn();
      } catch {
        readings[name] = null;
      }
    };
    reading("flightProgress", () => engine.flightProgress(cm, flCM, effLIs));
    reading("verdict", () => engine.verdictOf(brickCtx));
    reading("marginTone", () => engine.marginTone(cm, flCM, { asOf }));
    reading("deliveryUnits", () => engine.deliveryUnits(cm));
    const coefMode = engine.coefModeOf(LP);
    const rateRows: Record<string, unknown> = {};
    for (const s of collectRateSeries(data.display)) {
      try {
        rateRows[s] = engine.rateTypeRows(cm, flCM, s, { coefMode });
      } catch {
        rateRows[s] = null;
      }
    }
    readings.rateRows = rateRows;

    const vcrEligible = new Set(effLIs.filter((id) => engine.isVcrEligible(LP[id], LD[id])));
    const daily = engine.buildRows(effLIs, LD, LP, range, false, null, vcrEligible);

    return {
      asOf,
      campaign,
      scalars,
      series,
      daily,
      sources,
      readings,
      containers: buildContainerReadings(engine, raw, LP, LD0, asOf, raw.campaign.rate, data.notify),
      bound: resolveBinds(engine, data.display, brickCtx, scalars),
    } as unknown as PacingMetricsBag;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pacing-dashboard] metric bag unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
