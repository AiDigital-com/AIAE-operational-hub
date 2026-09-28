/**
 * Pure aggregation for the campaign-level Breakdown panel. Ported from the retired SPA's
 * `workspace/src/lib/dashboard/breakdown-aggregate.js` (the aggregate walks), `dim-coverage.js`
 * (`breakdownTotals` and the unmeasured-row rule it reads), and the row-enrichment / sort /
 * best-worst blocks that lived INSIDE `Breakdown.jsx`'s render memos (~lines 505..630 there) -
 * ported rather than called because none of this is exported from the vendored engine
 * (`DashboardMetrics.create()` returns the metric bag surface only; the SPA kept its breakdown
 * aggregation in app code next to the component), and the enrichment was React-embedded, so
 * moving it here is what makes it testable at all.
 *
 * Deliberate trims against the reference, all campaign-mode consequences:
 *   - the module-level memo layer (`dimTaggedDeliveryMemo`, `deliveryByDateMemo`,
 *     `mergeSplitAcrossLIsMemo`, `nested`, `remember`) is not ported - the Hub has no
 *     concurrent-render restart problem to paper over;
 *   - `deliveryByDate` takes the VCR-eligible SET rather than deriving it, so this module needs no
 *     engine handle for one predicate its callers have already computed;
 *   - `aggregateOutside` drops the reference's flight clip and `liEligible` for `aggregateDim`'s
 *     reason: the day rows it walks come out of `mergeSplitAcrossLIs`, which applied both;
 *   - `aggregateDim` drops the reference's `liPlan`/`liEligible` parameters - campaign mode already
 *     merged the per-LI flight clip and the gated `imV`/`coV` in `mergeSplitAcrossLIs`, so the day
 *     rows arriving here carry both inline;
 *   - `aggregateCreativeAsset`/`aggregateConversion` drop `liPlanForFlight` - campaign mode passes
 *     null there in the reference (`Breakdown.jsx`'s `liId ? liPlanMap : null`);
 *   - `aggregateCreativeAsset` drops the reference's `kByLi` net-ratio parameter - this repo's
 *     vendored engine has no net-ratio model.
 *
 * Division by zero yields 0 throughout - project canon, see pacing-core.js.
 */
import { getCurrency, getPacingCore } from "../engine/engine-loader";
import { FILTERABLE_DIMS } from "../filters/breakdown-filter";
import type { DateRange, FactRow, FlowRow, LiDaily, LiPlanMap } from "../engine/vendor-types";

export const UNCLASSIFIED_KEY = "__unclassified__";
export const OTHERS_KEY = "__others__";
const NO_VALUE_KEY = "__novalue__";
const NOT_COVERED_KEY = "__notcovered__";

/** Rows that describe leftover delivery rather than a value you could filter by. */
export const RESIDUAL_KEYS: ReadonlySet<string> = new Set([
  OTHERS_KEY,
  UNCLASSIFIED_KEY,
  NO_VALUE_KEY,
  NOT_COVERED_KEY,
]);

// Leftover rows that carry the primary unit and NOTHING else. 'Not covered' is delivery the source
// never saw; 'Others' is a remainder computed in one unit - its clicks, spend and completes are
// UNKNOWN, not zero. Unclassified / No value are aggregated from real facts and stay measured.
// Same set dim-coverage.js calls UNMEASURED_ROW_KEYS - it gates the totals rates below too.
const UNKNOWN_BEYOND_UNIT_KEYS: ReadonlySet<string> = new Set([NOT_COVERED_KEY, OTHERS_KEY]);

/** A daily delivery bucket plus the VCR-gated pair: `imV`/`coV` accrue only from VCR-eligible
 *  line items, so display impressions delivered to the same dim value don't dilute VCR.
 *  A type alias rather than an interface ON PURPOSE: an object type alias carries an implicit
 *  index signature, so a `Record<string, DimBucket>` stays assignable to the engine's
 *  `FlowRow`-keyed maps (an interface would not be). */
export type DimBucket = {
  im: number;
  cl: number;
  sp: number;
  co: number;
  cv: number;
  pc: number;
  pv: number;
  dc: number;
  imV: number;
  coV: number;
};

export interface BreakdownRow extends DimBucket {
  key: string;
  label: string;
  ctr: number;
  vcr: number;
  cvr: number;
  cpm: number;
  /** key ∈ RESIDUAL_KEYS - greyed, never clickable. */
  residual: boolean;
  /** Only the primary-unit cell is a measured figure; every other cell must print an em dash,
   *  and the row is excluded from the best/worst comparison. True for __others__ / __notcovered__. */
  unknownBeyondUnit: boolean;
}

export interface BreakdownTotals extends DimBucket {
  ctr: number;
  vcr: number;
  cvr: number;
  cpm: number;
}

export type UnitKey = "im" | "cl" | "co";

/** The engine's LSD shape: per-line-item, per-`<dim>:<value>`, per-day. */
export type LiSplitDaily = Record<string, Record<string, Record<string, FlowRow>>>;

/** The slice of a facts bundle the campaign merge reads. */
export interface BreakdownFactsInput {
  liSplitDaily?: LiSplitDaily | null;
  liDaily?: LiDaily | null;
}

function zeroBucket(): DimBucket {
  return { im: 0, cl: 0, sp: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0, imV: 0, coV: 0 };
}

/** The 8 ungated fields only - the gated pair is accrued by each caller under its own rule. */
function addRow(t: DimBucket, v: Partial<DimBucket> | FlowRow): void {
  t.im += Number(v.im) || 0;
  t.cl += Number(v.cl) || 0;
  t.sp += Number(v.sp) || 0;
  t.co += Number(v.co) || 0;
  t.cv += Number(v.cv) || 0;
  t.pc += Number(v.pc) || 0;
  t.pv += Number(v.pv) || 0;
  t.dc += Number(v.dc) || 0;
}

function hasOwn(o: object | null | undefined, k: string): boolean {
  return o != null && Object.prototype.hasOwnProperty.call(o, k);
}

/**
 * The split keys of the lines in view, as the bare `{ '<dim>:<value>': true }` map
 * `detectAvailDims` reads.
 *
 * Exists so the panel can answer "which dimensions does this pacing HAVE" from the UNFILTERED
 * aggregate. Which tabs exist is a property of the data; it must not move when a delivery filter
 * is applied. Reading it from the filtered aggregate is what made clicking a row remove the row's
 * own tab: the filter leaves that dimension with exactly one value, and the tab stops qualifying.
 */
export function splitKeysFor(
  liSplitDaily: LiSplitDaily | null | undefined,
  liIds: Iterable<string>
): Record<string, true> {
  const out: Record<string, true> = {};
  for (const id of liIds) {
    if (!hasOwn(liSplitDaily, id)) continue;
    for (const k of Object.keys(liSplitDaily![id])) out[k] = true;
  }
  return out;
}

/**
 * Impressions each dimension TAGS, and the total delivered, over the FULL flight of every line in
 * view. Feeds the single-value half of `detectAvailDims` below.
 *
 * Deliberately takes no date range: which tabs EXIST must not move when the period picker moves -
 * tabs that appeared and vanished were the original breakdown bug (2026-03-13). The flight clip
 * stays: out-of-flight days are excluded from every other number on the panel, and leaving them in
 * would make a dim that tags everything look partial.
 *
 * Impressions rather than the pacing's rate-native unit: the question is structural - did this
 * name position tag all the delivery or only part of it - and impressions are the one quantity
 * every delivered row carries.
 */
export function dimTaggedDelivery(
  liSplitDaily: LiSplitDaily | null | undefined,
  liDaily: LiDaily | null | undefined,
  liIds: Iterable<string>,
  liPlanMap: LiPlanMap | null
): { total: number; byDim: Map<string, number> } {
  const byDim = new Map<string, number>();
  let total = 0;

  for (const id of liIds) {
    const p = hasOwn(liPlanMap, id) ? liPlanMap![id] : null;
    const clipped = (d: string): boolean => !!(p && p.fs && p.fe && (d < p.fs || d > p.fe));

    if (hasOwn(liDaily, id)) {
      for (const [d, v] of Object.entries(liDaily![id])) {
        if (clipped(d)) continue;
        total += Number(v.im) || 0;
      }
    }

    if (!hasOwn(liSplitDaily, id)) continue;
    for (const [sk, dd] of Object.entries(liSplitDaily![id])) {
      const idx = sk.indexOf(":");
      if (idx < 0) continue;
      const val = sk.slice(idx + 1).trim();
      // Same placeholder rule as detectAvailDims: '-' is not a value, so it must not count toward
      // what the dimension tags. Otherwise a dim carrying one real value plus a '-' bucket would
      // add up to the whole line and read as "tags everything" - the exact case this lets through.
      if (!val || val === "-") continue;
      const dim = sk.slice(0, idx);
      // A fact carries at most one value per dim, so the buckets of one dim partition the tagged
      // delivery - summing them cannot double count.
      let sum = 0;
      for (const [d, v] of Object.entries(dd)) {
        if (clipped(d)) continue;
        sum += Number(v.im) || 0;
      }
      byDim.set(dim, (byDim.get(dim) || 0) + sum);
    }
  }

  return { total, byDim };
}

/**
 * Which dimensions earn a tab.
 *
 * Audience: ≥1 value. Every other dim: ≥2 values, OR exactly one that does NOT tag all the
 * delivery - a single value on part of it splits delivery in two (the value + the 'Others'
 * remainder the table already computes), which is a breakdown; a single value on ALL of it draws
 * a one-slice donut, which is not. That second case is `platform` and `tactic` on nearly every
 * pacing, and it is what the older "≥2 values" rule was right to refuse - while wrongly refusing
 * a namebuilder position that tags a quarter of a line.
 *
 * `coverage` is `dimTaggedDelivery`'s result. Omitting it keeps the older behaviour exactly - a
 * single value never earns a tab - so a call site without the aggregates cannot widen anything.
 * The rule is strictly additive: nothing available before can stop being available.
 */
export function detectAvailDims(
  splitData: Readonly<Record<string, unknown>>,
  coverage: { total: number; byDim: Map<string, number> } | null
): Set<string> {
  const avail = new Set<string>();
  const dimVals = new Map<string, Set<string>>();
  for (const d of FILTERABLE_DIMS) dimVals.set(d, new Set());

  for (const sk of Object.keys(splitData)) {
    const idx = sk.indexOf(":");
    if (idx < 0) continue;
    const dim = sk.slice(0, idx);
    const val = sk.slice(idx + 1).trim();
    // '-' is a delivered placeholder ("no value"), not a real dimension value - don't let it make
    // a dim look available (it folds into Unclassified in aggregateDim).
    if (!val || val === "-") continue;
    dimVals.get(dim)?.add(val);
  }

  // The one value tags some delivery, but not all of it.
  const total = Number(coverage?.total) || 0;
  const partial = (dim: string): boolean => {
    if (!(total > 0) || !coverage?.byDim) return false;
    const tagged = coverage.byDim.get(dim) || 0;
    return tagged > 0 && tagged < total;
  };

  for (const dim of FILTERABLE_DIMS) {
    const n = dimVals.get(dim)!.size;
    if (dim === "audience" ? n >= 1 : n >= 2 || (n === 1 && partial(dim))) avail.add(dim);
  }

  return avail;
}

/**
 * The campaign merge: every line item's LSD folded into one `<dim>:<value>` → date → bucket map,
 * under the per-LI flight clip and the shared range. The gated `imV`/`coV` are accrued HERE, from
 * the caller-resolved eligibility set, so the merged day rows carry them inline and `aggregateDim`
 * needs no per-LI knowledge.
 */
export function mergeSplitAcrossLIs(
  facts: BreakdownFactsInput | null | undefined,
  effLIs: readonly string[],
  liPlan: LiPlanMap,
  effRange: DateRange | null,
  eligible: ReadonlySet<string>
): { mergedSplit: Record<string, Record<string, DimBucket>>; totalIm: number; totals: { im: number; cl: number; co: number } } {
  if (!facts?.liSplitDaily || !effLIs?.length) {
    return { mergedSplit: {}, totalIm: 0, totals: { im: 0, cl: 0, co: 0 } };
  }

  const merged: Record<string, Record<string, DimBucket>> = {};
  // LI totals per unit type - the Breakdown "Others" remainder is computed in the campaign's
  // primary (rate-native) unit, so all three are carried.
  const totals = { im: 0, cl: 0, co: 0 };
  let tIm = 0;

  for (const id of effLIs) {
    const sd = facts.liSplitDaily[id];
    if (!sd) continue;
    const p = liPlan?.[id];
    const elig = eligible.has(id);

    for (const [sk, dd] of Object.entries(sd)) {
      if (!merged[sk]) merged[sk] = {};
      for (const [date, v] of Object.entries(dd)) {
        if (p && p.fs && p.fe && (date < p.fs || date > p.fe)) continue;
        if (effRange && (date < effRange.from || date > effRange.to)) continue;
        if (!merged[sk][date]) merged[sk][date] = zeroBucket();
        addRow(merged[sk][date], v);
        if (elig) {
          merged[sk][date].imV += Number(v.im) || 0;
          merged[sk][date].coV += Number(v.co) || 0;
        }
      }
    }

    // Total impressions across all LIs (kept: only LIs WITH split data count, matching the
    // original CampaignBreakdown behavior).
    const ld = facts.liDaily?.[id];
    if (ld) {
      for (const [date, v] of Object.entries(ld)) {
        if (p && p.fs && p.fe && (date < p.fs || date > p.fe)) continue;
        if (effRange && (date < effRange.from || date > effRange.to)) continue;
        tIm += Number(v.im) || 0;
        totals.im += Number(v.im) || 0;
        totals.cl += Number(v.cl) || 0;
        totals.co += Number(v.co) || 0;
      }
    }
  }

  return { mergedSplit: merged, totalIm: tIm, totals };
}

/**
 * One dimension's cut of the merged split: `<value>` → bucket, range-clipped. Empty and '-'
 * values fold into Unclassified. Day rows arrive from `mergeSplitAcrossLIs`, already
 * flight-clipped and carrying the gated pair inline (see the file docblock for the trimmed
 * per-LI parameters the reference had).
 */
export function aggregateDim(
  splitData: Readonly<Record<string, Record<string, Partial<DimBucket>>>>,
  dim: string,
  range: DateRange | null
): Record<string, DimBucket> {
  const dimMap: Record<string, DimBucket> = {};
  const prefix = dim + ":";
  for (const [sk, dd] of Object.entries(splitData)) {
    if (!sk.startsWith(prefix)) continue;
    const rawVal = sk.slice(prefix.length).trim();
    const key = !rawVal || rawVal === "-" ? UNCLASSIFIED_KEY : rawVal;
    if (!hasOwn(dimMap, key)) dimMap[key] = zeroBucket();

    for (const [d, v] of Object.entries(dd)) {
      if (range && (d < range.from || d > range.to)) continue;
      addRow(dimMap[key], v);
      dimMap[key].imV += Number(v.imV) || 0;
      dimMap[key].coV += Number(v.coV) || 0;
    }
  }
  return dimMap;
}

/**
 * The Creative Asset cut, from the DSP's own creative rows - which have been through neither the
 * currency rate nor the fact builders, so `dc` is converted here via the vendored Currency module.
 * (The reference also applied a per-LI net ratio after the rate - dropped: this repo's vendored
 * engine has no net-ratio model.)
 */
export function aggregateCreativeAsset(
  creatives: readonly FactRow[] | null | undefined,
  liIdSet: ReadonlySet<string>,
  range: DateRange | null,
  eligibleSet: ReadonlySet<string>,
  rate: number | null | undefined
): Record<string, DimBucket> {
  const byKey: Record<string, DimBucket> = {};
  if (!Array.isArray(creatives) || liIdSet.size === 0) return byKey;
  const Currency = getCurrency();
  for (const row of creatives) {
    const lid = String(row.line_item_id);
    if (!liIdSet.has(lid)) continue;
    const date = String(row.date ?? "");
    if (range && (date < range.from || date > range.to)) continue;

    // Key by the human-readable creative NAME - the dim-rendering pipeline uses Object.keys as
    // donut/table labels. Falling back to creative_id only when name is empty preserves Search /
    // DOOH rows the DSP exposes without a creative name. Trade-off: two DSP creatives with
    // literally the same `creative` string collapse into one bucket; that matches what an operator
    // visually expects ("show me totals by creative I see in the DSP UI").
    const name = row.creative != null ? String(row.creative).trim() : "";
    const key = name || (row.creative_id != null ? String(row.creative_id) : "") || UNCLASSIFIED_KEY;

    if (!hasOwn(byKey, key)) byKey[key] = zeroBucket();
    const r = byKey[key];
    r.im += Number(row.impressions) || 0;
    r.cl += Number(row.clicks) || 0;
    r.sp += Number(row.spend) || 0;
    r.co += Number(row.completes) || 0;
    r.cv += Number(row.conversions) || 0;
    r.pc += Number(row.post_click_conversions) || 0;
    r.pv += Number(row.post_view_conversions) || 0;
    r.dc += Currency.currencyToUsd(Number(row.dynamic_cost) || 0, rate);
    if (eligibleSet.has(lid)) {
      r.imV += Number(row.impressions) || 0;
      r.coV += Number(row.completes) || 0;
    }
  }
  return byKey;
}

/** The Conversion Action cut: the conversions mart carries no delivery, only the three
 *  conversion counters. */
export function aggregateConversion(
  conversions: readonly FactRow[] | null | undefined,
  liIdSet: ReadonlySet<string>,
  range: DateRange | null
): Record<string, DimBucket> {
  const byKey: Record<string, DimBucket> = {};
  if (!Array.isArray(conversions) || liIdSet.size === 0) return byKey;
  for (const row of conversions) {
    const lid = String(row.line_item_id);
    if (!liIdSet.has(lid)) continue;
    const date = String(row.date ?? "");
    if (range && (date < range.from || date > range.to)) continue;
    const action = row.conversion_action != null ? String(row.conversion_action).trim() : "";
    const key = action || UNCLASSIFIED_KEY;
    if (!hasOwn(byKey, key)) byKey[key] = zeroBucket();
    const r = byKey[key];
    r.cv += Number(row.conversions) || 0;
    r.pc += Number(row.post_click_conversions) || 0;
    r.pv += Number(row.post_view_conversions) || 0;
  }
  return byKey;
}

function labelFor(key: string): string {
  return key === UNCLASSIFIED_KEY
    ? "Unclassified"
    : key === OTHERS_KEY
      ? "Others"
      : key === NO_VALUE_KEY
        ? "No value"
        : key === NOT_COVERED_KEY
          ? "Not covered"
          : key;
}

/**
 * dimMap -> display rows: labels, the four rates, the `__others__` remainder, residual flags.
 * `liTotalUnits` is campaign delivery in `unitKey`; `withOthers` is false for the conversion and
 * creative cuts (their totals do not sum to a delivery total). Colour is NOT assigned here - the
 * renderer owns paint.
 *
 * An Unclassified-only map returns no rows: a breakdown whose single bucket is "no value" is not
 * a breakdown, and suppressing it here also suppresses the Others remainder it would trigger.
 */
export function enrichRows(
  dimMap: Readonly<Record<string, DimBucket>>,
  opts: { unitKey: UnitKey; liTotalUnits: number; withOthers: boolean }
): BreakdownRow[] {
  const keys = Object.keys(dimMap);
  if (keys.length === 0) return [];
  if (keys.length === 1 && keys[0] === UNCLASSIFIED_KEY) return [];

  const rows: BreakdownRow[] = keys.map((key) => {
    const a = dimMap[key];
    return {
      ...a,
      key,
      label: labelFor(key),
      ctr: a.im > 0 ? (a.cl / a.im) * 100 : 0,
      vcr: a.imV > 0 ? (a.coV / a.imV) * 100 : 0,
      cvr: a.cl > 0 ? (a.cv / a.cl) * 100 : 0,
      cpm: a.im > 0 ? (a.sp / a.im) * 1000 : 0,
      residual: RESIDUAL_KEYS.has(key),
      unknownBeyondUnit: UNKNOWN_BEYOND_UNIT_KEYS.has(key),
    };
  });

  // The "Others" remainder row: campaign total minus the sum of all dimension rows, in the
  // PRIMARY (rate-native) unit. Below 1% it is noise, not a slice.
  if (opts.withOthers) {
    const sumDimUnits = rows.reduce((s, r) => s + (r[opts.unitKey] || 0), 0);
    const othersUnits = opts.liTotalUnits - sumDimUnits;
    if (othersUnits > 0 && opts.liTotalUnits > 0 && othersUnits / opts.liTotalUnits >= 0.01) {
      const others: BreakdownRow = {
        ...zeroBucket(),
        key: OTHERS_KEY,
        label: "Others",
        ctr: 0,
        vcr: 0,
        cvr: 0,
        cpm: 0,
        residual: true,
        unknownBeyondUnit: true,
      };
      others[opts.unitKey] = othersUnits;
      rows.push(others);
    }
  }

  return rows;
}

// Real values first, then the leftovers, and 'Not covered' last of all - it is the furthest from
// being a value, since the source never saw it.
function residualRank(key: string): number {
  return key === NOT_COVERED_KEY ? 3 : key === OTHERS_KEY ? 2 : key === UNCLASSIFIED_KEY || key === NO_VALUE_KEY ? 1 : 0;
}

/**
 * Residual rows always sink below real values, `__notcovered__` last of all; within a rank, by the
 * chosen column. `sortCol` is a BreakdownRow numeric key or "label". Returns a NEW array.
 */
export function sortRows(rows: readonly BreakdownRow[], sortCol: string, sortDir: "asc" | "desc"): BreakdownRow[] {
  const sd = sortDir === "asc" ? 1 : -1;
  const valueOf = (r: BreakdownRow): string | number => {
    if (sortCol === "label") return r.label.toLowerCase();
    const v = r[sortCol as keyof BreakdownRow];
    return typeof v === "number" ? v : 0;
  };
  return [...rows].sort((a, b) => {
    const ra = residualRank(a.key);
    const rb = residualRank(b.key);
    if (ra !== rb) return ra - rb;
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av < bv) return -sd;
    if (av > bv) return sd;
    return 0;
  });
}

/**
 * The Total line. Volumes are the full sum so the columns still tie to the pacing's own delivery;
 * the rates divide by the part that was actually measured, because an `__others__` or
 * `__notcovered__` row can contribute its unit but never the clicks that go with it - a synthetic
 * denominator would dilute every rate.
 */
export function breakdownTotals(rows: readonly BreakdownRow[]): BreakdownTotals {
  const t: BreakdownTotals = { ...zeroBucket(), ctr: 0, vcr: 0, cvr: 0, cpm: 0 };
  const seen = { im: 0, cl: 0, cv: 0, sp: 0, imV: 0, coV: 0 };
  for (const r of rows) {
    addRow(t, r);
    t.imV += r.imV || 0;
    t.coV += r.coV || 0;
    if (UNKNOWN_BEYOND_UNIT_KEYS.has(r.key)) continue;
    seen.im += r.im || 0;
    seen.cl += r.cl || 0;
    seen.cv += r.cv || 0;
    seen.sp += r.sp || 0;
    seen.imV += r.imV || 0;
    seen.coV += r.coV || 0;
  }
  t.ctr = seen.im > 0 ? (seen.cl / seen.im) * 100 : 0;
  t.vcr = seen.imV > 0 ? (seen.coV / seen.imV) * 100 : 0;
  t.cvr = seen.cl > 0 ? (seen.cv / seen.cl) * 100 : 0;
  t.cpm = seen.im > 0 ? (seen.sp / seen.im) * 1000 : 0;
  return t;
}

/**
 * Best/worst CTR and VCR by VALUE (robust under sort/slice), or null when there is one row or the
 * relative spread is ≤10%. Rows whose rates are unknown rather than measured are not data points -
 * a synthetic 0.00% CTR wins "worst" every time and paints a flag on a row with no CTR to judge.
 */
export function rateExtremes(
  rows: readonly BreakdownRow[]
): { bestCtr: number | null; worstCtr: number | null; bestVcr: number | null; worstVcr: number | null } {
  const scored = rows.filter((r) => !r.unknownBeyondUnit);
  if (scored.length <= 1) return { bestCtr: null, worstCtr: null, bestVcr: null, worstVcr: null };
  const ctrs = scored.map((r) => r.ctr);
  const vcrs = scored.map((r) => r.vcr);
  const maxC = Math.max(...ctrs);
  const minC = Math.min(...ctrs);
  const maxV = Math.max(...vcrs);
  const minV = Math.min(...vcrs);
  const ctrSpread = maxC > 0 && (maxC - minC) / maxC > 0.1;
  const vcrSpread = maxV > 0 && (maxV - minV) / maxV > 0.1;
  return {
    bestCtr: ctrSpread ? maxC : null,
    worstCtr: ctrSpread ? minC : null,
    bestVcr: vcrSpread ? maxV : null,
    worstVcr: vcrSpread ? minV : null,
  };
}

/**
 * Delivery per day in one unit, for the line items in view - the quantity a dimension source is
 * compared AGAINST.
 *
 * Read from the same `liDaily` the panel's own Total row is built from, under the same flight clamp
 * and the same range. A second calculation of delivery would let the two drift, and "Not covered"
 * would then be measuring the difference between two of our own sums instead of a real gap in the
 * source.
 *
 * `srcUnitKey` is `coV` when the visible completes column is the gated one. An INELIGIBLE line
 * still marks its delivered days - the key is created with a zero - so the shared window stays the
 * one every other unit sees; the line simply contributes nothing to the quantity being compared.
 */
export function deliveryByDate(
  liDaily: LiDaily | null | undefined,
  liIds: Iterable<string>,
  liPlanMap: LiPlanMap | null | undefined,
  range: DateRange | null,
  unitKey: UnitKey,
  srcUnitKey: string,
  eligible: ReadonlySet<string>
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!liDaily) return out;
  const gated = srcUnitKey === "coV";
  for (const raw of liIds) {
    const id = String(raw);
    if (!hasOwn(liDaily, id)) continue;
    const plan = hasOwn(liPlanMap, id) ? liPlanMap![id] : null;
    const counts = !gated || eligible.has(id);
    for (const [date, v] of Object.entries(liDaily[id])) {
      if (plan?.fs && plan?.fe && (date < plan.fs || date > plan.fe)) continue;
      if (range && (date < range.from || date > range.to)) continue;
      const amount = gated ? (counts ? v.co || 0 : 0) : v[unitKey] || 0;
      out[date] = (out[date] || 0) + amount;
    }
  }
  return out;
}

/**
 * Delivery this line item ran OUTSIDE its own dim splits, on one dimension.
 *
 * Walks the same per-value daily aggregate `aggregateDim` does, but decides per DAY: the declared
 * set follows the containers covering that date, so a value declared for July and absent in August
 * is outside in August only.
 *
 * Returns null when the line item has no covering container - there is nothing to be outside of,
 * and the caller must not render the row at all. Untagged delivery is never outside: a blank value
 * is not a value the containers failed to declare.
 *
 * `plan` is read only for its container scope index; the flight clip and the gated pair were
 * applied upstream by `mergeSplitAcrossLIs`.
 */
export function aggregateOutside(
  splitData: Readonly<Record<string, Record<string, Partial<DimBucket>>>>,
  plan: LiPlanMap[string] | null | undefined,
  dim: string,
  range: DateRange | null
): DimBucket | null {
  if (!plan) return null;
  const PacingCore = getPacingCore();
  const idx = PacingCore.buildDimScopeIndex(plan) as { any?: boolean } | null;
  if (!idx?.any) return null;

  const bucket = zeroBucket();
  const prefix = dim + ":";
  const probe: Record<string, unknown> = { date: "", [dim]: "" };
  let hit = false;

  for (const [sk, dd] of Object.entries(splitData)) {
    if (!sk.startsWith(prefix)) continue;
    const rawVal = sk.slice(prefix.length).trim();
    if (!rawVal || rawVal === "-") continue;
    probe[dim] = rawVal;
    for (const [date, v] of Object.entries(dd)) {
      if (range && (date < range.from || date > range.to)) continue;
      probe.date = date;
      if (!PacingCore.factOutsideSplits(idx, dim, probe)) continue;
      addRow(bucket, v);
      bucket.imV += v.imV ?? 0;
      bucket.coV += v.coV ?? 0;
      hit = true;
    }
  }
  return hit ? bucket : null;
}
