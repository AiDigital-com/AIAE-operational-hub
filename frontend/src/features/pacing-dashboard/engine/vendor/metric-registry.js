/**
 * metric-registry.js — the ONE list of mart metrics, and the rules for the ones a person
 * invents.
 *
 * WHY THIS FILE EXISTS. Fourteen numeric columns exist in `platform_mart`; twelve were
 * selected by the refresh SQL and eight reached the dashboard. The four video ones were
 * fetched and dropped by the builder because the metric list was hand-kept in ten places
 * (spec 2026-09-08-mart-metrics-in-widgets §2). This file is the list; the builder, dash-gate
 * and the workspace derive theirs from it. Two mirrors stay hand-kept and test-pinned:
 * `FLOW_FIELDS` in shared/report-v2.js (a standalone UMD) and the metric map in the n8n
 * `Code: Build BQ Query` node (tests/dim-query-test.mjs).
 *
 * The custom-metric half (m1..m4, the keys a Google-Sheet source may invent) is unchanged.
 * Browser/Vite: globalThis.MetricRegistry; Node: module.exports.
 *
 * SCOPE. A metric here is a number read from a mart column, summed, and shown. It has no
 * plan, no goal, no margin; it never enters pacing math or a canonical rate.
 */
(function (root) {
"use strict";

// The four marts a pacing or a dimension source can read, by THIS registry's own short ids.
// The two delivery ids are exactly ALLOWED_DATA_SOURCES (dash-gate/lib/data-config.mjs:5). The
// two devices ids are the LAST PATH SEGMENT of the dim-sources catalogue's table names: dash-gate
// spells those dataset-qualified and literally (`devices.devices_mart`, dim-sources.mjs), while the
// n8n `Code: Build BQ Query` node strips the dataset (its `shortTable`) and hands the builder the
// SHORT id as `dimSources[].table`. No existing id namespace holds all four, so a caller holding a qualified
// name must strip the dataset before asking here — `dimKeysFor` throws rather than guess.
var T_PM = 'platform_mart';
var T_PMA = 'platform_mart_adjustments_view';
var T_DEV = 'devices_mart';
var T_DEVA = 'devices_mart_manual_adjustments_view';
var TABLES = Object.freeze([T_PM, T_PMA, T_DEV, T_DEVA]);
var ALL_FOUR = TABLES;
var NO_ADJUSTMENTS_VIEW = Object.freeze([T_PM, T_DEV, T_DEVA]);   // reach: absent from the delivery adjustments view (INFORMATION_SCHEMA, 2026-09-08)
var DEVICES_ONLY = Object.freeze([T_DEV, T_DEVA]);                // viewable_impressions

// One entry per metric, ENGINE order: the classic eight first (their key order in every
// per-day row and every sum), then the six the 2026-09-08 spec added to the delivery
// universe, then the one devices-only column.
//   key       the two-letter engine key (a formula identifier, a value's `metric`)
//   column    the mart column
//   label     the name a person reads (sheet role, dim column, the picker for the new ones —
//             the picker keeps its own longer spelling for `co`)
//   alias     the COLUMN_ALIASES bucket (sheet-source-norm.js:14-21) a Google-Sheet header is
//             matched through; null → the EXTRA_METRIC_ALIASES fallback keyed by metric KEY
//   format    'int' | 'money' — the same tokens the widget column format enum uses
//   tables    which of the four marts carry the column
//   delivery  a field of the widget delivery universe (FIELDS_DAILY / FLOW_FIELDS)
//   dim       written into dimension-source rows
//   sheet     a role a Google-Sheet source may map (dc is derived, never imported)
//   tip       the picker's one-line note, or null
//   provisional  a sentence for code readers, or null; printed nowhere
function m(o) { return Object.freeze(o); }
var METRICS = Object.freeze([
  m({ key: 'im', column: 'impressions', label: 'Impressions', alias: 'impressions', format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'cl', column: 'clicks', label: 'Clicks', alias: 'clicks', format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'sp', column: 'spend', label: 'Spend', alias: 'spend', format: 'money',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'co', column: 'completes', label: 'Completes', alias: 'completes', format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'cv', column: 'conversions', label: 'Conversions', alias: 'conversions', format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'pc', column: 'post_click_conversions', label: 'Post-click conv.', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  m({ key: 'pv', column: 'post_view_conversions', label: 'Post-view conv.', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true, tip: null, provisional: null }),
  // Client cost is derived from spend and a margin in every sheet path, never imported —
  // the rule the old BUILT_IN list carried by omission.
  m({ key: 'dc', column: 'dynamic_cost', label: 'Client cost', alias: null, format: 'money',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: false, tip: null, provisional: null }),
  m({ key: 'st', column: 'starts', label: 'Video starts', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true,
      tip: 'Video and audio lines only.', provisional: null }),
  m({ key: 'q1', column: 'first_quartiles', label: 'First quartiles', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true,
      tip: 'Video and audio lines only.', provisional: null }),
  m({ key: 'q2', column: 'midpoints', label: 'Midpoints', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true,
      tip: 'Video and audio lines only.', provisional: null }),
  m({ key: 'q3', column: 'third_quartiles', label: 'Third quartiles', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true,
      tip: 'Video and audio lines only.', provisional: null }),
  // PROVISIONAL (owner, 2026-09-08): summed like a count; whether the sum means anything is
  // unverified. The owner checks it on live data after the build and names it then. What is
  // known: each platform reports reach per creative and day (the sample rows, 2026-09-08), and
  // DV360 and TTD report none at all (dimension-sources spec 2026-08-09 §10).
  m({ key: 'rc', column: 'reach', label: 'Reach', alias: null, format: 'int',
      tables: NO_ADJUSTMENTS_VIEW, delivery: true, dim: true, sheet: true,
      // The tip leads with the load-bearing half: the Spotlight clips a long tip with an
      // ellipsis, and «DV360 and TTD report none» is the sentence a reader must not lose.
      tip: 'DV360 and TTD report none; other platforms report reach per creative and day, and this sums those rows.',
      provisional: 'PROVISIONAL (owner, 2026-09-08): summed like a count; whether the sum means anything is unverified. The owner checks it on live data after the build and names it then.' }),
  m({ key: 'lc', column: 'link_clicks', label: 'Link clicks', alias: null, format: 'int',
      tables: ALL_FOUR, delivery: true, dim: true, sheet: true,
      tip: 'Reported by social platforms only.', provisional: null }),
  m({ key: 'vi', column: 'viewable_impressions', label: 'Viewable impressions', alias: null, format: 'int',
      tables: DEVICES_ONLY, delivery: false, dim: true, sheet: true,
      tip: 'Carried by the devices source only.', provisional: null }),
]);

var BY_KEY = Object.create(null);
for (var mi = 0; mi < METRICS.length; mi++) BY_KEY[METRICS[mi].key] = METRICS[mi];

/** One entry by key, or null. Own-property: `byKey('constructor')` is null, not a function. */
function byKey(key) {
  return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(BY_KEY, key)) ? BY_KEY[key] : null;
}

/** Does this mart carry this metric's column? An unknown table or key carries nothing. */
function carries(tableId, key) {
  var e = byKey(key);
  return !!e && typeof tableId === 'string' && e.tables.indexOf(tableId) >= 0;
}

/** Keys → columns. Throws on an unknown key: a column list built from a typo would name a
 *  column BigQuery does not have and fail the refresh far from the typo. */
function columnsOf(keys) {
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var e = byKey(keys[i]);
    if (!e) throw new Error('metric-registry: unknown metric key ' + JSON.stringify(keys[i]));
    out.push(e.column);
  }
  return out;
}

function keysWhere(pred) {
  var out = [];
  for (var i = 0; i < METRICS.length; i++) if (pred(METRICS[i])) out.push(METRICS[i].key);
  return out;
}

var DELIVERY_KEYS = Object.freeze(keysWhere(function (e) { return e.delivery; }));
// The keys the availability inventory judges — the six that joined the delivery universe on
// 2026-09-08. The classic eight are exempt and behave as they always have (a 0 is a 0).
var ADDED_DELIVERY_KEYS = Object.freeze(['st', 'q1', 'q2', 'q3', 'rc', 'lc']);
// The columns whose NULL means «nothing» rather than a value: a NULL pad where a table lacks
// the column, or a NULL-preserving SUM over a platform that reports nothing. The splitter
// drops them, the normalisers write them only when non-zero.
var SPARSE_COLUMNS = Object.freeze(columnsOf(ADDED_DELIVERY_KEYS.concat(['vi'])));
// The refresh query's column order: the twelve selected before 2026-09-08 in their SQL order,
// then the three new columns. tests/dim-query-test.mjs pins the node to it.
var SQL_ORDER_KEYS = Object.freeze(['im', 'cl', 'sp', 'st', 'q1', 'q2', 'q3', 'co', 'cv', 'pc', 'pv', 'dc', 'rc', 'lc', 'vi']);

/** The delivery keys a pacing on this source table carries. Unknown → the raw mart, the
 *  same fallback the query node's safeSource and dim-sources' dimTableFor take — a legacy
 *  pacing config may carry no `data.source` at all, and the raw mart is what it reads. */
function deliveryKeysFor(tableId) {
  var t = TABLES.indexOf(tableId) >= 0 ? tableId : T_PM;
  return keysWhere(function (e) { return e.delivery && e.tables.indexOf(t) >= 0; });
}

/** Every dim-row key a dimension source on this table carries. THROWS on an id that is not
 *  one of TABLES — unlike deliveryKeysFor, a dimension caller always knows its table, and a
 *  silent raw-mart fallback would answer a dataset-qualified `devices.devices_mart` with the
 *  platform-mart list, dropping `vi` without a trace. Strip the dataset before calling. */
function dimKeysFor(tableId) {
  if (TABLES.indexOf(tableId) < 0) {
    throw new Error('metric-registry: unknown table id ' + JSON.stringify(tableId));
  }
  return keysWhere(function (e) { return e.dim && e.tables.indexOf(tableId) >= 0; });
}

// The roles a Google-Sheet source may map, in offer order: the old seven first, in the order
// the mapping screen has always shown them, then the seven new. `{key,label,alias,format}`,
// the shape every existing importer reads.
var BUILT_IN = Object.freeze(METRICS.filter(function (e) { return e.sheet; }).map(function (e) {
  return Object.freeze({ key: e.key, label: e.label, alias: e.alias, format: e.format });
}));

var BUILT_IN_KEYS = Object.freeze(BUILT_IN.map(function (e) { return e.key; }));

// A custom key is `m` + digits and nothing else. Narrow on purpose: it cannot
// collide with a built-in metric, with a derived rate (ctr/cpm/cpv/vcr/acr), with
// a plan field or with anything the formula parser already knows, so a custom
// metric can never shadow a number that means something else.
//
// `m`, not `c`: a widget's COLUMNS are already minted c1, c2, c3 (topNWidgetFor),
// and a metric key called c1 sitting beside a column called c1 in the same object
// is a confusion waiting to be read as a bug.
// Exactly the keys nextCustomKey can mint — no wider. A rule that ALLOWED m99
// while the product only ever creates m1..m4 is a stored shape nothing in the UI
// can reach, and therefore a shape nothing in the UI is tested against.
var CUSTOM_KEY_RE = /^m[1-4]$/;
var MAX_CUSTOM_PER_SOURCE = 4;   // must stay <= the highest key CUSTOM_KEY_RE allows
var MAX_LABEL_LEN = 40;

// What a number LOOKS like. The same two tokens the widget column format enum
// uses, so a metric's default format is a valid column format by construction.
var FORMATS = ['int', 'money'];

function str(v, max) {
  if (typeof v !== 'string') return null;
  var s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function isBuiltInKey(key) {
  return BUILT_IN_KEYS.indexOf(key) >= 0;
}

function isCustomKey(key) {
  return typeof key === 'string' && CUSTOM_KEY_RE.test(key);
}

/**
 * The custom metrics a source declares, cleaned. Anything malformed is DROPPED
 * rather than repaired: a metric with no label would render as `m1` in a widget
 * column, which is not a metric anybody asked for.
 */
function customMetricsOf(columns) {
  var raw = columns && columns.custom_metrics;
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var m = raw[i];
    if (!m || typeof m !== 'object') continue;
    var key = typeof m.key === 'string' ? m.key : '';
    if (!isCustomKey(key) || seen[key]) continue;
    var label = str(m.label, MAX_LABEL_LEN);
    if (!label) continue;
    var format = FORMATS.indexOf(m.format) >= 0 ? m.format : 'int';
    seen[key] = 1;
    out.push({ key: key, label: label, format: format });
    if (out.length >= MAX_CUSTOM_PER_SOURCE) break;
  }
  return out;
}

/** Every metric this source may map: the fourteen sheet roles, then its own, in that order. */
function metricsOf(columns) {
  return BUILT_IN.concat(customMetricsOf(columns));
}

/** The keys this source may store in `columns.metrics`. */
function allowedKeys(columns) {
  return metricsOf(columns).map(function (m) { return m.key; });
}

/** One metric by key, or null. Callers that render a label MUST use this. */
function metricOf(columns, key) {
  var list = metricsOf(columns);
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}

/** The label to print, never the bare key — `m1` in a column header is a bug. */
function labelOf(columns, key) {
  var m = metricOf(columns, key);
  return m ? m.label : String(key == null ? '' : key);
}

/** The default column format for a metric. */
function formatOf(columns, key) {
  var m = metricOf(columns, key);
  return m ? m.format : 'int';
}

/**
 * The next free custom key for a source. Reuses a hole rather than counting:
 * removing m1 and adding a metric must not mint m3 and leave m1 unclaimed.
 */
function nextCustomKey(columns) {
  var taken = {};
  var list = customMetricsOf(columns);
  for (var i = 0; i < list.length; i++) taken[list[i].key] = 1;
  for (var n = 1; n <= MAX_CUSTOM_PER_SOURCE; n++) {
    if (!taken['m' + n]) return 'm' + n;
  }
  return null;
}

/**
 * Declaring one. Returns { ok, columns } or { ok:false, error } — the error is
 * the sentence the screen shows, so it names the limit rather than the rule.
 */
function addCustomMetric(columns, label, format) {
  var cols = columns && typeof columns === 'object' ? columns : {};
  var name = str(label, MAX_LABEL_LEN);
  if (!name) return { ok: false, error: 'Give the metric a name.' };
  var list = customMetricsOf(cols);
  for (var i = 0; i < list.length; i++) {
    if (list[i].label.toLowerCase() === name.toLowerCase()) {
      return { ok: false, error: 'This source already has a metric called "' + list[i].label + '".' };
    }
  }
  for (var b = 0; b < BUILT_IN.length; b++) {
    if (BUILT_IN[b].label.toLowerCase() === name.toLowerCase()) {
      return { ok: false, error: '"' + BUILT_IN[b].label + '" is already a metric — use it instead.' };
    }
  }
  if (list.length >= MAX_CUSTOM_PER_SOURCE) {
    return { ok: false, error: 'A source can carry ' + MAX_CUSTOM_PER_SOURCE + ' metrics of its own.' };
  }
  var key = nextCustomKey(cols);
  if (!key) return { ok: false, error: 'A source can carry ' + MAX_CUSTOM_PER_SOURCE + ' metrics of its own.' };
  var next = {};
  for (var k in cols) if (Object.prototype.hasOwnProperty.call(cols, k)) next[k] = cols[k];
  next.custom_metrics = list.concat([{ key: key, label: name,
    format: FORMATS.indexOf(format) >= 0 ? format : 'int' }]);
  return { ok: true, columns: next, key: key };
}

/**
 * Removing one takes its column mapping with it. Leaving `metrics.m1` behind
 * would store a key nothing can name, which the validator then refuses — the
 * save would fail on a metric the person had just deleted.
 */
function removeCustomMetric(columns, key) {
  var cols = columns && typeof columns === 'object' ? columns : {};
  var list = customMetricsOf(cols).filter(function (m) { return m.key !== key; });
  var next = {};
  for (var k in cols) if (Object.prototype.hasOwnProperty.call(cols, k)) next[k] = cols[k];
  if (list.length) next.custom_metrics = list;
  else delete next.custom_metrics;
  if (next.metrics && Object.prototype.hasOwnProperty.call(next.metrics, key)) {
    var metrics = {};
    for (var m in next.metrics) {
      if (Object.prototype.hasOwnProperty.call(next.metrics, m) && m !== key) metrics[m] = next.metrics[m];
    }
    next.metrics = metrics;
  }
  return next;
}

var MetricRegistry = {
  METRICS: METRICS,
  TABLES: TABLES,
  byKey: byKey,
  carries: carries,
  columnsOf: columnsOf,
  DELIVERY_KEYS: DELIVERY_KEYS,
  ADDED_DELIVERY_KEYS: ADDED_DELIVERY_KEYS,
  SPARSE_COLUMNS: SPARSE_COLUMNS,
  SQL_ORDER_KEYS: SQL_ORDER_KEYS,
  deliveryKeysFor: deliveryKeysFor,
  dimKeysFor: dimKeysFor,
  BUILT_IN: BUILT_IN,
  BUILT_IN_KEYS: BUILT_IN_KEYS,
  CUSTOM_KEY_RE: CUSTOM_KEY_RE,
  MAX_CUSTOM_PER_SOURCE: MAX_CUSTOM_PER_SOURCE,
  MAX_LABEL_LEN: MAX_LABEL_LEN,
  FORMATS: FORMATS,
  isBuiltInKey: isBuiltInKey,
  isCustomKey: isCustomKey,
  customMetricsOf: customMetricsOf,
  metricsOf: metricsOf,
  allowedKeys: allowedKeys,
  metricOf: metricOf,
  labelOf: labelOf,
  formatOf: formatOf,
  nextCustomKey: nextCustomKey,
  addCustomMetric: addCustomMetric,
  removeCustomMetric: removeCustomMetric
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetricRegistry;
} else {
  root.MetricRegistry = MetricRegistry;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
