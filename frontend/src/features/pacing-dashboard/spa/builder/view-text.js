// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/view-text.js
//
// The words a view card wears, and nothing else. Pure, so the frame, the builder's Views
// list and its remove question all name a view the same way — the sentence «“Chart” and
// everything in it leave this report» and the button that says «Remove Chart» are about the
// same card, and two spellings of that name would read as two different ones.
//
// It sits beside ViewFrame rather than inside it because ReportBuilder asks the same
// questions from outside the card (the confirm modal, the ▲▼ labels it hands down), and
// because the same names are asked for in more than one card: a GRAIN names a chart's X
// chip and a table's Rows chip, and a COLUMN's name is on its row, in its popover's
// placeholder and in the sort picker beside it.
import { autoLabel, CALC_LABELS, resolveValue } from '../report-render.js';
import { AUX_DIMS } from '../metric-catalog.js';
import { flattenViews } from '../report-v2.js';

/** The word each view kind wears on its card, and in a sentence about it. */
export const KIND_LABEL = {
  chart: 'Chart', table: 'Table', kpi: 'KPI', pie: 'Pie', compare: 'Compare', container: 'Container', atom: 'Element',
};

/**
 * What this view is CALLED, on a button's label and in the remove question — its own title
 * when the author gave it one, else the kind, which is what the card shows.
 *
 * With the SPEC in hand it can do the one thing the kind alone cannot: tell two untitled
 * views of a kind apart. «Remove Chart» on both of a report's two charts, «Focus a row →
 * Chart» on both wire chips and «Chart» twice in the sort picker were one hole with four
 * mouths (T10's carry). Numbered only when there IS more than one — a report with a single
 * chart has nothing to disambiguate, and «Chart 1» there would be a count nobody asked for.
 *
 * The spec is optional so a caller that has only the view still gets a name; it just gets
 * the bare kind, which is what every caller got before.
 */
export function viewName(view, spec) {
  if (!view) return undefined;
  if (view.title) return view.title;
  if (view.kind === 'atom' && view.brick?.label) return view.brick.label;
  const kind = KIND_LABEL[view.kind] || view.kind;
  const views = spec && Array.isArray(spec.views) ? flattenViews(spec.views) : null;
  if (!views) return kind;
  const same = views.filter((v) => v && v.kind === view.kind && !v.title);
  if (same.length < 2) return kind;
  const n = same.findIndex((v) => v.id === view.id);
  return n < 0 ? kind : `${kind} ${n + 1}`;
}

/** The three grains a chart's X or a table's rows may run down, as this product names them
 *  — the same words `dimensionEntries` gives them. Restated here because a chip has to name
 *  its grain before the pacing has loaded, and because `dateLi` never reaches a chart. */
export const GRAIN_LABEL = {
  __proto__: null, date: 'Date', li: 'Line item', dateLi: 'Date × line item',
};

/**
 * What one dimension KEY is called, in the pacing's own word — or null when nothing names it.
 *
 * The PACING's entry first (`dimensionEntries`), because it is the only thing that can name a
 * dimension SOURCE axis, which the author configured; then the CATALOGUE, for the two aux
 * cuts.
 *
 * That second step is not belt and braces (fix round 1). `env.dims` and `env.autoDims` are
 * built by two different rules and they disagree about exactly those two keys:
 * `dimensionEntries` lists `aux:creative` only when it is handed the creative rows, and the
 * builder's env is not handed them, while `autoDimensionOptions` offers the key on every
 * pacing that fetches creatives. Read through `env.dims` alone, an auto switch on such a
 * pacing printed `aux:creative` — an internal key — at the author.
 */
export function dimLabel(dims, key) {
  const hit = (Array.isArray(dims) ? dims : []).find((d) => d && d.kind === 'dim' && d.key === key);
  if (hit && hit.label) return hit.label;
  const aux = typeof key === 'string' ? AUX_DIMS[key] : null;
  return (aux && aux.label) || null;
}

/**
 * What a stored grain (`{type}`, `{type:'dim', key}` or `{type:'control', controlId}`) is
 * CALLED on a chip.
 *
 * A dimension names itself from the STORE — the pacing decides what its own axes are called
 * — then from the catalogue (`dimLabel`), and its key is the last fallback, so a dimension
 * the pacing stopped carrying still names itself instead of leaving the chip blank.
 *
 * A CONTROL grain names the SWITCH (M4), because that is what the author chose: the
 * dimension under it is the viewer's answer and changes while the tile is on screen. `spec`
 * is what carries the switch's label; without it the chip says the generic word, which is
 * what every caller that holds only a view already gets for a view's name.
 */
export function grainName(env, grain, spec) {
  const type = (grain && grain.type) || 'date';
  if (type === 'control') {
    const list = spec && Array.isArray(spec.controls) ? spec.controls : [];
    const ctl = list.find((c) => c && c.type === 'dimension');
    return (ctl && ctl.label) || 'Dimension switch';
  }
  if (type !== 'dim') return GRAIN_LABEL[type] || type;
  const key = grain && grain.key;
  return dimLabel(env && env.dims, key) || key || '—';
}

/** What a stored VALUE is called — the name §2 derives from it. `—` is this renderer's
 *  empty-cell placeholder, and a bound value with no switch left to follow resolves to
 *  nothing: a draft the Save gate blocks by name, on a card that still has to say something.
 *  A KPI and a pie hold one of these and no label of their own (Table D). */
export const valueName = (value, spec) => (value && value.metricBy === 'buyUnit'
  // The stored `metric` on such a value is a PLACEHOLDER the tile overwrites per pacing
  // (auto-controls.js), so naming it «Impressions» on a click-bought campaign would be a lie
  // the card tells on every row it appears in. The rule is the name.
  ? 'Buy type'
  : autoLabel(resolveValue(value, spec, null)) || '—');

/** What a table column is CALLED: the name its author typed, or the one its value derives
 *  (§2). */
export function columnName(column, spec) {
  if (column && column.labelAuto === false && column.label) return column.label;
  return valueName(column && column.value, spec);
}

/** …and the same question for a chart's series, which has one more kind of answer: a
 *  CALCULATION has no value to derive a name from, so §8's own table names it. The banner
 *  that reports a refusal about a series has to call it what its row calls it. */
export function seriesName(series, spec) {
  if (series && series.labelAuto === false && series.label) return series.label;
  if (series && series.kind === 'calc') return CALC_LABELS[series.calc] || series.calc;
  return valueName(series && series.value, spec);
}

/**
 * What a metric switch OFFERS, in one phrase — §2's rule per option (the caption the author
 * typed, or the name its value derives), joined.
 *
 * Two chips print it: the Controls row's «Metric switch · Impressions / Clicks» and the
 * Compare card's own. They had a derivation each, and the two tails already differed — one
 * dropped an empty string, the other dropped `—` — so one switch could read two ways in one
 * window. A `—` is this renderer's empty-cell placeholder, not a name, and neither chip
 * should print it in a list.
 */
export function switchOptionLabels(control, spec) {
  const list = Array.isArray(control && control.options) ? control.options : [];
  return list
    .map((o) => (o && o.labelAuto === false && o.label ? o.label : valueName(o && o.value, spec)))
    .filter((s) => s && s !== '—')
    .join(' / ');
}

/**
 * What a DIMENSION switch offers, in one phrase — each stored key in the pacing's own word,
 * joined, in the stored (chip) order. `switchOptionLabels` one control over, and for the
 * same reason: the Controls row's chip has to print what the viewer will see.
 *
 * A key the pacing does not carry still prints — as its own key, through `grainName`'s
 * fallback — because the option is stored and the reader has to be able to find it.
 *
 * An AUTO switch (sections cutover 2026-09-07) stores no keys at all: it prints the word
 * `Auto` and, after it, the list the open pacing resolves to (`env.autoDims`, the tile's own
 * pre-step run once by the builder's store seam). `Auto` alone on a pacing that carries
 * nothing yet — never «no dimensions yet», which is what an unfinished stored list says and
 * would read here as a switch the author has to go and fix.
 */
export function dimensionChipList(control, env) {
  const auto = !!control && control.optionsAuto === true;
  const keys = auto
    ? (env && Array.isArray(env.autoDims) ? env.autoDims : [])
    : (Array.isArray(control && control.options) ? control.options : []);
  const said = keys.map((key) => grainName(env, { type: 'dim', key })).filter((s) => s && s !== '—').join(' / ');
  if (!auto) return said;
  return said ? `Auto: ${said}` : 'Auto';
}

/** …and what a CHART draws, in one phrase — the series' own names, in card order. `viewName`
 *  answers what a chart is CALLED («Chart 1»), which tells two rows apart and says nothing
 *  about either; this is what the Compare card's map prints under the row so the reader
 *  knows which chart they are wiring. `null` when there is nothing to say. */
export function chartSeriesNames(view, spec) {
  const list = Array.isArray(view && view.series) ? view.series : [];
  const said = list.map((s) => (s ? seriesName(s, spec) : null)).filter((x) => x && x !== '—');
  return said.length ? said.join(', ') : null;
}
