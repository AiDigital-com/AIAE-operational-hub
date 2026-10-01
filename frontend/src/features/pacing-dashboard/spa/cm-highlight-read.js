// workspace/src/lib/dashboard/cm-highlight-read.js
//
// One highlight expression read off the matched CM360 pairs (spec 2026-09-16 §2.8), for both
// highlight passes: the view pass (report-highlights.js: columns, series, KPIs) and the Layout
// block pass (widget-highlights.js: a block, a stat-row cell, a mini-chart line). Two copies
// of «how a rule reads a pair» is how a column and the block beside it end up judging one
// number two ways, so both import this.
//
// It is `cmEvalAt`'s twin (cm-formula-context.js): the same marker, the same reads-first rule
// and the SAME context builder. What differs is the canon, which is the whole reason there are
// two: inside a highlight a missing operand or a zero denominator is null and cannot make a
// rule match (`evaluateHighlightOne`), where a value cell reads absence as 0.
//
// Pure: no React, no store, no data of its own.
import { cmPairMarkerOf, cmContext, cmSeriesContext } from './cm-formula-context.js';
import { evaluateHighlightOne, evaluateHighlightSeries } from './highlight-expression.js';
import { evaluateMaskedSeries } from './widget-formula.js';

/**
 * One slot: `read(metric)` is the slot's join (`atDate`, `atLabel`, `totals`, or a sum) and
 * `scalars` the plan half published for that row or window (§2.4).
 *
 * Every read is taken BEFORE the evaluator runs: a join with no row for this slot is null, and
 * the number is never a measured zero standing in for an absent one. An unplanned row needs no
 * gate of its own: its scalars are nulls, which the highlight canon refuses on the same terms.
 *
 * `cmPairMarkerOf`, not `cmMarkerOf`: the same marker for a cm-bearing expression, and a marker
 * at all for the delivery expression a cm-fed owner's rule is read through, where `cl` is the
 * pair's own delivery half.
 */
export function cmHighlightOne(expr, read, scalars) {
  const marker = cmPairMarkerOf(expr);
  if (!marker) return null;
  const pairs = new Map();
  for (const entry of marker.reads) {
    const pair = pairs.has(entry.metric) ? pairs.get(entry.metric) : read(entry.metric);
    const half = entry.side === 'cm' ? pair?.cm360 : pair?.delivery;
    if (!Number.isFinite(half)) return null;
    pairs.set(entry.metric, pair);
  }
  return evaluateHighlightOne(marker.ast, cmContext(pairs, scalars)).value;
}

/**
 * A run of days: the expression over the whole published axis at once, which is what a window
 * function needs (§2.8, §2.9). Returns one value per entry of `order`, or null for text that
 * does not parse.
 *
 * The NUMBER is `evaluateMaskedSeries`' own, which is the number the cell or the line beside
 * the rule prints: a highlight judges what is on screen. Under holes the two evaluators
 * genuinely disagree (`rolling` here averages the days that joined, while the flattened series
 * divides by the window's width and counts a hole as a zero), and taking the value from
 * anywhere else would let a rule refuse to paint the very cell it is describing.
 *
 * `evaluateHighlightSeries`' own check stays as the second gate, not as the value: it nulls a
 * zero denominator and a window whose input was never measured. So a day is a number only
 * where the mask says the join answered AND that gate allows it.
 */
export function cmHighlightSeries(expr, order, atDate, scalars) {
  const marker = cmPairMarkerOf(expr);
  if (!marker) return null;
  const pairsByMetric = new Map();
  for (const entry of marker.reads) {
    if (pairsByMetric.has(entry.metric)) continue;
    pairsByMetric.set(entry.metric, order.map((date) => atDate(entry.metric, date)));
  }
  const ctx = cmSeriesContext(pairsByMetric, scalars);
  const masked = evaluateMaskedSeries(marker.ast, ctx);
  // `evaluateHighlightSeries` is the ordinary series evaluator underneath, which knows arrays
  // and scalars and no third shape, so the same context is handed to it flat.
  const flat = { length: order.length, get: (name) => {
    const answer = ctx.get(name);
    return answer && typeof answer === 'object' && Array.isArray(answer.values) ? answer.values : answer;
  } };
  const checkedValues = evaluateHighlightSeries(marker.ast, flat).values;
  return order.map((_date, i) => (masked.present[i] && checkedValues[i] != null ? masked.values[i] : null));
}
