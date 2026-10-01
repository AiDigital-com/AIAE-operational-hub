// workspace/src/lib/dashboard/cm-formula-context.js
//
// The CM360 vocabulary a formula may name, and the ONE context every evaluation site reads
// it through (spec 2026-09-16 §2.1/§2.2/§2.3).
//
// Pure: no React, no DOM, no store, and no data of its own. Three passes import it — the
// value pass (report-render.js), the highlight pass (report-highlights.js) and the Layout
// bricks (brick-data.js) — and one module is what keeps them from disagreeing about which
// identifier reads which half of a joined pair. A second copy of that table is how a chip
// and the cell under it end up describing different numbers.
import { CM_FORMULA_ONLY, evaluateOne, FIELDS_CM_DELIVERY, FUNCTIONS, identifiersOfAst, pairsServe, parse } from './widget-formula.js';

/** identifier → the CM360 metric it reads off `pair.cm360`. NULL-prototype and frozen: it is
 *  looked up BY A NAME that comes out of stored config, and on a plain object
 *  `CM_IDS['constructor']` answers the Function constructor. */
export const CM_IDS = Object.freeze({
  __proto__: null, cmIm: 'impressions', cmCl: 'clicks', cmCo: 'completions',
});

/** The metric name each of `FIELDS_CM_DELIVERY`'s three identifiers reads. Private: the
 *  membership those three identifiers belong to is `widget-formula.js`'s own Set, imported
 *  rather than relisted below, so the two cannot drift onto different identifiers — this
 *  table adds only the one new fact FIELDS_CM_DELIVERY does not carry, the metric name. */
const DLV_METRIC_NAME = { im: 'impressions', cl: 'clicks', co: 'completions' };

/** …and the DELIVERY half of the same comparison (§2.3), read off `pair.delivery` — never
 *  the engine's own rows. That is the whole point of the pair: under a breakdown the
 *  comparison is the overlap or the focused tuple, so `cmIm / im` describes one matched
 *  population, while the engine's `im` beside it counts everything this widget's scope
 *  delivered. Two different numbers; the identifier is which one you asked for.
 *
 *  NULL-prototype and frozen for the same reason as `CM_IDS`, and its key set is
 *  `FIELDS_CM_DELIVERY`'s own, not a second hand-written `im`/`cl`/`co`. */
export const DLV_IDS = Object.freeze([...FIELDS_CM_DELIVERY].reduce((out, name) => {
  out[name] = DLV_METRIC_NAME[name];
  return out;
}, Object.create(null)));

/** The whole-identifier scan. It is the CLIENT's pre-gate in front of a parse, and the twin
 *  of `shared/report-v2.js`'s CM_EXPR_RE, which has no parser at all (§2.1). Not global: a
 *  `g` flag carries `lastIndex` between calls and would answer false every other time. */
export const CM_ID_RE = /\bcm(?:Im|Cl|Co)\b/;

/** Does this expression NAME one of the three? A regex, deliberately: it runs per column,
 *  per series, per share and per guide on every builder keystroke, and it must answer for
 *  half-typed text without a parse. Text that names one and does not parse is cm-bearing and
 *  unstorable, which is the draft gate's business, not this function's. */
export function isCmBearing(expr) {
  return typeof expr === 'string' && CM_ID_RE.test(expr);
}

/** Every read of the comparison a parsed formula makes, first-seen order. `side` says which
 *  half of the pair the identifier is: the CM360 file, or the delivery it is matched to. */
export function cmReadsOf(ast) {
  const out = [];
  for (const name of identifiersOfAst(ast)) {
    if (CM_IDS[name]) out.push({ name, metric: CM_IDS[name], side: 'cm' });
    else if (DLV_IDS[name]) out.push({ name, metric: DLV_IDS[name], side: 'bq' });
  }
  return out;
}

/**
 * The marker a cm-bearing formula rides on a model as (§2.2):
 *   { kind: 'formula', expr, ast, reads, planFields }
 *
 * MEMOISED by the expression string, behind the regex pre-gate. `cmFeedOf` calls it for every
 * column, series, share and guide of a view on every keystroke in the builder, and parsing a
 * 500-character expression per element per render is the difference between a panel that
 * types and one that stutters. That is the whole benefit: `cmReaderFor`'s reader cache
 * (report-render.js) is keyed on `dataset` and `projection` alone, never on a marker, so
 * nothing downstream depends on this cache returning the same object twice — only on it
 * returning fast.
 *
 * `planFields` is every identifier that is NOT a read of the comparison. On an expression the
 * validator accepted those are plan fields (§2.3 admits nothing else), and the second pass
 * looks them up in the scalars the engine published rather than recomputing a plan.
 *
 * null for text that does not parse: the draft gate refuses such a formula before it is
 * stored, and a renderer that met one anyway must draw a dash rather than throw.
 */
const MARKERS = new Map();
/** Keystrokes mint a new string each time, so the cache is bounded rather than a slow leak in
 *  a builder session. Clearing wholesale is right here: the entries are equally cheap to
 *  rebuild and the live model re-mints on its next render. */
const MARKER_CACHE_MAX = 500;

const markerFrom = (expr) => {
  const parsed = parse(expr);
  if (!parsed.ok) return null;
  const reads = cmReadsOf(parsed.ast);
  const named = new Set(reads.map((r) => r.name));
  return Object.freeze({
    kind: 'formula',
    expr,
    ast: parsed.ast,
    reads,
    planFields: identifiersOfAst(parsed.ast).filter((name) => !named.has(name)),
  });
};
const memoMarker = (cache, expr) => {
  if (cache.has(expr)) return cache.get(expr);
  const marker = markerFrom(expr);
  if (cache.size >= MARKER_CACHE_MAX) cache.clear();
  cache.set(expr, marker);
  return marker;
};

export function cmMarkerOf(expr) {
  if (!isCmBearing(expr)) return null;
  return memoMarker(MARKERS, expr);
}

/**
 * The same marker for ANY expression, cm-bearing or not (2026-09-18).
 *
 * `cmMarkerOf` stays the answer to «does this value read CM360», which is what the value pass,
 * the fetch gate and the byte-identity rule stand on. This one is for the highlight pass on a
 * CM-FED owner: a rule such as «red when cl < 100» names no CM360 field, yet beside a CM360
 * column it has to describe that column's own mapped population, and the pair's delivery half
 * is exactly that. So the rule is read off the pairs like a cm-bearing one, with `cl` as
 * `pair.delivery`. A name the pairs cannot serve (spend, a rate) reads null in `cmContext`,
 * and inside a highlight a null operand makes the rule say «Value unavailable», never match.
 *
 * A cache of its own, so a delivery expression can never come back from `cmMarkerOf`.
 */
const PAIR_MARKERS = new Map();
export function cmPairMarkerOf(expr) {
  return typeof expr === 'string' && expr ? memoMarker(PAIR_MARKERS, expr) : null;
}

/** Can the pairs answer every name in this expression? True for a cm-bearing formula the
 *  validator accepts, for a delivery expression over im / cl / co and the plan fields, and for
 *  a constant. It is the builder's question about a highlight rule on a cm-fed owner, asked
 *  with the validator's own vocabulary (`pairsServe`) so the two cannot disagree. */
export function readsOnlyPairs(expr) {
  const marker = cmPairMarkerOf(expr);
  return !!marker && marker.planFields.every((name) => pairsServe(name));
}

/**
 * cmContext(pairs, scalars) → the `{ get(name) }` `evaluateOne` reads a cm-bearing formula
 * through (§2.2).
 *
 *   `pairs`   Map(metric → `{delivery, cm360}` | null) — what the reader answered for THIS
 *             row, label or window. The caller has already applied the absence rule
 *             (`cmEvalAt`), so a null here is only reachable by a caller that has not.
 *   `scalars` the plan scalars the ENGINE published for this row or window (§2.4), or null.
 *             Never recomputed here: a cm formula and the plan column beside it must not be
 *             able to disagree.
 *
 * Anything else is null, and `evaluateOne` reads null as 0 — the absence-is-zero canon every
 * delivery formula already runs on. `name in scalars` is `aggCtx`'s own spelling (§2.4): a
 * declared target of 0 is a NUMBER, and only a field the grain does not carry is absent. The
 * identifier set reaching here is bounded by `validate`, so no prototype key can arrive.
 */
export function cmContext(pairs, scalars) {
  const read = (metric) => (pairs && typeof pairs.get === 'function' ? pairs.get(metric) : null);
  return {
    get(name) {
      const cmMetric = CM_IDS[name];
      if (cmMetric) { const p = read(cmMetric); return p ? p.cm360 : null; }
      const dlvMetric = DLV_IDS[name];
      if (dlvMetric) { const p = read(dlvMetric); return p ? p.delivery : null; }
      return scalars && name in scalars ? scalars[name] : null;
    },
  };
}

/**
 * One pair, one side, one finiteness rule (§2.2). MOVED here verbatim from
 * `report-render.js`, which imports it back: `cmEvalAt`'s metric arm IS this function, and a
 * second copy of «a non-finite half is a dash» is a second answer waiting to happen. A delta
 * is a ratio in the projection and a percent on screen, which is the `* 100`.
 */
export function cmValueAt(pair, side) {
  if (!pair) return null;
  const v = side === 'delta'
    ? (pair.delta == null ? null : pair.delta * 100)
    : (side === 'cm' ? pair.cm360 : pair.delivery);
  return Number.isFinite(v) ? v : null;
}

/**
 * cmEvalAt(marker, read, scalars) → the number ONE cm-fed slot prints, or null (§2.2).
 *
 * `read(metric)` answers the joined pair for this slot: a day, a tuple label, or the window
 * totals. `scalars` is the plan the ENGINE published for this row or window (§2.4).
 *
 * A METRIC marker is `cmValueAt` and nothing else — the shape a cm column, a Δ% and a cm KPI
 * have read since v2 shipped.
 *
 * A FORMULA marker READS EVERY SIDE FIRST. If any read answers a null pair (`atDate` /
 * `atLabel` found no row, `totals` answered over an empty window) or a half that is not
 * finite, the cell is null and the evaluator is never called: a number computed around an
 * absence is a claim about data nobody has, and the system tells that fact as a dash
 * everywhere else. Only when every side is a number does the formula canon apply — inside a
 * joined row the numbers ARE numbers, a day the CM file shows nothing for is a measured 0
 * there exactly as it is in the cm column beside it, and `x / 0 → 0`.
 *
 * It lives in THIS module, not in `report-render.js`, because `report-render.js` imports
 * `brick-data.js` and stage 7's bricks evaluate through here: the reverse import would be a
 * cycle. `report-render.js` re-exports it for its own call sites.
 */
export function cmEvalAt(marker, read, scalars) {
  if (!marker) return null;
  if (marker.kind !== 'formula') return cmValueAt(read(marker.metric), marker.side);
  const pairs = new Map();
  for (const entry of marker.reads) {
    if (!pairs.has(entry.metric)) pairs.set(entry.metric, read(entry.metric));
  }
  for (const entry of marker.reads) {
    const pair = pairs.get(entry.metric);
    const half = pair ? (entry.side === 'cm' ? pair.cm360 : pair.delivery) : null;
    if (!Number.isFinite(half)) return null;
  }
  // Every side the expression NAMES is a number, so the formula canon applies: inside a joined
  // row the numbers ARE numbers — a day the CM360 file shows nothing for is a measured 0 there,
  // exactly as it is in the cm column beside it — and `x / 0 → 0` (widget-formula.js's own
  // rule, not a second one written here). `scalars` is the plan the SLOT's grain published
  // (§2.4): the engine's own object, never recomputed. A plan field the slot carries none of is
  // simply absent from the context, and an absent identifier inside arithmetic is 0 by that
  // same canon — never a number fetched from somewhere else.
  return evaluateOne(marker.ast, cmContext(pairs, scalars)).value;
}

/**
 * cmFieldRefusal(marker, fieldSet) → §2.3's sentence, or null.
 *
 * The RUNTIME twin of `validate`'s field check, asked once per fed column against the plan
 * fields THIS grain turned out to carry (§2.4's field-set gate). `validate` judges a formula
 * where it is authored, against the fields a slot could carry; this judges it where it is
 * read, against the fields the engine actually published — so `daysLeft` on a dimension row,
 * or a plan field on a `ds:` cut, is the column error the engine would have raised rather
 * than a silent dash.
 *
 * Written in this task, beside `cmEvalAt`, though its first caller is stage 2: the two are one
 * rule about one marker, and a sentence whose owner is two stages away from its twin is a
 * sentence that drifts. `FUNCTIONS` is belt and braces — `identifiersOfAst` yields `id` nodes
 * only, and a call's name is never one — and it is named so the set here reads as the union
 * §2.3 describes.
 */
export function cmFieldRefusal(marker, fieldSet) {
  if (!marker || marker.kind !== 'formula') return null;
  for (const name of identifiersOfAst(marker.ast)) {
    if (CM_IDS[name] || DLV_IDS[name]) continue;
    if (Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) continue;
    if (fieldSet && typeof fieldSet.has === 'function' && fieldSet.has(name)) continue;
    return CM_FORMULA_ONLY;
  }
  return null;
}

/** Identifier → [which half of the pair, which CM360 metric]. A Map and not an object
 *  literal, because `get` is handed whatever the author typed and `constructor` must name
 *  no metric. `cmIm` and `im` land on ONE entry of `pairsByMetric`, which is what makes both
 *  halves of `cmIm / im` describe the same matched population (§2.3). */
const CM_SIDE_OF = new Map([
  ...Object.keys(CM_IDS).map((name) => [name, ['cm360', CM_IDS[name]]]),
  ...Object.keys(DLV_IDS).map((name) => [name, ['delivery', DLV_IDS[name]]]),
]);

/**
 * cmSeriesContext(pairsByMetric, scalars) → the ctx `evaluateMaskedSeries` reads a CM360
 * window function over (spec §2.9).
 *
 * `pairsByMetric` is one array of joined pairs per CM360 metric, in the order the model
 * published — `cmDates` on a chart, `cmRowOrder` on a date-rows table — with `null` where
 * the join had no row. `scalars` is the WINDOW's plan (§2.4: a date row reads the window's
 * plan, never a row's), broadcast over every day.
 *
 * Presence is per SIDE, which is `cmEvalAt`'s own rule read down an axis (§2.2): a day whose
 * delivery half is missing takes `cmIm / im` out and leaves `cmIm` standing. Collapsing the
 * pair into one flag would let the per-row pass and this one print different things about
 * the same day of the same tile.
 *
 * A name in `scalars` whose value is not finite answers `null` — the absent column, which
 * reads 0 inside the arithmetic. That is the 2026-09-12 canon and `aggCtx`'s own `name in
 * scalars`: a declared window with no target for a field is a 0, and an UNDECLARED one is
 * nulled by the caller's own gate before any of this runs.
 */
export function cmSeriesContext(pairsByMetric, scalars) {
  const pairs = pairsByMetric instanceof Map ? pairsByMetric : new Map();
  let length = 0;
  for (const list of pairs.values()) {
    if (Array.isArray(list)) { length = list.length; break; }
  }
  // Memoised per (metric, half): one expression names `cmIm` several times over, and the
  // array it reads is the same array every time.
  const cache = new Map();
  const sideOf = (half, metric) => {
    const key = `${metric}|${half}`;
    if (cache.has(key)) return cache.get(key);
    const list = pairs.get(metric) || [];
    const values = new Array(length);
    const present = new Array(length);
    for (let i = 0; i < length; i++) {
      const pair = list[i];
      const v = pair ? pair[half] : null;
      present[i] = Number.isFinite(v);
      values[i] = present[i] ? v : 0;
    }
    const out = { values, present };
    cache.set(key, out);
    return out;
  };
  return {
    length,
    get(name) {
      const side = CM_SIDE_OF.get(name);
      if (side) return sideOf(side[0], side[1]);
      if (scalars && name in scalars) {
        const v = scalars[name];
        return Number.isFinite(v) ? v : null;
      }
      return null;
    },
  };
}
