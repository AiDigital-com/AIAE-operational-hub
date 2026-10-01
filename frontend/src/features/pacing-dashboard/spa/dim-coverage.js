// workspace/src/lib/dashboard/dim-coverage.js
//
// Splits delivery into three parts that always add up:
//
//   named       the source reported a value  ->  one bucket per label
//   noValue     the source has the row but no value for this dimension
//   notCovered  the source never saw this delivery at all
//
// Both unknowns are real and different: "the DSP does not report devices" is not
// the same problem as "the DSP reports the row but leaves the field blank", and a
// single leftover figure hides which one you have. Measured 2026-08-09: for
// devices the second is tiny, for demographics it was 43% of the source's own
// rows — which is why the split exists at all.
//
// Everything is computed over the dates BOTH sides cover. A source that lags a
// day would otherwise report the lag as missing data, which is a fact about
// clocks, not about delivery (spec §5.1).
//
// Spec: docs/superpowers/specs/2026-08-09-dimension-sources-design.md §5.2

import { groupValue } from './dim-groups.js';

const METRICS = ['im', 'cl', 'sp', 'co', 'cv', 'pc', 'pv', 'dc'];

// Deliberately NOT format.js's fDs, which is the same 'Aug 1' shape: that module
// reaches date-utils -> pacing-core -> the '@shared' Vite alias, and this file's
// whole value is that a plain `node tests/…` can run the decisions in it. The
// panel's two leftover rows were once "covered" by tests that only matched source
// text, and the repair was moving the decisions somewhere runnable — importing a
// bundler-only path here would undo that for one date label.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd == null ? '' : ymd));
  const month = m && MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

// The video-completion pair is GATED, not summed: only a line item whose plan
// makes completes meaningful contributes to it. Without the pair a
// completes-bought pacing shows "Compl. 0 · VCR 0.00%" on every device while its
// other breakdowns show the real figures — the column reads as a measurement of
// zero rather than as a missing basis.
const GATED = ['imV', 'coV'];

function zero() {
  const b = {};
  for (const m of METRICS) b[m] = 0;
  for (const m of GATED) b[m] = 0;
  return b;
}

function add(bucket, metrics, vcrEligible) {
  for (const m of METRICS) bucket[m] += Number(metrics && metrics[m]) || 0;
  if (!vcrEligible) return;
  bucket.imV += Number(metrics && metrics.im) || 0;
  bucket.coV += Number(metrics && metrics.co) || 0;
}

// How much of the anchor one row carries. The gated pair is NOT a column in the
// file: `coV` is raw completes from the lines whose plan makes completes count,
// so a row on a display line contributes nothing to it. Anchoring there is what
// keeps the leftover in the unit the table actually prints — on a
// completes-bought pacing the visible column is the gated one, and measuring the
// remainder in raw completes leaves it with no column to land in.
function anchorAmount(metrics, anchor, vcrEligible) {
  if (anchor === 'coV') return vcrEligible ? (Number(metrics && metrics.co) || 0) : 0;
  if (anchor === 'imV') return vcrEligible ? (Number(metrics && metrics.im) || 0) : 0;
  return Number(metrics && metrics[anchor]) || 0;
}

/**
 * The unit a dimension source measures in, given the pacing's own buying unit.
 *
 * Completes are the one unit whose column is gated: the table prints `Compl.`,
 * which counts only the lines whose plan makes completes meaningful, and there is
 * no raw-completes column at all. Measuring the source in raw completes there
 * leaves both leftover rows with nowhere to print — every cell reads '—' and the
 * quantity survives only as a percentage beside the label.
 *
 * `hasGatedBasis` — whether ANY line item in view contributes to that pair.
 * Without one (a completes-bought pacing whose lines are all audio, where
 * eligibility is refused by channel) the gated columns are zero throughout, and
 * anchoring on them would empty the tab instead of fixing a column. Raw completes
 * are the honest fallback there.
 */
export function dimSourceUnitKey(unitKey, hasGatedBasis) {
  return (unitKey === 'co' && hasGatedBasis) ? 'coV' : unitKey;
}

// Read the dimension as an own key. A source may name a dimension after a
// built-in, and a plain read answers with a function for a row that carries no
// such dimension at all — which then becomes a bucket label.
function readDim(row, dimKey) {
  return (row && row.dims && Object.prototype.hasOwnProperty.call(row.dims, dimKey))
    ? row.dims[dimKey]
    : '';
}

// Nothing at all, or only spaces. Both belong in the no-value bucket: a slice
// whose label cannot be seen is worse than no slice. The counter below and the
// split above must agree on this, or the picker offers a dimension whose values
// never appear.
function isBlank(raw) {
  return String(raw == null ? '' : raw).trim() === '';
}

/**
 * @param {Array} rows            wave-1 rows: { date, line_item_id, dims, metrics }
 * @param {object} opts
 *   dimKey            which dimension inside `dims` to read
 *   liIdSet           Set of the line item ids in view, held as STRINGS. The row
 *                     side is coerced, the set is used as it comes, so a set of
 *                     numbers matches nothing and everything reads as not covered.
 *   anchor            metric the ratios are measured on, default 'im'. 'coV' and
 *                     'imV' are the GATED pair — not columns in the file, but
 *                     raw completes/impressions from the eligible lines only,
 *                     which is what the table prints on a CPV pacing.
 *   intersectWindow   false = measure over the selected range instead of the days
 *                     both sides cover (the widget surface — see §2 below)
 *   deliveryByDate    { 'YYYY-MM-DD': number } — the anchor metric per day, for
 *                     the same line items, from the dashboard's own facts
 *   range             optional { from, to } the user picked
 *   liPlanForFlight   optional { [li]: { fs, fe } } to clamp a row to its flight
 *   vcrEligibleIds    optional Set of the line item ids whose completes count
 *                     toward a video rate. The same set the panel already builds
 *                     for its other dimensions — passing it is what keeps a
 *                     display line's impressions out of a video line's rate when
 *                     both land in one device bucket.
 */
export function aggregateDimSource(rows, opts) {
  const o = opts || {};
  const dimKey = o.dimKey;
  const anchor = o.anchor || 'im';
  const liIdSet = o.liIdSet;
  const delivery = o.deliveryByDate || {};
  const list = Array.isArray(rows) ? rows : [];

  // Which rows count at all. Both passes below ask this one function: written
  // out twice, the two copies drift, and a test can only catch the drift in
  // whichever copy it happens to reach.
  const keep = (r) => {
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
  const srcDates = new Set();
  for (const r of list) if (keep(r)) srcDates.add(r.date);

  // 2. The window. By default it is where both sides have data, narrowed by the
  // user's range: a source that lags a day behind delivery would otherwise report
  // the lag as missing data.
  //
  // `intersectWindow: false` asks the other question, and the widget surface needs
  // it. A widget shows every source row in the selected period, lag included, so
  // its coverage has to be measured over that same period — the shared-days figure
  // would describe a total the tile is not printing.
  const deliveryDates = Object.keys(delivery);
  const wholeRange = o.intersectWindow === false;
  let from = null;
  let to = null;
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
    // asked about — otherwise the same data answers differently depending on
    // whether the user happens to have picked a range.
    if (o.range && from !== null) {
      if (o.range.from > from) from = o.range.from;
      if (o.range.to < to) to = o.range.to;
    }
  }
  const inWindow = wholeRange
    ? (d) => (from === null || d >= from) && (to === null || d <= to)
    : (d) => from !== null && to !== null && d >= from && d <= to;

  // 3. Walk the source rows once.
  const buckets = {};
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
    // drops. It is NOT deleted — that would break the addition.
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
        value: zero(), enumerable: true, writable: true, configurable: true,
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
  // loses precision in a number the UI puts on screen — |1 - 1.3| * 100 comes out
  // as 30.000000000000004. With no delivery there is nothing to disagree with,
  // unless the source itself reported something, which is a real disagreement and
  // must not read as a quiet zero.
  const discrepancy = deliveryTotal > 0
    ? Math.abs(deliveryTotal - srcTotal) * 100 / deliveryTotal
    : (srcTotal > 0 ? 100 : 0);

  return {
    buckets, named, noValue, noValueMetrics, notCovered,
    coverage, valued,
    discrepancy,
    from, to,
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

function eligibleRows(rows, liIdSet) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && (!liIdSet || liIdSet.has(String(r.line_item_id))));
}

/**
 * How many distinct labels the dimension has AFTER grouping.
 *
 * `groups` is this SOURCE's dictionary for this dimension — the count has to be
 * taken through the same lookup the rows are, or the cardinality gate answers
 * about the ungrouped vocabulary and hides a tab that would have been readable.
 */
export function dimSourceCardinality(rows, dimKey, liIdSet, groups) {
  const seen = new Set();
  for (const r of eligibleRows(rows, liIdSet)) {
    const raw = readDim(r, dimKey);
    if (isBlank(raw)) continue;
    const g = groupValue(dimKey, raw, groups);
    if (!g.drop) seen.add(g.label);
  }
  return seen.size;
}

/**
 * Offer the dimension only when the source has rows for a line item in view and
 * the value count is small enough to read.
 */
export function dimSourceAvailable(rows, liIdSet, dimKey, groups) {
  const eligible = eligibleRows(rows, liIdSet);
  if (eligible.length === 0) return false;
  if (!dimKey) return true;
  // Already filtered — counting again with the same set would just repeat it.
  return dimSourceCardinality(eligible, dimKey, null, groups) <= CARDINALITY_LIMIT;
}

/**
 * The line under the tabs. Both ratios answer different questions — how much
 * delivery the source knows about, and how much of it can actually be broken
 * down — so both are stated whenever they differ.
 */
export function coverageSublabel(r) {
  if (!r) return 'no matching delivery';
  // Zero coverage has THREE causes, and the split is on the DELIVERY side.
  //
  // `named` and `noValue` are counted in the anchor, and the anchor is the
  // pacing's buying unit — completes on a CPV line, clicks on CPC, not
  // impressions. So a device source carrying impressions and clicks but no
  // completes leaves both at 0 while delivery is real and entirely uncovered.
  // Splitting on the source side alone printed "no matching delivery" above a
  // table listing 40,000 impressions — the same contradiction this wording was
  // written to prevent, arriving from the other side.
  //
  // `notCovered > 0` means there WAS delivery to cover, so neither sentence
  // below is true and the honest line is the ordinary `covers 0%` form, which
  // the formatting under here already produces.
  if (!(r.coverage > 0) && !(r.notCovered > 0)) {
    // Nothing to divide by. Either the source reported rows on days the pacing
    // recorded no delivery, or neither side has anything at all.
    return ((r.named || 0) + (r.noValue || 0)) > 0
      ? 'no delivery recorded on these days'
      : 'no matching delivery';
  }
  const cov = Math.round(r.coverage * 100);
  const val = Math.round(r.valued * 100);
  // Only an exact 100 with nothing left over is "all". Above it the two sides
  // disagree, and rounding that up to "all delivery" would hide the very case
  // the discrepancy exists for — a source claiming more delivery than the pacing
  // has. Below it, 99.9% rounds to 100 while a "Not covered" row sits directly
  // under this line, so the leftover itself decides, not the rounded figure.
  if (cov === 100 && val === 100 && !(r.notCovered > 0)) return 'covers all delivery';
  // For devices the no-value share is tiny, so the two almost always round
  // alike. Saying the same number twice reads like a bug.
  if (cov === val) return `covers ${cov}% of delivery`;
  return `covers ${cov}% of delivery · ${val}% shown by value`;
}

/**
 * The disagreement figure wave-1 spec §5.3 asks for — but ONLY where the
 * coverage line does not already say it.
 *
 * A source that covers 35% of delivery is 65% off it: the same number from the
 * other side, and printing both reads as two facts where there is one. The
 * coverage line already IS the permanent label §5.3 wanted.
 *
 * What it does not say is the overflow case. "covers 130% of delivery" can be
 * read as "covered everything and then some", which is the failure this figure
 * exists to prevent — the two sides disagree, and the excess is not coverage. A
 * sheet source makes that ordinary rather than theoretical: its rows are typed
 * by another system with its own attribution.
 *
 * Below half a point it says nothing: a rounding difference is not a
 * disagreement, and a permanent "0.1% over" trains the reader to ignore the line
 * that matters at 30%.
 */
export function discrepancyLabel(result) {
  if (!result || !(result.coverage > 1)) return null;
  const over = (result.coverage - 1) * 100;
  if (!(over > 0.5)) return null;
  const pct = over >= 10 ? Math.round(over) : Math.round(over * 10) / 10;
  return `${pct}% more than the pacing delivered`;
}

/**
 * Whether what is on screen is the data the loader last READ, or the data it
 * last managed to read. The distinction only exists for a sheet source: a
 * failed read carries its previous rows forward under the current refresh id,
 * so the file is present and complete and nothing else says the numbers are old.
 *
 * `entry` is the envelope merge.mjs passes through — status/error/fetched_at.
 */
export function stalenessLabel(entry, today) {
  if (!entry) return null;
  const when = typeof entry.fetched_at === 'string' ? entry.fetched_at.slice(0, 10) : null;
  const parts = [];

  // BEHIND — the rows are fine and the mapping is current, but they were read
  // against an EARLIER refresh of this pacing, so the delivery they sit beside
  // has moved on since. Before 2026-08-11 merge.mjs simply dropped such a file
  // and the whole breakdown disappeared; serving it is right, and saying WHICH
  // DATES disagree is the point — the refresh ids mean nothing to a reader, the
  // dates are what they are comparing.
  if (entry.behind) {
    const src = shortDate(entry.coverage_hint) || (when ? shortDate(when) : null);
    const dash = shortDate(today);
    // Three shapes, because both dates are optional in the wild — an old-format
    // main file carries no asOf at all, and the one production pacing is exactly
    // that. Losing the source's own date because the OTHER one is missing would
    // throw away the more useful half.
    parts.push(
      src && dash ? `these rows are from an earlier refresh; the breakdown has data to ${src}, the dashboard to ${dash}`
        : src ? `these rows are from an earlier refresh; the breakdown has data to ${src}`
          : 'these rows are from an earlier refresh than the delivery beside them',
    );
  }

  if (entry.status === 'stale') {
    const reason = entry.error ? String(entry.error).split(':')[0] : null;
    const age = when && today ? daysBetweenIso(when, today) : null;
    const howOld = age === null ? 'an earlier read'
      : age <= 0 ? 'today'
      : age === 1 ? 'yesterday'
      : `${age} days ago`;
    parts.push(reason
      ? `last read failed (${reason}), showing data from ${howOld}`
      : `showing data from ${howOld}`);
  }

  return parts.length ? parts.join(' · ') : null;
}

function daysBetweenIso(from, to) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Which per-row field carries the primary quantity on a given tab: the donut's
 * size axis, the percentage beside each label, and the one cell a leftover row is
 * allowed to fill instead of dashing.
 *
 * Only a dimension source can differ from the pacing's own buying unit, and only
 * for completes — every other dimension partitions delivery in the unit the
 * pacing buys. Kept beside dimSourceUnitKey so the tab and the leftover row
 * cannot end up disagreeing about which column the quantity lives in: they did,
 * and the whole row printed dashes.
 */
export function rowUnitKeyFor(dimKey, unitKey, hasGatedBasis) {
  return isDimSourceDim(dimKey) ? dimSourceUnitKey(unitKey, hasGatedBasis) : unitKey;
}

/**
 * The days the coverage figure was measured over, as a human date range.
 *
 * The tab clips to the days both sides have, so on a lagging source its Total is
 * genuinely smaller than every other tab's for the same line item. Naming the
 * window is what tells that apart from missing delivery — without it the two
 * surfaces disagree and nothing on screen says why.
 */
export function coverageWindowLabel(result) {
  if (!result) return null;
  const from = shortDate(result.from);
  const to = shortDate(result.to);
  if (!from || !to) return null;
  return from === to ? `measured ${from}` : `measured ${from} – ${to}`;
}

// ---------------------------------------------------------------------------
// The panel's decisions, out here where they can be driven directly
// ---------------------------------------------------------------------------
//
// These three lived inside Breakdown.jsx, which no host test can import, so they
// were "covered" by pins that matched the source TEXT. That guards the text and
// not the behaviour: disabling the two leftover rows with `if (false)` left both
// suites green while the parts stopped adding up to delivery, and a misspelt key
// in `set.add` silently unregistered the whole tab. Moved here so a test can run
// them and assert on what comes out.

/** The dimension a loaded device source contributes. */
export const DEVICE_DIM = 'device_type';

/**
 * Whether the rows on disk may be READ for one breakdown.
 *
 * merge.mjs attaches `breakdowns: { <dimKey>: 'ready'|'stale'|'broken'|'not_read' }`
 * to every sheet source, by comparing the fingerprint of the mapping that
 * produced the file against what the stored mapping computes to now (spec §6.2).
 *
 * `ready` and `stale` are both servable — stale means the last read failed and
 * the previous rows under the SAME mapping are being shown, which is data, just
 * old. `not_read` and `broken` are not: the rows describe a different question,
 * or the column is gone from the sheet.
 *
 * A source with NO map is unrestricted. That is the catalogued `devices` case —
 * it has no per-pacing mapping to drift from — and it is also every response
 * from a dash-gate that predates this, so an older server degrades to today's
 * behaviour rather than to an empty dashboard.
 */
export function breakdownState(loaded, sourceId, dimKey) {
  const entry = (loaded && Object.prototype.hasOwnProperty.call(loaded, sourceId))
    ? loaded[sourceId] : null;
  const map = entry && entry.breakdowns;
  if (!map || typeof map !== 'object') return 'ready';
  return Object.prototype.hasOwnProperty.call(map, dimKey) ? map[dimKey] : 'ready';
}

/** Servable — the rows may be read for this breakdown. */
export function breakdownServable(loaded, sourceId, dimKey) {
  const s = breakdownState(loaded, sourceId, dimKey);
  return s === 'ready' || s === 'stale';
}

/**
 * Which dimensions the Breakdown may offer, and where each comes from.
 *
 * Waves 1–2 had one, so a constant was enough. A sheet source names its own, so
 * the list is now derived from the pacing's configured sources — label, source
 * id and dimension key together, because the panel needs all three: the label to
 * print, the id to find the rows, the key to read inside them.
 *
 * The built-in device source keeps its bare `device_type` key so every stored
 * widget, URL and test that names it goes on working.
 *
 * `loaded` (2026-08-11) is the dimSources map from the dashboard blob. Passing it
 * drops the breakdowns whose rows may not be served — a re-pointed column, a
 * column that left the sheet. Omitting it keeps every configured breakdown,
 * which is what the callers that only know the config want.
 */
export function breakdownDimsFor(configured, loaded) {
  const out = [];
  for (const src of Array.isArray(configured) ? configured : []) {
    if (!src || typeof src !== 'object') continue;
    if (src.loader === 'bq_mart' && src.id === 'devices') {
      out.push({ dim: DEVICE_DIM, sourceId: 'devices', key: DEVICE_DIM, label: 'Device',
        note: 'from DSP', source: 'DSP' });
      continue;
    }
    if (src.loader !== 'sheet') continue;
    const dims = ((src.origin || {}).columns || {}).dims;
    for (const d of Array.isArray(dims) ? dims : []) {
      if (!d || !d.key) continue;
      if (loaded && !breakdownServable(loaded, src.id, d.key)) continue;
      // Namespaced, or two sources with a `city` column would answer to one tab
      // and one URL parameter.
      out.push({ dim: `ds:${src.id}:${d.key}`, sourceId: src.id, key: d.key,
        label: d.label || d.key, note: src.title || 'from sheet',
        source: src.title || src.id });
    }
  }
  // Two sheets both carrying `city` give two breakdowns with the same display
  // name. The axis keys keep them apart; the TABS would collide, and a person
  // reading two tabs called City has no way to tell which is which. So the
  // source name is appended — and ONLY where there is a collision, because on
  // the ordinary pacing it is a word of noise on every tab (owner, 2026-08-11).
  const seen = new Map();
  for (const e of out) seen.set(e.label, (seen.get(e.label) || 0) + 1);
  for (const e of out) if (seen.get(e.label) > 1) e.label = `${e.label} (${e.source})`;
  return out;
}

/** Is this Breakdown tab backed by a dimension source? */
export function isDimSourceDim(dimKey) {
  return dimKey === DEVICE_DIM || (typeof dimKey === 'string' && dimKey.startsWith('ds:'));
}

// A leftover row carries only the primary unit — it has no clicks or spend of its
// own to show, exactly like the existing Others remainder.
function residualBucket(unitKey, amount) {
  return { im: 0, cl: 0, co: 0, cv: 0, sp: 0, pc: 0, pv: 0, dc: 0, imV: 0, coV: 0, [unitKey]: amount };
}

/**
 * The bucket map the Breakdown table and donut render: the named devices, plus
 * the two leftover rows that make the parts add up to delivery (spec §5.2).
 *
 * `result.buckets` is built fresh by every aggregate call, so it is extended in
 * place — copying it into a new map would mean assigning a '__proto__' bucket,
 * the one assignment that silently does nothing.
 */
export function deviceBucketMap(result, unitKey) {
  if (!result) return {};
  const map = result.buckets;
  // 'No value' keeps the metrics the source actually reported for those rows —
  // real clicks and real spend that simply have no device on them.
  if (result.noValue > 0) map.__novalue__ = { ...result.noValueMetrics };
  // 'Not covered' has no rows behind it at all, so it carries the unit alone.
  if (result.notCovered > 0) map.__notcovered__ = residualBucket(unitKey, result.notCovered);
  return map;
}

// The Total row, and the one rule that makes it honest under a dimension source.
//
// A 'Not covered' row carries the primary unit and nothing else — the source
// never saw that delivery, so it has no clicks, no spend and no gated pair to
// contribute. Divide the collected clicks by every impression INCLUDING those and
// the rate is wrong by exactly the share the source is missing: measured at 39%
// coverage on the largest pacing, that is a CTR reported at well under half its
// real value, in the row a reader trusts most.
//
// So volumes are the full sum — the columns still add up to the pacing's own
// delivery, which is the whole point of the leftover rows — while every RATE is
// computed over the part that was actually measured. The row keys are the panel's
// (`Breakdown.jsx`); this lives here because the rule exists for dimension
// sources and because a test can run it here.
//
// 'Others' has the same shape on every other dimension — line total minus the
// dimension's rows, in the primary unit only, with no clicks or spend of its own —
// and joined this on 2026-08-13. It was left alone before on the grounds that it is
// normally a sliver. That stopped being true when a dimension carrying ONE value
// could earn a tab: on Family RV's Message tab the remainder is 75.2% of delivery,
// and dividing 73 clicks by all 443 521 impressions reported a Total CTR of 0.016%
// against the one real row's 0.066%.
//
// 'Unclassified' and 'No value' stay OUT of this set: those buckets are aggregated
// from real facts, so their clicks and spend are measured, not missing.
const UNMEASURED_ROW_KEYS = new Set(['__notcovered__', '__others__']);

export function breakdownTotals(rows) {
  const t = { im: 0, cl: 0, co: 0, cv: 0, sp: 0, pc: 0, pv: 0, imV: 0, coV: 0 };
  const seen = { im: 0, cl: 0, cv: 0, sp: 0, imV: 0, coV: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    t.im += r.im || 0; t.cl += r.cl || 0; t.co += r.co || 0; t.cv += r.cv || 0;
    t.sp += r.sp || 0; t.pc += r.pc || 0; t.pv += r.pv || 0;
    t.imV += r.imV || 0; t.coV += r.coV || 0;
    if (UNMEASURED_ROW_KEYS.has(r.key)) continue;
    seen.im += r.im || 0; seen.cl += r.cl || 0; seen.cv += r.cv || 0;
    seen.sp += r.sp || 0; seen.imV += r.imV || 0; seen.coV += r.coV || 0;
  }
  t.ctr = seen.im > 0 ? (seen.cl / seen.im * 100) : 0;
  t.vcr = seen.imV > 0 ? (seen.coV / seen.imV * 100) : 0;
  t.cvr = seen.cl > 0 ? (seen.cv / seen.cl * 100) : 0;
  t.cpm = seen.im > 0 ? (seen.sp / seen.im * 1000) : 0;
  return t;
}

/**
 * The line under the tabs, or null when this dimension has nothing to state.
 * Only a dimension source has coverage; every other dimension partitions
 * delivery by construction and would be claiming 100% of itself.
 */
export function coverageLineFor(dimKey, result, rowCount) {
  if (!isDimSourceDim(dimKey) || !result || !(rowCount > 0)) return null;
  return coverageSublabel(result);
}

/**
 * The window that line was measured over, under the same guard — a dimension
 * source is the only dimension whose numbers cover part of the flight, so it is
 * the only one with a window worth naming.
 */
export function coverageWindowFor(dimKey, result, rowCount) {
  if (!isDimSourceDim(dimKey) || !result || !(rowCount > 0)) return null;
  return coverageWindowLabel(result);
}
