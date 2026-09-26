/**
 * Hand-written types for the four vendored UMD modules under `./vendor/` (see `vendor/SOURCE.md`).
 * This file is NOT vendored — it is ours to own and edit, unlike everything in `./vendor/`.
 *
 * The vendored files are plain UMD scripts with no `import`/`export` statements, so a bare
 * `import X from "./vendor/x.js"` needs a declaration before TypeScript will resolve it at all.
 * TypeScript only consults an ambient `declare module "some/string"` for a NON-relative specifier
 * - a relative one (`./vendor/x.js`, which is what `engine-loader.ts` actually imports) is instead
 * resolved by looking for a same-named sibling declaration file, which is why each vendor file has
 * one next to it (`vendor/dashboard-metrics.d.ts` etc., written by us, not vendored) rather than an
 * ambient block living here. Those four sibling files import the shared interfaces below.
 *
 * Deliberately loose, same philosophy as `types-metrics.ts`'s own header: the widget/formula
 * grammar and the shape of `campM`'s ~90-key bag belong to Pacing's engine, not to this file, so
 * most return values are `Record<string, unknown>` rather than a key-by-key interface that would
 * need editing every time Pacing adds a metric.
 */

/** One raw fact row from `factsDaily` (`additionalProperties: true` on the wire — opaque). */
type FactRow = Record<string, unknown>;

/** A normalized per-line-item plan, as `DashboardMetrics.normalize()` builds it (`LP[id]`). */
interface NormalizedLiPlan {
  id: string;
  ch: string;
  dsp: string | null;
  rateType: string;
  budget: number;
  planImpr: number;
  mTgt: number;
  coef: boolean;
  ctrTgt: number | null;
  vcrTgt: number | null;
  fs: string;
  fe: string;
  containers: Record<string, unknown>[];
  labels: string[];
  pause_intervals: Record<string, unknown>[];
  desc: string | null;
  converted: boolean;
  currency: string | null;
  native_budget: number | null;
}

/** One day's flow bucket, as `zeroRow()`/`addFact` build it (`LD[liId][date]`). Every numeric
 *  field defaults to 0 — division-by-zero-yields-0 is canon, see pacing-core.js. */
type FlowRow = Record<string, number>;

/** `DashboardMetrics.normalize()`'s per-line-item daily delivery map. */
type LiDaily = Record<string, Record<string, FlowRow>>;

/** `DashboardMetrics.normalize()`'s per-line-item plan map. */
type LiPlanMap = Record<string, NormalizedLiPlan>;

/** A `{from, to}` window (`YYYY-MM-DD`, inclusive), or null for "the whole flight". */
interface DateRange {
  from: string;
  to: string;
}

/** The raw dashboard payload shape `DashboardMetrics.normalize()` expects — Pacing's own wire
 *  format (see `dash-gate/lib/merge.mjs`'s `response`), which is NOT byte-identical to the Hub's
 *  `PacingDashboardV1` contract; `build-metrics.ts` bridges the two. */
interface EngineRawPayload {
  campaign: {
    startDate: string;
    endDate: string;
    /** Currency conversion rate (native -> USD); 1 for a USD campaign. Bridged from the Hub's
     *  `PacingDashboardCampaignV1.rate` — see build-metrics.ts's `toEngineRaw`. */
    rate?: number | null;
  };
  factsDaily: FactRow[];
  planByLineItem: Record<string, Record<string, unknown>>;
  types?: { line_item_id: string; type: string }[];
}

interface NormalizeResult {
  LP: LiPlanMap;
  LD: LiDaily;
  asOf: string | null;
}

/** The engine instance `DashboardMetrics.create({core, currency, metricRegistry})` returns —
 *  only the members `build-metrics.ts` actually calls. */
interface DashboardMetricsEngine {
  normalize(raw: EngineRawPayload): NormalizeResult;
  buildFactsAggregates(
    factsDaily: FactRow[],
    rate: number | null | undefined,
    planMap: LiPlanMap
  ): { LD: LiDaily; LSD: Record<string, Record<string, Record<string, FlowRow>>>; asOf: string | null };
  buildLiSplitDaily(
    factsDaily: FactRow[],
    rate: number | null | undefined,
    planMap: LiPlanMap
  ): Record<string, Record<string, Record<string, FlowRow>>>;
  campM(
    liDaily: LiDaily,
    liPlan: LiPlanMap,
    asOf: string | null,
    effLIs: string[],
    range: DateRange | null
  ): Record<string, unknown>;
  campaignScalars(
    liPlan: LiPlanMap,
    effLIs: string[],
    asOf: string | null,
    flightStart: string,
    flightEnd: string,
    range: DateRange | null
  ): Record<string, number>;
  sumLiWindow(
    liDaily: LiDaily,
    plan: NormalizedLiPlan,
    liId: string,
    splitScopedPlan: unknown,
    window: { from: string; to: string | null }
  ): Record<string, number>;
  aggregateDateRows(
    sources: {
      liDaily: LiDaily;
      liPlan: LiPlanMap;
      effLIs: string[];
      flightStart: string;
      flightEnd: string;
      asOf: string | null;
    },
    range: DateRange | null,
    basis?: string
  ): Record<string, unknown>[];
  isVcrEligible(plan: NormalizedLiPlan | undefined, daily: Record<string, FlowRow> | undefined): boolean;
  buildRows(
    effLIs: string[],
    liDaily: LiDaily,
    liPlan: LiPlanMap,
    range: DateRange | null,
    splitScopedMode: boolean,
    splitScopedPlans: unknown,
    vcrEligibleSet: Set<string>
  ): Record<string, unknown>[];
  detailSource(name: string, ctx: Record<string, unknown>): { lines: unknown[]; sub: string | null } | null;
  canonicalNote(
    name: string,
    cm: Record<string, unknown>,
    flCM: Record<string, unknown>,
    effLIs: string[],
    facts: Record<string, unknown>
  ): string | null;
  brickValue(
    brick: Record<string, unknown>,
    ctx: Record<string, unknown>
  ): { value: number | null; target?: number | null; invert?: boolean; sub?: string | null; absent?: boolean } | null;
  parse(expr: string): { ok: boolean; ast: unknown; error?: string };
  evaluateOne(ast: unknown, ctx: { get(name: string): number | null }): { value: number | null };
  flightProgress(cm: Record<string, unknown>, flCM: Record<string, unknown>, effLIs: string[]): unknown;
  verdictOf(ctx: Record<string, unknown>): unknown;
  marginTone(cm: Record<string, unknown>, flCM: Record<string, unknown>, facts: { asOf: string | null }): unknown;
  deliveryUnits(cm: Record<string, unknown>): unknown;
  rateTypeRows(
    cm: Record<string, unknown>,
    flCM: Record<string, unknown>,
    series: string,
    opts: { coefMode: unknown }
  ): unknown;
  coefModeOf(liPlan: LiPlanMap): unknown;
  buildScopedDaily(
    facts: Record<string, unknown>,
    liPlan: LiPlanMap,
    rate: number | null | undefined,
    filters: Record<string, unknown>
  ): unknown;
  dailyForContainer(scopeIdx: unknown, liId: string, container: Record<string, unknown>, liDaily: LiDaily): unknown;
  sumDateChild(
    liId: string,
    child: Record<string, unknown>,
    container: Record<string, unknown>,
    splitScopedPlan: unknown,
    dateDaily: unknown
  ): FlowRow;
  sumDimChild(
    liId: string,
    child: Record<string, unknown>,
    container: Record<string, unknown>,
    splitScopedPlan: unknown,
    liSplitDaily: unknown
  ): FlowRow;
  childProgress(args: { ti: number; au: number; fs: string | null; fe: string | null; asOf: string | null }): unknown;
  splitActualMargin(
    act: FlowRow,
    child: Record<string, unknown> | null,
    container: Record<string, unknown>,
    plan: NormalizedLiPlan,
    marginWarn: number
  ): unknown;
  /** One line item's own metric bag (budget-weighted campM's per-LI sibling) - `build-alerts.ts`'s
   *  `liMetrics[id]`, matching the retired SPA's `computeDashboardAlerts`'s own `liM(...)` call. */
  liM(
    liId: string,
    liDaily: LiDaily,
    liPlan: LiPlanMap,
    asOf: string | null,
    range: DateRange | null,
    splitScopedMode: boolean,
    splitScopedPlans: unknown
  ): Record<string, unknown> | null;
}

interface DashboardMetricsModule {
  create(deps: { core: unknown; currency: unknown; metricRegistry: unknown }): DashboardMetricsEngine;
}

/** `buildMetricBag`, extracted verbatim from `dash-gate/lib/merge.mjs` (see `dashboard-metrics-glue.js`'s
 *  own docblock) - the crown test's ONLY use of the fifth vendor file: calling Pacing's real
 *  server-side glue function on the same raw fixture `build-metrics.ts` is exercised against,
 *  instead of comparing it to a hand-written TypeScript re-port that could drift unnoticed. */
interface DashboardMetricsGlueEngine {
  buildMetricBag(response: EngineRawPayload & Record<string, unknown>): Record<string, unknown>;
}

interface DashboardMetricsGlueModule {
  create(deps: {
    core: unknown;
    currency: unknown;
    metricRegistry: unknown;
    dashboardMetrics: unknown;
  }): DashboardMetricsGlueEngine;
}

interface PacingCoreModule {
  _parseUTC(s: string): Date;
  resolveDimAbs(child: Record<string, unknown>, container: Record<string, unknown>): number;
  buildDimScopeIndex(plan: NormalizedLiPlan): unknown;
  factOutsideSplits(idx: unknown, dimKey: string, row: Record<string, unknown>): boolean;
  /** Whether a line item is paused as of the given date (manual pause intervals - NOT the
   *  auto-out-of-schedule check `isLiPausedNow` also runs). `build-alerts.ts`'s clock is `asOf`
   *  (the data-freshness date), matching the retired SPA's own `AlertsBlock.jsx` comment: "so the
   *  badge, the frozen expected, and the alert suppression all resolve pause as-of the same date." */
  isLiPaused(plan: NormalizedLiPlan, asOf: string | null): boolean;
  [key: string]: unknown;
}

interface CurrencyModule {
  isConverted(currency: string | null, rate: number | null | undefined): boolean;
  currencyToUsd(amount: number, rate: number | null | undefined): number;
  [key: string]: unknown;
}

interface MetricRegistryModule {
  [key: string]: unknown;
}

/** `AlertsCore`, the sixth vendored file (`vendor/alerts-core.js`, see `vendor/SOURCE.md`) - only
 *  the members `build-alerts.ts` actually calls. Deliberately loose on `buildState`'s input/output
 *  shape, same philosophy as `DashboardMetricsEngine`'s `Record<string, unknown>` returns above:
 *  the detector/alert-object grammar belongs to Pacing's engine, not to this file. */
interface AlertsCoreModule {
  buildState(input: Record<string, unknown>): Record<string, unknown>;
  computeAlerts(
    state: Record<string, unknown>,
    cfg: Record<string, unknown>
  ): { alerts: Record<string, unknown>[]; types_evaluated: string[] };
  displayParts(alert: Record<string, unknown>): { value: string | null; label: string };
}

declare global {
  // eslint-disable-next-line no-var
  var DashboardMetrics: DashboardMetricsModule | undefined;
  // eslint-disable-next-line no-var
  var PacingCore: PacingCoreModule | undefined;
  // eslint-disable-next-line no-var
  var MetricRegistry: MetricRegistryModule | undefined;
  // eslint-disable-next-line no-var
  var Currency: CurrencyModule | undefined;
  // eslint-disable-next-line no-var
  var DashboardMetricsGlue: DashboardMetricsGlueModule | undefined;
  // eslint-disable-next-line no-var
  var AlertsCore: AlertsCoreModule | undefined;
}

export type {
  DashboardMetricsEngine,
  DashboardMetricsModule,
  PacingCoreModule,
  CurrencyModule,
  MetricRegistryModule,
  DashboardMetricsGlueEngine,
  DashboardMetricsGlueModule,
  AlertsCoreModule,
  NormalizedLiPlan,
  NormalizeResult,
  LiDaily,
  LiPlanMap,
  FlowRow,
  FactRow,
  DateRange,
  EngineRawPayload,
};
