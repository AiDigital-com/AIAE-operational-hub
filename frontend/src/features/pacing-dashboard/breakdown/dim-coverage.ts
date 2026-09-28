/**
 * Coverage arithmetic and panel decisions for dimension sources. Ported from the retired SPA's
 * `workspace/src/lib/dashboard/dim-coverage.js`, whole, EXCEPT `breakdownTotals` and the
 * `UNMEASURED_ROW_KEYS` rule it reads - those were already ported into `./breakdown-aggregate.ts`
 * (as `breakdownTotals` and `UNKNOWN_BEYOND_UNIT_KEYS`) and are not duplicated here.
 *
 * Splits delivery into three parts that always add up:
 *
 *   named       the source reported a value  ->  one bucket per label
 *   noValue     the source has the row but no value for this dimension
 *   notCovered  the source never saw this delivery at all
 *
 * Both unknowns are real and different: "the DSP does not report devices" is not the same problem
 * as "the DSP reports the row but leaves the field blank", and a single leftover figure hides
 * which one you have. Measured 2026-08-09: for devices the second is tiny, for demographics it was
 * 43% of the source's own rows - which is why the split exists at all.
 *
 * Everything is computed over the dates BOTH sides cover. A source that lags a day would otherwise
 * report the lag as missing data, which is a fact about clocks, not about delivery (spec §5.1).
 *
 * Spec: Pacing's docs/superpowers/specs/2026-08-09-dimension-sources-design.md §5.2
 */
import type { DateRange } from "../engine/vendor-types";
import type { DimBucket, UnitKey } from "./breakdown-aggregate";
import { groupValue } from "./dim-groups";

const METRICS = ["im", "cl", "sp", "co", "cv", "pc", "pv", "dc"] as const;

/** The metric a coverage ratio can be anchored on: any raw column, or the gated `imV`/`coV` pair. */
export type DimSourceAnchor = keyof DimBucket;

/**
 * One wave-1 dimension-source row, as merge.mjs serves it inside `dimSources[id].rows`. `dims` is
 * keyed by sheet-named columns and `metrics` values come off the wire untyped, so both stay
 * unknown-valued at the edge and every read below coerces.
 */
export interface DimSourceRow {
  date: string;
  line_item_id: string | number;
  dims?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
}

/**
 * The envelope merge.mjs attaches to each `dimSources` entry - only the fields the labels and
 * gates below read. Everything arrives off the wire, so every field is unknown and runtime-checked.
 */
export interface DimSourceEntry {
  /** The source's own rows. Typed here rather than left unknown because every caller that holds an
   *  entry is on its way to `aggregateDimSource`, and the two would otherwise disagree about the
   *  one field they both exist for. */
  rows?: readonly (DimSourceRow | null | undefined)[] | null;
  fetched_at?: unknown;
  coverage_hint?: unknown;
  status?: unknown;
  error?: unknown;
  behind?: unknown;
  breakdowns?: unknown;
}

/** The subset of one configured `data.dim_sources[]` entry this module reads. The list is opaque
 *  on the Hub's contract, so the deeper fields (`origin`, `title`) stay unknown and are narrowed
 *  where read. */
export interface ConfiguredDimSource {
  id?: string;
  loader?: string;
  title?: unknown;
  origin?: unknown;
  groups?: unknown;
}

// Deliberately local rather than a shared formatter: this module is the panel's pure decision
// layer, and the reference kept its own copy so a plain test runner could execute every decision
// in it without dragging in the app's formatting/engine imports. Same trade here - format.ts has
// no 'Aug 1' shape anyway.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(ymd: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd == null ? "" : ymd));
  const month = m && MONTHS[Number(m[2]) - 1];
  return m && month ? `${month} ${Number(m[3])}` : null;
}

function zero(): DimBucket {
  return { im: 0, cl: 0, sp: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0, imV: 0, coV: 0 };
}

// The video-completion pair is GATED, not summed: only a line item whose plan
// makes completes meaningful contributes to it. Without the pair a
// completes-bought pacing shows "Compl. 0 · VCR 0.00%" on every device while its
// other breakdowns show the real figures - the column reads as a measurement of
// zero rather than as a missing basis.
function add(
  bucket: DimBucket,
  metrics: Record<string, unknown> | null | undefined,
  vcrEligible: boolean
): void {
  for (const m of METRICS) bucket[m] += Number(metrics && metrics[m]) || 0;
  if (!vcrEligible) return;
  bucket.imV += Number(metrics && metrics.im) || 0;
  bucket.coV += Number(metrics && metrics.co) || 0;
}

// How much of the anchor one row carries. The gated pair is NOT a column in the
// file: `coV` is raw completes from the lines whose plan makes completes count,
// so a row on a display line contributes nothing to it. Anchoring there is what
// keeps the leftover in the unit the table actually prints - on a
// completes-bought pacing the visible column is the gated one, and measuring the
// remainder in raw completes leaves it with no column to land in.
function anchorAmount(
  metrics: Record<string, unknown> | null | undefined,
  anchor: DimSourceAnchor,
  vcrEligible: boolean
): number {
  if (anchor === "coV") return vcrEligible ? Number(metrics && metrics.co) || 0 : 0;
  if (anchor === "imV") return vcrEligible ? Number(metrics && metrics.im) || 0 : 0;
  return Number(metrics && metrics[anchor]) || 0;
}

/**
 * The unit a dimension source measures in, given the pacing's own buying unit.
 *
 * Completes are the one unit whose column is gated: the table prints `Compl.`, which counts only
 * the lines whose plan makes completes meaningful, and there is no raw-completes column at all.
 * Measuring the source in raw completes there leaves both leftover rows with nowhere to print -
 * every cell reads '—' and the quantity survives only as a percentage beside the label.
 *
 * `hasGatedBasis` - whether ANY line item in view contributes to that pair. Without one (a
 * completes-bought pacing whose lines are all audio, where eligibility is refused by channel) the
 * gated columns are zero throughout, and anchoring on them would empty the tab instead of fixing a
 * column. Raw completes are the honest fallback there.
 */
export function dimSourceUnitKey(unitKey: UnitKey, hasGatedBasis: boolean): UnitKey | "coV" {
  return unitKey === "co" && hasGatedBasis ? "coV" : unitKey;
}

// Read the dimension as an own key. A source may name a dimension after a
// built-in, and a plain read answers with a function for a row that carries no
// such dimension at all - which then becomes a bucket label.
function readDim(row: DimSourceRow, dimKey: string): unknown {
  return row.dims && Object.prototype.hasOwnProperty.call(row.dims, dimKey)
    ? row.dims[dimKey]
    : "";
}

// Nothing at all, or only spaces. Both belong in the no-value bucket: a slice
// whose label cannot be seen is worse than no slice. The cardinality counter
// below and the split above must agree on this, or the picker offers a dimension
// whose values never appear.
function isBlank(raw: unknown): boolean {
  return String(raw == null ? "" : raw).trim() === "";
}

/** `aggregateDimSource`'s knobs - each field's note is the reference's own contract. */
export interface AggregateDimSourceOptions {
  /** Which dimension inside `dims` to read. */
  dimKey?: string;
  /** The line item ids in view, held as STRINGS. The row side is coerced, the set is used as it
   *  comes, so a set of numbers matches nothing and everything reads as not covered. */
  liIdSet?: ReadonlySet<string> | null;
  /** Metric the ratios are measured on, default 'im'. 'coV' and 'imV' are the GATED pair - not
   *  columns in the file, but raw completes/impressions from the eligible lines only, which is
   *  what the table prints on a CPV pacing. */
  anchor?: DimSourceAnchor;
  /** false = measure over the selected range instead of the days both sides cover (the widget
   *  surface - see the window step inside `aggregateDimSource`). */
  intersectWindow?: boolean;
  /** `{ 'YYYY-MM-DD': number }` - the anchor metric per day, for the same line items, from the
   *  dashboard's own facts. */
  deliveryByDate?: Record<string, number> | null;
  /** Optional window the user picked. */
  range?: DateRange | null;
  /** Optional `{ [li]: { fs, fe } }` to clamp a row to its flight. */
  liPlanForFlight?: Record<string, { fs?: string | null; fe?: string | null } | null> | null;
  /** Line item ids whose completes count toward a video rate - the same set the panel already
   *  builds for its other dimensions. Passing it is what keeps a display line's impressions out
   *  of a video line's rate when both land in one device bucket. */
  vcrEligibleIds?: ReadonlySet<string> | null;
  /** This source's stored grouping dictionary for this dimension, passed through to groupValue. */
  groups?: unknown;
}

/** What `aggregateDimSource` answers with. `named + noValue + notCovered` adds up to the
 *  delivery measured over the `[from, to]` window. */
export interface DimSourceAggregate {
  /** One bucket per resolved label. `deviceBucketMap` extends this object in place - see there. */
  buckets: Record<string, DimBucket>;
  /** Anchor units the source reported a value for. */
  named: number;
  /** Anchor units the source saw but could not name (blank, or a dropped value). */
  noValue: number;
  /** The full metrics behind `noValue` - real clicks and spend that simply carry no value. */
  noValueMetrics: DimBucket;
  /** Anchor units of delivery the source never saw. */
  notCovered: number;
  /** (named + noValue) / delivery, 0 when there is no delivery. */
  coverage: number;
  /** named / delivery, 0 when there is no delivery. */
  valued: number;
  /** |delivery - source| as a percentage of delivery - see the note at the computation. */
  discrepancy: number;
  from: string | null;
  to: string | null;
}

/** The three-way split: named / noValue / notCovered over the shared window. See the file
 *  docblock for why the parts must always add up. */
export function aggregateDimSource(
  rows: readonly (DimSourceRow | null | undefined)[] | null | undefined,
  opts?: AggregateDimSourceOptions | null
): DimSourceAggregate {
  const o = opts ?? {};
  const dimKey = o.dimKey ?? "";
  const anchor: DimSourceAnchor = o.anchor || "im";
  const liIdSet = o.liIdSet;
  const delivery = o.deliveryByDate ?? {};
  const list = Array.isArray(rows) ? rows : [];

  // Which rows count at all. Both passes below ask this one function: written
  // out twice, the two copies drift, and a test can only catch the drift in
  // whichever copy it happens to reach.
  const keep = (r: DimSourceRow | null | undefined): r is DimSourceRow => {
    if (!r) return false;
    const lid = String(r.line_item_id);
    if (liIdSet && !liIdSet.has(lid)) return false;
    if (o.liPlanForFlight && Object.prototype.hasOwnProperty.call(o.liPlanForFlight, lid)) {
      const p = o.liPlanForFlight[lid];
      if (p && p.fs && p.fe && (r.date < p.fs || r.date > p.fe)) return false;
    }
    return true;
  };

  // 1. Which days does the source cover, for the line items in view?
  const srcDates = new Set<string>();
  for (const r of list) if (keep(r)) srcDates.add(r.date);

  // 2. The window. By default it is where both sides have data, narrowed by the
  // user's range: a source that lags a day behind delivery would otherwise report
  // the lag as missing data.
  //
  // `intersectWindow: false` asks the other question, and the widget surface needs
  // it. A widget shows every source row in the selected period, lag included, so
  // its coverage has to be measured over that same period - the shared-days figure
  // would describe a total the tile is not printing.
  const deliveryDates = Object.keys(delivery);
  const wholeRange = o.intersectWindow === false;
  let from: string | null = null;
  let to: string | null = null;
  if (wholeRange) {
    from = o.range ? o.range.from : null;
    to = o.range ? o.range.to : null;
  } else {
    for (const d of srcDates) {
      if (!Object.prototype.hasOwnProperty.call(delivery, d)) continue;
      if (from === null || d < from) from = d;
      if (to === null || d > to) to = d;
    }
    // A range narrows and never widens. With no day in common there is nothing to
    // compare, and a range must not open a window over days the source was never
    // asked about - otherwise the same data answers differently depending on
    // whether the user happens to have picked a range.
    if (o.range && from !== null && to !== null) {
      if (o.range.from > from) from = o.range.from;
      if (o.range.to < to) to = o.range.to;
    }
  }
  const inWindow = wholeRange
    ? (d: string): boolean => (from === null || d >= from) && (to === null || d <= to)
    : (d: string): boolean => from !== null && to !== null && d >= from && d <= to;

  // 3. Walk the source rows once.
  const buckets: Record<string, DimBucket> = {};
  let named = 0;
  let noValue = 0;
  // The no-value rows are real rows: the source reported clicks and spend for
  // them, it just could not say which device they belong to. Keeping only the
  // anchor would print "$0.00 spend" next to the named buckets' real spend,
  // which reads as "none" rather than "unattributed".
  const noValueMetrics = zero();
  for (const r of list) {
    if (!keep(r) || !inWindow(r.date)) continue;

    const raw = readDim(r, dimKey);
    const g = groupValue(dimKey, raw, o.groups);
    const vcrElig = !!(o.vcrEligibleIds && o.vcrEligibleIds.has(String(r.line_item_id)));
    const amount = anchorAmount(r.metrics, anchor, vcrElig);

    // Delivery the source saw but could not name: blank, or a value the table
    // drops. It is NOT deleted - that would break the addition.
    if (g.drop || isBlank(raw)) {
      noValue += amount;
      add(noValueMetrics, r.metrics, vcrElig);
      continue;
    }

    // defineProperty rather than plain assignment. For the single label
    // '__proto__' an assignment runs the inherited setter instead of making a
    // key: the bucket never appears, while its delivery still counts as named.
    if (!Object.prototype.hasOwnProperty.call(buckets, g.label)) {
      Object.defineProperty(buckets, g.label, {
        value: zero(),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    add(buckets[g.label], r.metrics, vcrElig);
    named += amount;
  }

  // 4. Delivery over the same window, and the leftover.
  let deliveryTotal = 0;
  for (const d of deliveryDates) {
    if (inWindow(d)) deliveryTotal += Number(delivery[d]) || 0;
  }
  const srcTotal = named + noValue;
  const notCovered = Math.max(0, deliveryTotal - srcTotal);
  const coverage = deliveryTotal > 0 ? srcTotal / deliveryTotal : 0;
  const valued = deliveryTotal > 0 ? named / deliveryTotal : 0;
  // Measured on the totals, not on `1 - coverage`: subtracting a ratio from 1
  // loses precision in a number the UI puts on screen - |1 - 1.3| * 100 comes out
  // as 30.000000000000004. With no delivery there is nothing to disagree with,
  // unless the source itself reported something, which is a real disagreement and
  // must not read as a quiet zero.
  const discrepancy =
    deliveryTotal > 0
      ? (Math.abs(deliveryTotal - srcTotal) * 100) / deliveryTotal
      : srcTotal > 0
        ? 100
        : 0;

  return {
    buckets,
    named,
    noValue,
    noValueMetrics,
    notCovered,
    coverage,
    valued,
    discrepancy,
    from,
    to,
  };
}

// ---------------------------------------------------------------------------
// What the Breakdown panel needs to decide before it renders
// ---------------------------------------------------------------------------

// Above this many distinct values a donut is one sliver per value and answers
// nothing. Those dimensions belong in a widget, which can sort and take a top N.
// Exported since 2026-08-18: the mapping screen decides "Breakdown or a table of
// its own" by the same threshold, and used to re-type the bare 50.
export const CARDINALITY_LIMIT = 50;

function eligibleRows(
  rows: readonly (DimSourceRow | null | undefined)[] | null | undefined,
  liIdSet?: ReadonlySet<string> | null
): DimSourceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is DimSourceRow => !!r && (!liIdSet || liIdSet.has(String(r.line_item_id)))
  );
}

/**
 * How many distinct labels the dimension has AFTER grouping.
 *
 * `groups` is this SOURCE's dictionary for this dimension - the count has to be taken through the
 * same lookup the rows are, or the cardinality gate answers about the ungrouped vocabulary and
 * hides a tab that would have been readable.
 */
export function dimSourceCardinality(
  rows: readonly (DimSourceRow | null | undefined)[] | null | undefined,
  dimKey: string,
  liIdSet?: ReadonlySet<string> | null,
  groups?: unknown
): number {
  const seen = new Set<string>();
  for (const r of eligibleRows(rows, liIdSet)) {
    const raw = readDim(r, dimKey);
    if (isBlank(raw)) continue;
    const g = groupValue(dimKey, raw, groups);
    if (!g.drop) seen.add(g.label);
  }
  return seen.size;
}

/**
 * Offer the dimension only when the source has rows for a line item in view and the value count is
 * small enough to read.
 */
export function dimSourceAvailable(
  rows: readonly (DimSourceRow | null | undefined)[] | null | undefined,
  liIdSet?: ReadonlySet<string> | null,
  dimKey?: string | null,
  groups?: unknown
): boolean {
  const eligible = eligibleRows(rows, liIdSet);
  if (eligible.length === 0) return false;
  if (!dimKey) return true;
  // Already filtered - counting again with the same set would just repeat it.
  return dimSourceCardinality(eligible, dimKey, null, groups) <= CARDINALITY_LIMIT;
}

/**
 * The line under the tabs. Both ratios answer different questions - how much delivery the source
 * knows about, and how much of it can actually be broken down - so both are stated whenever they
 * differ.
 */
export function coverageSublabel(r: DimSourceAggregate | null | undefined): string {
  if (!r) return "no matching delivery";
  // Zero coverage has THREE causes, and the split is on the DELIVERY side.
  //
  // `named` and `noValue` are counted in the anchor, and the anchor is the
  // pacing's buying unit - completes on a CPV line, clicks on CPC, not
  // impressions. So a device source carrying impressions and clicks but no
  // completes leaves both at 0 while delivery is real and entirely uncovered.
  // Splitting on the source side alone printed "no matching delivery" above a
  // table listing 40,000 impressions - the same contradiction this wording was
  // written to prevent, arriving from the other side.
  //
  // `notCovered > 0` means there WAS delivery to cover, so neither sentence
  // below is true and the honest line is the ordinary `covers 0%` form, which
  // the formatting under here already produces.
  if (!(r.coverage > 0) && !(r.notCovered > 0)) {
    // Nothing to divide by. Either the source reported rows on days the pacing
    // recorded no delivery, or neither side has anything at all.
    return (r.named || 0) + (r.noValue || 0) > 0
      ? "no delivery recorded on these days"
      : "no matching delivery";
  }
  const cov = Math.round(r.coverage * 100);
  const val = Math.round(r.valued * 100);
  // Only an exact 100 with nothing left over is "all". Above it the two sides
  // disagree, and rounding that up to "all delivery" would hide the very case
  // the discrepancy exists for - a source claiming more delivery than the pacing
  // has. Below it, 99.9% rounds to 100 while a "Not covered" row sits directly
  // under this line, so the leftover itself decides, not the rounded figure.
  if (cov === 100 && val === 100 && !(r.notCovered > 0)) return "covers all delivery";
  // For devices the no-value share is tiny, so the two almost always round
  // alike. Saying the same number twice reads like a bug.
  if (cov === val) return `covers ${cov}% of delivery`;
  return `covers ${cov}% of delivery · ${val}% shown by value`;
}

/**
 * The disagreement figure wave-1 spec §5.3 asks for - but ONLY where the coverage line does not
 * already say it.
 *
 * A source that covers 35% of delivery is 65% off it: the same number from the other side, and
 * printing both reads as two facts where there is one. The coverage line already IS the permanent
 * label §5.3 wanted.
 *
 * What it does not say is the overflow case. "covers 130% of delivery" can be read as "covered
 * everything and then some", which is the failure this figure exists to prevent - the two sides
 * disagree, and the excess is not coverage. A sheet source makes that ordinary rather than
 * theoretical: its rows are typed by another system with its own attribution.
 *
 * Below half a point it says nothing: a rounding difference is not a disagreement, and a permanent
 * "0.1% over" trains the reader to ignore the line that matters at 30%.
 */
export function discrepancyLabel(result: DimSourceAggregate | null | undefined): string | null {
  if (!result || !(result.coverage > 1)) return null;
  const over = (result.coverage - 1) * 100;
  if (!(over > 0.5)) return null;
  const pct = over >= 10 ? Math.round(over) : Math.round(over * 10) / 10;
  return `${pct}% more than the pacing delivered`;
}

/**
 * Whether what is on screen is the data the loader last READ, or the data it last managed to read.
 * The distinction only exists for a sheet source: a failed read carries its previous rows forward
 * under the current refresh id, so the file is present and complete and nothing else says the
 * numbers are old.
 *
 * `entry` is the envelope merge.mjs passes through - status/error/fetched_at.
 */
export function stalenessLabel(
  entry: DimSourceEntry | null | undefined,
  today?: string | null
): string | null {
  if (!entry) return null;
  const when = typeof entry.fetched_at === "string" ? entry.fetched_at.slice(0, 10) : null;
  const parts: string[] = [];

  // BEHIND - the rows are fine and the mapping is current, but they were read
  // against an EARLIER refresh of this pacing, so the delivery they sit beside
  // has moved on since. Serving it is right, and saying WHICH DATES disagree is
  // the point - the refresh ids mean nothing to a reader, the dates are what
  // they are comparing.
  if (entry.behind) {
    const src = shortDate(entry.coverage_hint) || (when ? shortDate(when) : null);
    const dash = shortDate(today);
    // Three shapes, because both dates are optional in the wild - an old-format
    // main file carries no asOf at all, and the one production pacing is exactly
    // that. Losing the source's own date because the OTHER one is missing would
    // throw away the more useful half.
    parts.push(
      src && dash
        ? `these rows are from an earlier refresh; the breakdown has data to ${src}, the dashboard to ${dash}`
        : src
          ? `these rows are from an earlier refresh; the breakdown has data to ${src}`
          : "these rows are from an earlier refresh than the delivery beside them"
    );
  }

  if (entry.status === "stale") {
    const reason = entry.error ? String(entry.error).split(":")[0] : null;
    const age = when && today ? daysBetweenIso(when, today) : null;
    const howOld =
      age === null
        ? "an earlier read"
        : age <= 0
          ? "today"
          : age === 1
            ? "yesterday"
            : `${age} days ago`;
    parts.push(
      reason ? `last read failed (${reason}), showing data from ${howOld}` : `showing data from ${howOld}`
    );
  }

  return parts.length ? parts.join(" · ") : null;
}

function daysBetweenIso(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Which per-row field carries the primary quantity on a given tab: the donut's size axis, the
 * percentage beside each label, and the one cell a leftover row is allowed to fill instead of
 * dashing.
 *
 * Only a dimension source can differ from the pacing's own buying unit, and only for completes -
 * every other dimension partitions delivery in the unit the pacing buys. Kept beside
 * dimSourceUnitKey so the tab and the leftover row cannot end up disagreeing about which column
 * the quantity lives in: they did, and the whole row printed dashes.
 */
export function rowUnitKeyFor(
  dimKey: string,
  unitKey: UnitKey,
  hasGatedBasis: boolean
): UnitKey | "coV" {
  return isDimSourceDim(dimKey) ? dimSourceUnitKey(unitKey, hasGatedBasis) : unitKey;
}

/**
 * The days the coverage figure was measured over, as a human date range.
 *
 * The tab clips to the days both sides have, so on a lagging source its Total is genuinely smaller
 * than every other tab's for the same line item. Naming the window is what tells that apart from
 * missing delivery - without it the two surfaces disagree and nothing on screen says why.
 */
export function coverageWindowLabel(result: DimSourceAggregate | null | undefined): string | null {
  if (!result) return null;
  const from = shortDate(result.from);
  const to = shortDate(result.to);
  if (!from || !to) return null;
  return from === to ? `measured ${from}` : `measured ${from} – ${to}`;
}

// ---------------------------------------------------------------------------
// The panel's decisions, out here where they can be driven directly
// ---------------------------------------------------------------------------

/** The dimension a loaded device source contributes. */
export const DEVICE_DIM = "device_type";

// Same spellings as breakdown-aggregate.ts's NO_VALUE_KEY / NOT_COVERED_KEY (both members of its
// exported RESIDUAL_KEYS) - deviceBucketMap's output flows into the same enrichRows/sortRows/
// breakdownTotals pipeline, and a misspelt key here would turn a leftover row into a "real" value.
const NO_VALUE_KEY = "__novalue__";
const NOT_COVERED_KEY = "__notcovered__";

/**
 * Whether the rows on disk may be READ for one breakdown.
 *
 * merge.mjs attaches `breakdowns: { <dimKey>: 'ready'|'stale'|'broken'|'not_read' }` to every
 * sheet source, by comparing the fingerprint of the mapping that produced the file against what
 * the stored mapping computes to now (spec §6.2).
 *
 * `ready` and `stale` are both servable - stale means the last read failed and the previous rows
 * under the SAME mapping are being shown, which is data, just old. `not_read` and `broken` are
 * not: the rows describe a different question, or the column is gone from the sheet.
 *
 * A source with NO map is unrestricted. That is the catalogued `devices` case - it has no
 * per-pacing mapping to drift from - and it is also every response from a dash-gate that predates
 * this, so an older server degrades to today's behaviour rather than to an empty dashboard.
 */
export function breakdownState(
  loaded: Record<string, DimSourceEntry | null | undefined> | null | undefined,
  sourceId: string,
  dimKey: string
): string {
  const entry =
    loaded && Object.prototype.hasOwnProperty.call(loaded, sourceId) ? loaded[sourceId] : null;
  const map = entry && entry.breakdowns;
  if (!map || typeof map !== "object") return "ready";
  return Object.prototype.hasOwnProperty.call(map, dimKey)
    ? String((map as Record<string, unknown>)[dimKey])
    : "ready";
}

/** Servable - the rows may be read for this breakdown. */
export function breakdownServable(
  loaded: Record<string, DimSourceEntry | null | undefined> | null | undefined,
  sourceId: string,
  dimKey: string
): boolean {
  const s = breakdownState(loaded, sourceId, dimKey);
  return s === "ready" || s === "stale";
}

/** One offerable breakdown: the axis key, where its rows live, and what to print. */
export interface BreakdownDimEntry {
  /** The axis key: bare `device_type` for the built-in, `ds:<sourceId>:<key>` for a sheet column. */
  dim: string;
  sourceId: string;
  /** The key to read inside each row's `dims`. */
  key: string;
  label: string;
  note: string;
  source: string;
}

/** Own-key read into an unknown-shaped wire object; anything else answers undefined. */
function readField(o: unknown, key: string): unknown {
  return o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, key)
    ? (o as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Which dimensions the Breakdown may offer, and where each comes from.
 *
 * A sheet source names its own dimensions, so the list is derived from the pacing's configured
 * sources - label, source id and dimension key together, because the panel needs all three: the
 * label to print, the id to find the rows, the key to read inside them.
 *
 * The built-in device source keeps its bare `device_type` key so every stored widget, URL and test
 * that names it goes on working.
 *
 * `loaded` is the dimSources map from the dashboard blob. Passing it drops the breakdowns whose
 * rows may not be served - a re-pointed column, a column that left the sheet. Omitting it keeps
 * every configured breakdown, which is what the callers that only know the config want.
 */
export function breakdownDimsFor(
  configured: readonly (ConfiguredDimSource | null | undefined)[] | null | undefined,
  loaded?: Record<string, DimSourceEntry | null | undefined> | null
): BreakdownDimEntry[] {
  const out: BreakdownDimEntry[] = [];
  for (const src of Array.isArray(configured) ? configured : []) {
    if (!src || typeof src !== "object") continue;
    if (src.loader === "bq_mart" && src.id === "devices") {
      out.push({
        dim: DEVICE_DIM,
        sourceId: "devices",
        key: DEVICE_DIM,
        label: "Device",
        note: "from DSP",
        source: "DSP",
      });
      continue;
    }
    if (src.loader !== "sheet") continue;
    const sourceId = src.id ?? "";
    const title = typeof src.title === "string" && src.title ? src.title : null;
    const dims = readField(readField(src.origin, "columns"), "dims");
    for (const d of Array.isArray(dims) ? (dims as readonly unknown[]) : []) {
      const key = readField(d, "key");
      if (typeof key !== "string" || !key) continue;
      if (loaded && !breakdownServable(loaded, sourceId, key)) continue;
      const label = readField(d, "label");
      // Namespaced, or two sources with a `city` column would answer to one tab
      // and one URL parameter.
      out.push({
        dim: `ds:${sourceId}:${key}`,
        sourceId,
        key,
        label: typeof label === "string" && label ? label : key,
        note: title ?? "from sheet",
        source: title ?? sourceId,
      });
    }
  }
  // Two sheets both carrying `city` give two breakdowns with the same display
  // name. The axis keys keep them apart; the TABS would collide, and a person
  // reading two tabs called City has no way to tell which is which. So the
  // source name is appended - and ONLY where there is a collision, because on
  // the ordinary pacing it is a word of noise on every tab (owner, 2026-08-11).
  const seen = new Map<string, number>();
  for (const e of out) seen.set(e.label, (seen.get(e.label) || 0) + 1);
  for (const e of out) if ((seen.get(e.label) || 0) > 1) e.label = `${e.label} (${e.source})`;
  return out;
}

/** Is this Breakdown tab backed by a dimension source? */
export function isDimSourceDim(dimKey: string): boolean {
  return dimKey === DEVICE_DIM || dimKey.startsWith("ds:");
}

// A leftover row carries only the primary unit - it has no clicks or spend of its
// own to show, exactly like the existing Others remainder.
function residualBucket(unitKey: keyof DimBucket, amount: number): DimBucket {
  const b = zero();
  b[unitKey] = amount;
  return b;
}

/**
 * The bucket map the Breakdown table and donut render: the named devices, plus the two leftover
 * rows that make the parts add up to delivery (spec §5.2).
 *
 * `result.buckets` is built fresh by every aggregate call, so it is extended in place - copying it
 * into a new map would mean assigning a '__proto__' bucket, the one assignment that silently does
 * nothing.
 */
export function deviceBucketMap(
  result: DimSourceAggregate | null | undefined,
  unitKey: keyof DimBucket
): Record<string, DimBucket> {
  if (!result) return {};
  const map = result.buckets;
  // 'No value' keeps the metrics the source actually reported for those rows -
  // real clicks and real spend that simply have no device on them.
  if (result.noValue > 0) map[NO_VALUE_KEY] = { ...result.noValueMetrics };
  // 'Not covered' has no rows behind it at all, so it carries the unit alone.
  if (result.notCovered > 0) map[NOT_COVERED_KEY] = residualBucket(unitKey, result.notCovered);
  return map;
}

// NOTE: the reference's `UNMEASURED_ROW_KEYS` + `breakdownTotals` are NOT here - they were ported
// into ./breakdown-aggregate.ts (as UNKNOWN_BEYOND_UNIT_KEYS + breakdownTotals) and every caller
// uses that copy.

/**
 * The line under the tabs, or null when this dimension has nothing to state. Only a dimension
 * source has coverage; every other dimension partitions delivery by construction and would be
 * claiming 100% of itself.
 */
export function coverageLineFor(
  dimKey: string,
  result: DimSourceAggregate | null | undefined,
  rowCount: number
): string | null {
  if (!isDimSourceDim(dimKey) || !result || !(rowCount > 0)) return null;
  return coverageSublabel(result);
}

/**
 * The window that line was measured over, under the same guard - a dimension source is the only
 * dimension whose numbers cover part of the flight, so it is the only one with a window worth
 * naming.
 */
export function coverageWindowFor(
  dimKey: string,
  result: DimSourceAggregate | null | undefined,
  rowCount: number
): string | null {
  if (!isDimSourceDim(dimKey) || !result || !(rowCount > 0)) return null;
  return coverageWindowLabel(result);
}
