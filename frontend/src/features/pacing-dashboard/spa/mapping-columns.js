// The one-screen mapping: what each column of the sheet IS.
//
// Spec: docs/superpowers/specs/2026-08-14-additional-data-one-screen.md
//
// The screen asks one question — "here is your sheet, what does each column
// mean" — instead of the five it used to ask across two tabs. Everything that
// decides an answer lives here, outside the component: which role a column
// holds, what is known about its contents, what a role change would destroy, and
// what the four figures at the top say.
//
// Storage is untouched. `origin.columns` keeps {date, line_item, dims[], metrics{},
// custom_metrics[]}; this module only reads and rewrites it through the existing
// breakdown ops.

import MetricRegistry from '@shared/metric-registry';
import {
  DIM_METRIC_SLOTS, metricSlotsFor, addBreakdown, removeBreakdown, renameBreakdown,
  widgetsUsingBreakdown, mintDimKey,
} from './sheet-source-norm.js';
import { estimateRows, budgetVerdict, budgetVerdictForBytes, FILE_LIMIT_BYTES } from './sheet-source-setup.js';

export const GROUPS = Object.freeze([
  { key: 'structure', title: 'Structure', hint: 'what a row is and where it belongs' },
  { key: 'metrics', title: 'Numbers', hint: 'summed on the dashboard' },
  { key: 'off', title: 'Not imported', hint: 'nothing from these reaches the dashboard' },
]);

/** How many unused columns are shown before the group folds. */
export const OFF_PREVIEW = 8;
/** Below this the search box is noise. */
export const SEARCH_FROM = 12;

const clean = (v) => String(v == null ? '' : v).trim();
const int = (n) => Number(n || 0).toLocaleString('en-US');

/* ── roles ─────────────────────────────────────────────────────────────────── */

/** The role a column currently holds, in the vocabulary the picker uses. */
export function roleOf(source, column) {
  const cols = (source?.origin || {}).columns || {};
  const name = clean(column);
  if (!name) return 'ignored';
  if (clean(cols.date) === name) return 'date';
  if (clean(cols.line_item) === name) return 'line_item';
  const dim = (cols.dims || []).find((d) => clean(d?.column) === name);
  if (dim) return 'dim';
  for (const key of Object.keys(cols.metrics || {})) {
    if (clean(cols.metrics[key]) === name) return `metric:${key}`;
  }
  return 'ignored';
}

/** The breakdown a column feeds, or null. */
export function dimOf(source, column) {
  const cols = (source?.origin || {}).columns || {};
  return (cols.dims || []).find((d) => clean(d?.column) === clean(column)) || null;
}

/**
 * What a role change would DESTROY, named so a confirm can say it.
 *
 * Three changes take stored work with them; everything else is undone by
 * changing it back. Returns null when nothing is lost — the caller then applies
 * the change without asking, which is most of the time.
 */
export function costOfRole(source, column, nextRole, widgets) {
  const current = roleOf(source, column);
  if (current === nextRole) return null;
  const cols = (source?.origin || {}).columns || {};

  if (current === 'dim') {
    const dim = dimOf(source, column);
    if (!dim) return null;
    const groups = (source.groups || {})[dim.key] || [];
    const values = groups.filter((g) => g && g.drop !== true).length;
    const aliases = groups.reduce((n, g) => n + ((g && g.members) || []).length, 0);
    return {
      kind: 'breakdown',
      label: dim.label || dim.key,
      dimKey: dim.key,
      values,
      aliases,
      widgets: widgetsUsingBreakdown(widgets, source.id, dim.key),
      // Nothing is gone until Save — the drawer's Reset still discards all of it.
      // The confirm is about attention, not about the database.
      sentence: `Removes ${values === 1 ? '1 canonical value' : `${int(values)} canonical values`}, `
        + `${aliases === 1 ? '1 alias' : `${int(aliases)} aliases`} and every manual decision in `
        + `“${dim.label || dim.key}” when you save. The sheet itself is untouched.`,
    };
  }

  if (current === 'line_item') {
    const binding = source.binding || {};
    const hand = Object.keys(binding.map || {}).length;
    const excluded = (Array.isArray(binding.exclude) ? binding.exclude : []).length;
    if (!hand && !excluded) return null;
    return {
      kind: 'binding',
      hand,
      excluded,
      sentence: `Clears ${hand ? `${int(hand)} name${hand === 1 ? '' : 's'} routed by hand` : ''}`
        + `${hand && excluded ? ' and ' : ''}`
        + `${excluded ? `${int(excluded)} exclusion${excluded === 1 ? '' : 's'}` : ''}`
        + ': they name a column this source will no longer read.',
    };
  }

  if (current.startsWith('metric:') && nextRole !== current) {
    const key = current.slice(7);
    const used = widgetColumnsUsing(widgets, source.id, key);
    if (!used.length) return null;
    return {
      kind: 'metric',
      metricKey: key,
      widgets: used,
      sentence: `${used.length === 1 ? 'One dashboard block reads' : `${used.length} dashboard blocks read`}`
        + ` this metric: ${used.slice(0, 3).join(', ')}${used.length > 3 ? ` and ${used.length - 3} more` : ''}.`
        + ' Their column stops having a number to show.',
    };
  }

  return null;
}

/** Dashboard blocks whose columns read a metric of this source. */
export function widgetColumnsUsing(widgets, sourceId, metricKey) {
  const prefix = `ds:${sourceId}:`;
  const onSource = (axis) => typeof axis === 'object' && axis
    && typeof axis.dim === 'string' && axis.dim.startsWith(prefix);
  return (Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && (onSource(w.rows) || onSource(w.xAxis)))
    .filter((w) => (w.columns || []).some((c) => c?.source?.field === metricKey)
      || (w.series || []).some((s) => String(s?.expr || '').includes(metricKey)))
    .map((w) => w.title || w.id);
}

/**
 * Give a column a role. Date and line item are single-holder jobs: taking one
 * hands it over rather than leaving two columns claiming to be the date.
 *
 * Returns the next source. Pure — the caller decides whether to ask first
 * (costOfRole) and owns the undo.
 */
export function applyRole(source, column, nextRole, opts = {}) {
  const name = clean(column);
  if (!name) return source;
  const current = roleOf(source, name);
  if (current === nextRole) return source;

  let next = source;
  // Leaving the old role first, so a column can move from breakdown to metric in
  // one step without the dictionary trailing behind it.
  if (current === 'dim') {
    const dim = dimOf(source, name);
    if (dim) next = removeBreakdown(next, dim.key);
  } else if (current === 'date' || current === 'line_item') {
    next = withColumns(next, (cols) => ({ ...cols, [current]: null }));
  } else if (current.startsWith('metric:')) {
    next = withColumns(next, (cols) => {
      const metrics = { ...(cols.metrics || {}) };
      delete metrics[current.slice(7)];
      return { ...cols, metrics };
    });
  }

  if (nextRole === 'date' || nextRole === 'line_item') {
    // Whoever held it loses it — one column, one job, and two dates is not a
    // state worth modelling.
    const held = nextRole === 'date' ? clean(((next.origin || {}).columns || {}).date)
      : clean(((next.origin || {}).columns || {}).line_item);
    if (held && held !== name) next = withColumns(next, (cols) => ({ ...cols, [nextRole]: null }));
    next = withColumns(next, (cols) => ({ ...cols, [nextRole]: name }));
    if (nextRole === 'line_item') next = bindingForColumn(next, source);
  } else if (nextRole === 'dim') {
    next = addBreakdown(next, name, opts.reserved || []);
    const added = ((next.origin || {}).columns || {}).dims.slice(-1)[0];
    if (added && opts.label) next = renameBreakdown(next, added.key, opts.label);
  } else if (nextRole.startsWith('metric:')) {
    const key = nextRole.slice(7);
    next = withColumns(next, (cols) => ({ ...cols, metrics: { ...(cols.metrics || {}), [key]: name } }));
  }
  // 'ignored' is the absence of every branch above: the column was released and
  // nothing claimed it.
  return next;
}

function withColumns(source, fn) {
  const origin = source.origin || {};
  const cols = fn(origin.columns || {});
  const cleaned = { ...cols };
  if (!cleaned.date) delete cleaned.date;
  if (!cleaned.line_item) delete cleaned.line_item;
  return { ...source, origin: { ...origin, columns: cleaned } };
}

/**
 * A line-item COLUMN and "the whole tab is one line item" are the two answers to
 * one question, and the binding stores them differently. Switching between them
 * drops what belonged to the other, because a hand-routed name means nothing
 * once every row goes to the same line item.
 */
function bindingForColumn(next, before) {
  const old = before.binding || {};
  const sameColumn = clean(((before.origin || {}).columns || {}).line_item)
    === clean(((next.origin || {}).columns || {}).line_item);
  const keep = old.mode !== 'single' && sameColumn;
  return { ...next, binding: {
    mode: old.mode === 'single' || !old.mode ? 'id_in_name' : old.mode,
    map: keep ? { ...(old.map || {}) } : {},
    exclude: keep ? [...(Array.isArray(old.exclude) ? old.exclude : [])] : [],
  } };
}

/** Every row goes to one line item. */
export function applySingleLineItem(source, lineItemId) {
  const next = withColumns(source, (cols) => ({ ...cols, line_item: null }));
  return { ...next, binding: { mode: 'single', line_item_id: String(lineItemId || ''), map: {} } };
}

/* ── what is in a column ───────────────────────────────────────────────────── */

/** The profile entry for a column, or null when nothing has measured it yet. */
export function profileFor(profile, column) {
  const list = (profile && Array.isArray(profile.columns)) ? profile.columns : [];
  return list.find((c) => clean(c?.name) === clean(column)) || null;
}

/**
 * The sentence under a column name: what it CONTAINS, never what it is used for.
 * A first sample cell ("Clicks: 0") proved nothing; a span, a total and a value
 * count are the evidence that the sheet was understood.
 *
 * `null` facts mean nothing has measured this column — the screen says so rather
 * than printing a number it does not have.
 */
export function factsFor({ source, column, role, profile, rows, sample }) {
  const p = profileFor(profile, column);
  const sampled = !!(profile && profile.sampled);
  const dim = role === 'dim' ? dimOf(source, column) : null;

  if (role === 'date') {
    const span = dateSpan(rows);
    if (span) return { text: `${span.days} day${span.days === 1 ? '' : 's'}`, detail: `${span.from} → ${span.to}` };
  }
  if (role && role.startsWith('metric:')) {
    const total = metricTotal(rows, role.slice(7));
    // The total is the fact. A single cell beside it ("e.g. 5") is noise — the
    // whole reason the old screen's sample column said nothing.
    if (total !== null) return { text: `${int(total)} in total`, detail: '' };
  }
  if (dim && Array.isArray(rows) && rows.length) {
    const values = new Set();
    for (const r of rows) {
      const v = clean(r?.dims?.[dim.key]);
      if (v) values.add(v);
    }
    if (values.size) {
      return { text: `${int(values.size)} value${values.size === 1 ? '' : 's'}`,
        detail: [...values].slice(0, 3).join(' · ') };
    }
  }
  if (p) {
    const many = p.distinct_capped ? `more than ${int(p.distinct)} values` : `${int(p.distinct)} value${p.distinct === 1 ? '' : 's'}`;
    return {
      text: sampled ? `${many}, in a sample` : many,
      detail: (p.top || []).slice(0, 3).join(' · '),
      blanks: p.blank_rows,
      numericish: p.numericish,
    };
  }
  // Nothing measured this column: the sheet's own first cell is all there is,
  // and saying "the next read will tell you" beats printing a made-up count.
  return { text: sample ? String(sample) : 'Not measured yet',
    detail: sample ? '' : 'The next read will say what is in this column.', unknown: true };
}

function dateSpan(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let from = null; let to = null;
  const seen = new Set();
  for (const r of rows) {
    const d = clean(r?.date);
    if (!d) continue;
    seen.add(d);
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
  }
  return from ? { from, to, days: seen.size } : null;
}

function metricTotal(rows, key) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let total = 0;
  let seen = false;
  for (const r of rows) {
    const v = Number(r?.metrics?.[key]);
    if (Number.isFinite(v)) { total += v; seen = true; }
  }
  return seen ? total : null;
}

/* ── the list ──────────────────────────────────────────────────────────────── */

/**
 * Every column of the tab, with its role, its facts and anything that needs a
 * decision — grouped by the job it does.
 */
export function columnRows({ source, headers, sampleRow, profile, rows, ambiguous = [], duplicates = [] }) {
  const list = (Array.isArray(headers) ? headers : []).map(clean).filter(Boolean);
  const seen = new Set();
  const out = [];
  const ambiguousSet = new Set((ambiguous || []).map(clean));
  const duplicateSet = new Set((duplicates || []).map(clean));
  list.forEach((name, i) => {
    if (seen.has(name)) return;
    seen.add(name);
    const role = roleOf(source, name);
    const sample = clean((sampleRow || [])[i]);
    out.push({
      column: name,
      role,
      dim: role === 'dim' ? dimOf(source, name) : null,
      facts: factsFor({ source, column: name, role, profile, rows, sample }),
      group: role === 'ignored' ? 'off' : (role.startsWith('metric:') ? 'metrics' : 'structure'),
      // A mark means "this needs you", never "we did something clever". A
      // confident badge on seven correct guesses is noise; a mark on the one
      // column nobody can call is the whole point.
      attention: duplicateSet.has(name) ? 'duplicate'
        : (ambiguousSet.has(name) && role === 'ignored') ? 'ambiguous' : null,
    });
  });
  return out;
}

/** The roles offered for a column of this source, custom metrics included. */
export function roleChoices(source) {
  return [
    ['ignored', 'Not imported'],
    ['date', 'Date'],
    ['line_item', 'Line item'],
    ['dim', 'Breakdown'],
    ...metricSlotsFor(source).map((m) => [`metric:${m.key}`, m.label]),
  ];
}

/* ── the four figures ──────────────────────────────────────────────────────── */

/**
 * What the top of the screen says. Every figure is measured or absent — the
 * pre-read state says "after the first read" rather than printing a percentage
 * nobody measured.
 */
export function statusOf({ source, profile, rows, lineItems, runtime, bound, unbound }) {
  const cols = (source?.origin || {}).columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  const single = (source?.binding || {}).mode === 'single';
  const headers = (profile && Array.isArray(profile.columns)) ? profile.columns.length : null;
  const used = (cols.date ? 1 : 0) + (cols.line_item ? 1 : 0)
    + dims.length + Object.keys(cols.metrics || {}).length;

  const size = sizeOf({ source, profile, rows, lineItems, runtime });
  const missing = [];
  if (!cols.date) missing.push('a date column');
  if (!dims.length) missing.push('a breakdown');
  if (!Object.keys(cols.metrics || {}).length) missing.push('a metric');
  if (!single && !cols.line_item) missing.push('a line-item column');
  // Single mode with nobody chosen places no rows at all — the same kind of hole
  // as a missing date column, and it used to be invisible.
  if (single && !String((source?.binding || {}).line_item_id || '').trim()) {
    missing.push('the line item every row goes to');
  }

  return {
    oneRow: ['Day', 'Line item', ...dims.map((d) => d.label || d.key)].join(' × '),
    rowCount: Array.isArray(rows) ? rows.length : null,
    reach: reachOf({ single, cols, bound, unbound, runtime, rows }),
    size,
    used,
    columns: headers,
    missing,
  };
}

function reachOf({ single, cols, bound, unbound, runtime, rows }) {
  if (single) return { text: 'One line item', detail: 'The whole tab goes to it' };
  if (!cols.line_item) return { text: 'Nothing yet', detail: 'No column says which line item', attention: true };
  if (!Array.isArray(rows) || (!Array.isArray(bound) && !Array.isArray(unbound))) {
    return { text: 'After the first read', detail: 'Save reads the sheet and measures it' };
  }
  const boundRows = (bound || []).reduce((n, b) => n + (Number(b?.rows) || 0), 0);
  const unboundRows = (unbound || []).reduce((n, b) => n + (Number(b?.rows) || 0), 0);
  const total = boundRows + unboundRows;
  if (!total) return { text: 'After the first read', detail: 'Save reads the sheet and measures it' };
  const pct = (boundRows / total) * 100;
  const names = (bound || []).length + (unbound || []).length;
  return {
    text: `${pct >= 99.95 ? '100' : pct.toFixed(1)}% of rows`,
    detail: (unbound || []).length
      ? `${(bound || []).length} of ${names} names · ${int(unboundRows)} rows out`
      : `${names} name${names === 1 ? '' : 's'}, all routed`,
    attention: (unbound || []).length > 0,
    unmatched: (unbound || []).length,
  };
}

/**
 * The file this mapping would produce. Measured once a read exists — the size of
 * the file on disk, which dash-gate reports (`runtime.file_bytes`) — and
 * estimated from the profile and the mapped metrics before that. It says which,
 * because an estimate printed as a fact is how a screen starts lying.
 */
export function sizeOf({ source, profile, rows, lineItems, runtime = null, extraColumn = null, forceEstimate = false }) {
  const cols = (source?.origin || {}).columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  const spread = [];
  for (const d of dims) spread.push(distinctFor({ dim: d, profile, rows }));
  if (extraColumn) {
    const p = profileFor(profile, extraColumn);
    spread.push({ label: extraColumn, distinct: p ? p.distinct : null, known: !!p });
  }
  const unknown = spread.some((s) => !s.known);
  const estimated = estimateRows({
    days: 90,
    lineItems: Math.max(1, (lineItems || []).length),
    distinctPerDim: spread.map((s) => s.distinct || 50),
  });
  // `forceEstimate` is how the two halves of "from X to about Y" stay comparable.
  // Measured rows against a 90-day projection is apples to oranges, and printed
  // as one sentence it reads as a forecast when half of it is history.
  const measuredRows = !extraColumn && !forceEstimate && Array.isArray(rows) && rows.length
    ? rows.length : null;
  const fileBytes = measuredRows !== null && Number.isFinite(runtime?.file_bytes) && runtime.file_bytes > 0
    ? runtime.file_bytes : null;
  const blame = spread.map((s) => ({ label: s.label, distinct: s.distinct || 0 }));
  const metrics = Object.keys(cols.metrics || {});
  // The real file when there is one; otherwise the rows (measured or projected)
  // at an estimated cost per row, which is then an estimate and says so.
  const verdict = fileBytes !== null
    ? budgetVerdictForBytes(fileBytes, blame)
    : budgetVerdict(measuredRows === null ? estimated : measuredRows, blame, metrics);
  return {
    ...verdict,
    measured: fileBytes !== null,
    unknown,
    limitMB: Math.round(FILE_LIMIT_BYTES / 1048576),
    worst: [...spread].sort((a, b) => (b.distinct || 0) - (a.distinct || 0))
      .slice(0, 2).map((s) => s.label),
  };
}

function distinctFor({ dim, profile, rows }) {
  const label = dim.label || dim.key;
  if (Array.isArray(rows) && rows.length) {
    const values = new Set();
    for (const r of rows) {
      const v = clean(r?.dims?.[dim.key]);
      if (v) values.add(v);
    }
    if (values.size) return { label, distinct: values.size, known: true };
  }
  const p = profileFor(profile, dim.column);
  if (p) return { label, distinct: p.distinct, known: true };
  return { label, distinct: null, known: false };
}

/* ── what a breakdown gives you ────────────────────────────────────────────── */

/** The 50-value gate, from the one place that owns it. */
export { CARDINALITY_LIMIT } from '../breakdown/dim-coverage';

/** Metric keys this source declares for itself. */
export function customMetricsOf(source) {
  return MetricRegistry.customMetricsOf((source?.origin || {}).columns || {});
}

/** Adding one. Returns { ok, source, key } or { ok:false, error }. */
export function addCustomMetric(source, label, format) {
  const r = MetricRegistry.addCustomMetric((source?.origin || {}).columns || {}, label, format);
  if (!r.ok) return r;
  return { ok: true, key: r.key,
    source: { ...source, origin: { ...(source.origin || {}), columns: r.columns } } };
}

/** Removing one, with the column it was mapped to. */
export function removeCustomMetric(source, key) {
  const columns = MetricRegistry.removeCustomMetric((source?.origin || {}).columns || {}, key);
  return { ...source, origin: { ...(source.origin || {}), columns } };
}

export { DIM_METRIC_SLOTS, mintDimKey };
