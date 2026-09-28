/**
 * The Breakdown panel's data half: everything between the dashboard payload and the donut/table,
 * with no React in it.
 *
 * Ported from the retired SPA's campaign-level Breakdown - `CampaignBreakdown.jsx` (the merge and
 * the frame) wrapping `LineItemList/Breakdown.jsx` (the tabs, the rows, the totals). Everything
 * those two did in `useMemo`s lives here instead, for the reason `build-metrics.ts` exists: the
 * arithmetic is Pacing's, it is the same engine, and a component is the wrong place to keep it.
 *
 * TWO FACT SETS, and mixing them up is the bug this file is shaped to avoid:
 *
 *   - Which dimensions this pacing HAS (the tab bar) is read from the UNFILTERED aggregate. It is a
 *     property of the data, not of the current view. Reading it from the filtered one is what made
 *     clicking a row remove that row's own tab - the filter leaves the dimension with exactly one
 *     value, and the tab stops qualifying (the SPA's 2026-03-13 fix, preserved).
 *   - Every NUMBER on the panel is read from the Lens-filtered aggregate (`buildBreakdownFacts`,
 *     `filters/breakdown-filter.ts`), so a platform or breakdown chip composes with the cut on
 *     screen exactly as it does for the charts and the Daily Performance table.
 *
 * The line SET still narrows both: which line items you are looking at is scope, not a slice of
 * their delivery, so `channels`/`labels`/`selection` reach the tab bar too.
 *
 * Per-line-item mode is NOT ported. The SPA rendered this panel inside a line-item card as well,
 * and that mode is what its `liId`/`aggregateOutside`/"Outside splits" branches serve; the Hub has
 * one campaign-level panel and no line-item cards to hang a second one off.
 */
import { createPacingEngine } from "../engine/engine-loader";
import type { DateRange, FactRow, LiDaily, LiPlanMap } from "../engine/vendor-types";
import { buildBreakdownFacts, FILTERABLE_DIMS } from "../filters/breakdown-filter";
import { computeEffLIs, getEffRange } from "../filters/eff-lis";
import type { DashboardFilters } from "../filters/types";
import type { PacingDashboardV1 } from "../types";
import { toEngineRaw } from "../engine/build-metrics";
import {
  aggregateDimSource,
  breakdownDimsFor,
  coverageLineFor,
  coverageWindowFor,
  deviceBucketMap,
  dimSourceAvailable,
  dimSourceUnitKey,
  discrepancyLabel,
  isDimSourceDim,
  rowUnitKeyFor,
  stalenessLabel,
  type BreakdownDimEntry,
  type ConfiguredDimSource,
  type DimSourceEntry,
} from "./dim-coverage";
import {
  aggregateConversion,
  aggregateCreativeAsset,
  aggregateDim,
  aggregateOutside,
  breakdownTotals,
  detectAvailDims,
  dimTaggedDelivery,
  enrichRows,
  mergeSplitAcrossLIs,
  rateExtremes,
  sortRows,
  deliveryByDate,
  splitKeysFor,
  type BreakdownRow,
  type BreakdownTotals,
  type DimBucket,
  type LiSplitDaily,
  type UnitKey,
} from "./breakdown-aggregate";

/** The DSP's own creative names, from `<slug>.creatives.json`. Not a fact-row dimension: the rows
 *  live in their own file, so this cut is offered only when that file reached the browser. */
export const CREATIVE_ASSET_DIM = "creative_asset";
/** Conversion actions, from `<slug>.conversions.json`. Same presence rule, and its own column set:
 *  the conversions mart carries no impressions, clicks or spend to show. */
export const CONVERSION_DIM = "conversion_action";

/** Display order: audience first, then the namebuilder positions, then the two aux-fed cuts. The
 *  tab bar renders the intersection of this and what the pacing actually has. */
const DIM_ORDER = [
  "audience",
  "tactic",
  "platform",
  "comment",
  "geo",
  "creative",
  "message",
  "keyword",
  "flight",
  "language",
  CREATIVE_ASSET_DIM,
  CONVERSION_DIM,
];

export const DIM_LABELS: Record<string, string> = {
  audience: "Audience",
  tactic: "Funnel",
  platform: "Platform",
  comment: "Comment",
  geo: "Geo",
  creative: "Creative (tag)",
  message: "Message",
  keyword: "Keyword",
  flight: "Flight",
  language: "Language",
  [CREATIVE_ASSET_DIM]: "Creative (asset)",
  [CONVERSION_DIM]: "Conversion Action",
};

/** Second line on a tab, where the name alone would not say which of two similar cuts this is. */
export const DIM_SUBLABELS: Record<string, string> = {
  tactic: "Prospecting / Retargeting / …",
  creative: "from planner / namebuilder",
  [CREATIVE_ASSET_DIM]: "from DSP",
  [CONVERSION_DIM]: "from conversions mart",
};

/** A cut whose values live in their own aux file rather than on the delivery rows. No fact carries
 *  one, so no `brkf` filter can match one: clicking such a row would leave a chip that filters
 *  nothing AND demote a live dim filter from Scope to Lens (`filters/spotlight-core.ts` explains
 *  the tiering). The panel refuses the click instead. */
export function isUnfilterable(dim: string): boolean {
  return dim === CREATIVE_ASSET_DIM || dim === CONVERSION_DIM || isDimSourceDim(dim);
}

/**
 * What a dimension source states about ITSELF, under the tabs. A built-in cut has none of this and
 * gets null: it partitions delivery by construction and would only be claiming 100% of itself.
 *
 *   line    how much of delivery the source knows about, and how much of that it can name
 *   window  the days that was measured over - the tab clips to the days BOTH sides have, so on a
 *           lagging source its Total is legitimately smaller than every other tab's
 *   gap     the overflow case only: a source claiming more delivery than the pacing has
 *   stale   whether these are the rows the loader last READ or last managed to read
 *
 * All four are permanent labels, not alerts: real data never reconciles to the digit, and a source
 * on its own schedule is routinely a day behind.
 */
export interface CoverageNote {
  line: string | null;
  window: string | null;
  gap: string | null;
  stale: string | null;
}

/** One tab's name, and the line under it where the name alone would not say which cut this is. */
export interface DimMeta {
  label: string;
  sub?: string;
}

/** Everything the panel needs that does NOT depend on which tab is open. */
export interface BreakdownContext {
  /** Cuts this pacing has, in display order. Empty means the panel does not render at all. */
  dims: string[];
  /** What each tab is CALLED. A built-in cut's name is fixed; a dimension source names its own, so
   *  the two are resolved together here rather than looked up twice in the renderer. */
  dimMeta: Record<string, DimMeta>;
  /** The campaign's buying unit - `im`/`cl`/`co` - which sizes the donut, the shares and the
   *  `Others` remainder. */
  unitKey: UnitKey;
  rateType: "CPM" | "CPC" | "CPV";
  /** Campaign delivery in `unitKey`, for the `Others` remainder. */
  liTotalUnits: number;
  /** `{ '<dim>:<value>': { date: bucket } }` merged across the line items in view. */
  splitData: Record<string, Record<string, DimBucket>>;
  creatives: readonly FactRow[] | null;
  conversions: readonly FactRow[] | null;
  liIdSet: ReadonlySet<string>;
  vcrEligible: ReadonlySet<string>;
  range: DateRange | null;
  rate: number | null | undefined;
  /**
   * The one line item in view, or null. Delivery is per line item, so "everything its container
   * splits do not declare" only means something inside ONE of them - which is why the reference
   * offers that row from a line-item card and nowhere else. The Hub has no line-item cards; being
   * scoped to a single line item (a `selection` of one, as the Spotlight sets) is the same state,
   * reached the way this app reaches it.
   */
  soleLiId: string | null;
  /** That line item's plan, read only for its container scope index. */
  solePlan: LiPlanMap[string] | null;
  /** The dimension-source cuts this pacing offers, by axis key. A source describes PART of
   *  delivery rather than partitioning it, which is why these carry their own coverage line. */
  sourceByDim: Record<string, BreakdownDimEntry>;
  /** The loaded source files, by source id. */
  dimSources: Record<string, DimSourceEntry>;
  /** The configured sources, by id - read for the per-dimension grouping dictionary. */
  configuredSources: Record<string, ConfiguredDimSource>;
  /** The unit a SOURCE is measured in. Differs from `unitKey` only on a completes-bought pacing,
   *  where the visible column is the gated one and a raw-completes leftover would have nowhere to
   *  print. */
  srcUnitKey: UnitKey | "coV";
  hasGatedBasis: boolean;
  /** The Lens-filtered per-line-item daily delivery, and the plans - what a source is compared
   *  AGAINST. Read from the same aggregate the Total row is built from, so "Not covered" measures a
   *  real gap rather than the difference between two of our own sums. */
  liDaily: LiDaily;
  liPlanMap: LiPlanMap;
  asOf: string | null;
}

/** One tab's worth of rows, for the dim/sort the viewer picked. */
export interface BreakdownView {
  rows: BreakdownRow[];
  totals: BreakdownTotals;
  /** The donut's denominator: the sum of every row's primary-unit figure. */
  totalUnits: number;
  /**
   * Which per-row field carries the primary quantity ON THIS TAB - the donut's size axis, the
   * percentage beside each label, and the one cell a leftover row may fill instead of dashing.
   * Usually the pacing's buying unit; a dimension source on a completes-bought pacing differs,
   * because the visible completes column there is the GATED one and a raw-completes leftover would
   * have no column to print in.
   */
  rowUnitKey: string;
  extremes: ReturnType<typeof rateExtremes>;
  /** The conversions cut shows Conv / P-Click / P-View instead of the delivery columns. */
  isConversionDim: boolean;
  /** Column visibility, decided by what the rows actually carry. */
  showCpm: boolean;
  showVcr: boolean;
  showConversions: boolean;
  /** Delivery this line item ran outside its own dim splits on this cut, or null when there is
   *  nothing to be outside of (no covering container, more than one line item in view, or a cut
   *  whose values are not on the delivery rows at all). */
  outside: OutsideReading | null;
  /** Non-null only on a dimension-source cut. */
  coverage: CoverageNote | null;
}

/** The "Outside splits" line under the table. `units` is in the pacing's buying unit, `share` its
 *  percentage of the line item's delivery - the two figures the reference prints. */
export interface OutsideReading {
  liId: string;
  units: number;
  share: number;
}

function hasOwn(o: object | null | undefined, k: string): boolean {
  return o != null && Object.prototype.hasOwnProperty.call(o, k);
}

/** This source's grouping dictionary for one of its dimensions, or undefined. Passed rather than
 *  looked up by dimension name: two sources may both map a column called `city`, and resolving by
 *  name alone would merge one source's spellings into the other's. */
function groupsOf(configured: Record<string, ConfiguredDimSource>, sd: BreakdownDimEntry): unknown {
  const src = hasOwn(configured, sd.sourceId) ? configured[sd.sourceId] : null;
  const groups = src?.groups;
  return groups && typeof groups === "object" && hasOwn(groups, sd.key)
    ? (groups as Record<string, unknown>)[sd.key]
    : undefined;
}

function unitKeyFor(rateType: string): UnitKey {
  return rateType === "CPC" ? "cl" : rateType === "CPV" ? "co" : "im";
}

/** Does any row in an aux file belong to a line item in view? Presence IS the signal - a file that
 *  loaded but references none of these line items is correctly hidden, not silently empty. */
function auxHasRows(rows: readonly FactRow[] | null | undefined, liIdSet: ReadonlySet<string>): boolean {
  if (!Array.isArray(rows) || rows.length === 0 || liIdSet.size === 0) return false;
  return rows.some((row) => liIdSet.has(String(row?.line_item_id)));
}

/**
 * Builds the tab-independent half. Returns null when the payload cannot be read at all, and a
 * context with `dims: []` when it can but this pacing has nothing to break down - the panel
 * renders nothing in both cases, and the caller does not have to tell them apart.
 */
export function buildBreakdownContext(
  data: PacingDashboardV1 | null | undefined,
  filters: DashboardFilters
): BreakdownContext | null {
  if (!data || !data.campaign || !data.planByLineItem) return null;
  try {
    const engine = createPacingEngine();
    const raw = toEngineRaw(data);
    const { LP, LD: LD0, asOf } = engine.normalize(raw);
    const rate = raw.campaign.rate;
    const effLIs = computeEffLIs(LP, filters);
    const range = getEffRange(filters, { startDate: raw.campaign.startDate, endDate: raw.campaign.endDate }, asOf);
    const liIdSet = new Set(effLIs.map(String));

    // The unfiltered split aggregate - the tab bar's only input, per this file's docblock.
    const rawLsd = engine.buildLiSplitDaily(raw.factsDaily, rate, LP);

    // ...and the Lens-filtered one, which every number is read from. `buildBreakdownFacts` returns
    // its input BY REFERENCE when no platform/breakdown chip is active (its own short-circuit), and
    // that input carries no `liSplitDaily` - so the unfiltered aggregate above IS the answer then,
    // and rebuilding it would be the same walk twice.
    const filtered = buildBreakdownFacts(
      { factsDaily: raw.factsDaily, liDaily: LD0, asOf, rate },
      filters,
      rate,
      LP,
      (factsDaily, r, planMap) => engine.buildFactsAggregates(factsDaily, r, planMap)
    );
    const lsd = (filtered?.liSplitDaily ?? rawLsd) as LiSplitDaily;
    const ld = (filtered?.liDaily ?? LD0) as LiDaily;

    const vcrEligible = new Set(effLIs.filter((id) => engine.isVcrEligible(LP[id], ld[id])));
    const rateType = engine.domRateType(LP, effLIs);
    const unitKey = unitKeyFor(rateType);

    const merged = mergeSplitAcrossLIs({ liSplitDaily: lsd, liDaily: ld }, effLIs, LP, range, vcrEligible);

    const creatives = (data.creatives ?? null) as readonly FactRow[] | null;
    const conversions = (data.conversions ?? null) as readonly FactRow[] | null;

    const avail = detectAvailDims(
      splitKeysFor(rawLsd, liIdSet),
      dimTaggedDelivery(rawLsd, LD0, liIdSet, LP)
    );
    if (auxHasRows(creatives, liIdSet)) avail.add(CREATIVE_ASSET_DIM);
    if (auxHasRows(conversions, liIdSet)) avail.add(CONVERSION_DIM);

    // Dimension sources. Their values live in their own file, so nothing above can see them: the
    // list comes from the pacing's configured sources, narrowed to the breakdowns whose rows may
    // actually be served, and each is offered only when it has rows for a line item in view AND
    // few enough values for a donut to say anything.
    const dataNs = (data.data ?? {}) as { dim_sources?: readonly ConfiguredDimSource[] };
    const configured = Array.isArray(dataNs.dim_sources) ? dataNs.dim_sources : [];
    const dimSources = (data.dimSources ?? {}) as Record<string, DimSourceEntry>;
    const configuredSources: Record<string, ConfiguredDimSource> = {};
    for (const src of configured) if (src?.id) configuredSources[src.id] = src;
    const sourceDims = breakdownDimsFor(configured, dimSources);
    const sourceByDim: Record<string, BreakdownDimEntry> = {};
    for (const sd of sourceDims) {
      const entry = hasOwn(dimSources, sd.sourceId) ? dimSources[sd.sourceId] : null;
      if (!dimSourceAvailable(entry?.rows, liIdSet, sd.key, groupsOf(configuredSources, sd))) continue;
      sourceByDim[sd.dim] = sd;
      avail.add(sd.dim);
    }

    const hasGatedBasis = vcrEligible.size > 0;
    const soleLiId = effLIs.length === 1 ? String(effLIs[0]) : null;
    // Built-ins in their fixed order, then the source cuts in the order the sources were
    // configured - a source's dimensions are per pacing and have no place in a fixed list.
    const dims = [
      ...DIM_ORDER.filter((dim) => avail.has(dim)),
      ...sourceDims.map((sd) => sd.dim).filter((dim) => avail.has(dim)),
    ];
    const dimMeta: Record<string, DimMeta> = {};
    for (const key of dims) {
      const sd = hasOwn(sourceByDim, key) ? sourceByDim[key] : null;
      dimMeta[key] = sd
        ? { label: sd.label, sub: sd.note }
        : { label: DIM_LABELS[key] ?? key, sub: DIM_SUBLABELS[key] };
    }

    return {
      dims,
      dimMeta,
      unitKey,
      rateType,
      liTotalUnits: merged.totals[unitKey] ?? 0,
      splitData: merged.mergedSplit,
      creatives,
      conversions,
      liIdSet,
      vcrEligible,
      range,
      rate,
      soleLiId,
      solePlan: soleLiId ? (LP[soleLiId] ?? null) : null,
      sourceByDim,
      dimSources,
      configuredSources,
      srcUnitKey: dimSourceUnitKey(unitKey, hasGatedBasis),
      hasGatedBasis,
      liDaily: ld,
      liPlanMap: LP,
      asOf,
    };
  } catch (err) {
    // Same fallback as `buildPacingMetrics`: a malformed payload costs this one panel, never the
    // page around it.
    // eslint-disable-next-line no-console
    console.warn(`[pacing-dashboard] breakdown unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The rows for one tab. Separate from the context so switching tabs or re-sorting does not
 *  re-walk every fact row in the pacing. */
export function buildBreakdownView(
  ctx: BreakdownContext,
  dim: string,
  sortCol: string,
  sortDir: "asc" | "desc"
): BreakdownView {
  const isConversionDim = dim === CONVERSION_DIM;
  const sd = Object.prototype.hasOwnProperty.call(ctx.sourceByDim, dim) ? ctx.sourceByDim[dim] : null;
  // A source cut is measured in its OWN unit, which on a completes-bought pacing is the gated
  // column rather than raw completes - the one the table actually prints.
  const rowUnitKey = (isConversionDim ? "cv" : rowUnitKeyFor(dim, ctx.unitKey, ctx.hasGatedBasis)) as keyof DimBucket;

  let dimMap: Record<string, DimBucket>;
  let sourceResult: ReturnType<typeof aggregateDimSource> | null = null;
  if (sd) {
    const entry = Object.prototype.hasOwnProperty.call(ctx.dimSources, sd.sourceId)
      ? ctx.dimSources[sd.sourceId]
      : null;
    sourceResult = aggregateDimSource(entry?.rows, {
      dimKey: sd.key,
      liIdSet: ctx.liIdSet,
      anchor: rowUnitKey,
      deliveryByDate: deliveryByDate(
        ctx.liDaily, ctx.liIdSet, ctx.liPlanMap, ctx.range, ctx.unitKey, ctx.srcUnitKey, ctx.vcrEligible
      ),
      range: ctx.range,
      liPlanForFlight: ctx.liPlanMap,
      vcrEligibleIds: ctx.vcrEligible,
      groups: groupsOf(ctx.configuredSources, sd),
    });
    // The two leftover rows are what make the parts add up to delivery: what the source saw but
    // could not name, and what it never saw at all.
    dimMap = deviceBucketMap(sourceResult, rowUnitKey);
  } else if (dim === CREATIVE_ASSET_DIM) {
    dimMap = aggregateCreativeAsset(ctx.creatives, ctx.liIdSet, ctx.range, ctx.vcrEligible, ctx.rate);
  } else if (isConversionDim) {
    dimMap = aggregateConversion(ctx.conversions, ctx.liIdSet, ctx.range);
  } else {
    dimMap = aggregateDim(ctx.splitData, dim, ctx.range);
  }

  // No `Others` remainder on the two aux cuts: a conversion total does not sum to a delivery
  // total, and a DSP creative list is not a partition of the line item's delivery either.
  const rows = sortRows(
    enrichRows(dimMap, {
      unitKey: ctx.unitKey,
      liTotalUnits: ctx.liTotalUnits,
      // No `Others` on a source cut either: 'Not covered' already IS that remainder, measured over
      // the days the source and delivery share, so a second one would count the same missing
      // delivery twice under a second name.
      withOthers: dim !== CREATIVE_ASSET_DIM && !isConversionDim && !sd,
    }),
    sortCol,
    sortDir
  );

  const totalUnits = rows.reduce((sum, row) => sum + (row[rowUnitKey] || 0), 0);

  // Only a delivery dimension can have an outside: the two aux cuts' values are not on the fact
  // rows, so a container split can neither declare nor fail to declare one.
  const outsideBucket = ctx.soleLiId && FILTERABLE_DIMS.includes(dim)
    ? aggregateOutside(ctx.splitData, ctx.solePlan, dim, ctx.range)
    : null;
  const outsideUnits = outsideBucket ? outsideBucket[ctx.unitKey] || 0 : 0;

  return {
    rows,
    totals: breakdownTotals(rows),
    totalUnits,
    rowUnitKey,
    extremes: rateExtremes(rows),
    isConversionDim,
    // CPM leads only a campaign bought on impressions - a clicks-bought breakdown should not.
    showCpm: !isConversionDim && ctx.rateType === "CPM",
    // The VCR pair is gated: it shows when some row has completes from a VCR-eligible line, so a
    // display line's impressions to the same value cannot dilute the video completion rate. On ONE
    // line item bought on completed views the columns stay whether or not any have landed yet -
    // that is the line's own metric, and an empty column says "none yet" where a missing one says
    // "not measured here" (the reference's `liPlan?.rateType === 'CPV'` branch, which only ever
    // applied in its per-line-item mode).
    showVcr: !isConversionDim
      && (rows.some((row) => (row.coV || 0) > 0) || (ctx.soleLiId !== null && ctx.rateType === "CPV")),
    showConversions: !isConversionDim && rows.some((row) => (row.cv || 0) > 0),
    coverage: sd
      ? {
          line: coverageLineFor(dim, sourceResult, rows.length),
          window: coverageWindowFor(dim, sourceResult, rows.length),
          gap: rows.length ? discrepancyLabel(sourceResult) : null,
          stale: stalenessLabel(
            Object.prototype.hasOwnProperty.call(ctx.dimSources, sd.sourceId) ? ctx.dimSources[sd.sourceId] : null,
            ctx.asOf
          ),
        }
      : null,
    outside: outsideBucket && ctx.soleLiId
      ? {
          liId: ctx.soleLiId,
          units: outsideUnits,
          share: ctx.liTotalUnits > 0 ? (outsideUnits / ctx.liTotalUnits) * 100 : 0,
        }
      : null,
  };
}

/** What the pacing's buying unit is called in a sentence. Mirrors the engine's own `rateLabel`. */
export function unitLabel(unitKey: UnitKey): string {
  return unitKey === "cl" ? "clicks" : unitKey === "co" ? "views" : "impressions";
}

/** The default sort column for a tab: the conversions cut has no delivery columns to sort by. */
export function defaultSortCol(dim: string, unitKey: UnitKey): string {
  return dim === CONVERSION_DIM ? "cv" : unitKey;
}

export type { BreakdownRow, BreakdownTotals, DimBucket, UnitKey, LiPlanMap };
