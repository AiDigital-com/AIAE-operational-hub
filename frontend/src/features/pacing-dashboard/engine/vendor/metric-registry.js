/**
 * metric-registry.js — the ONE list of metrics a dimension source may carry, and
 * the rules for the ones a person invents.
 *
 * WHY THIS FILE EXISTS. The seven built-in metrics were declared four times, in
 * four places that had already drifted: DIM_METRIC_SLOTS (the mapping UI),
 * SHEET_METRIC_KEYS (the save validator), FIELD_LABELS (the formula/label UI, in
 * which `co` reads "Completes / listens" while the slot says "Completes") and a
 * row of hardcoded <Th> in the Breakdown panel. Adding an eighth metric meant
 * finding all four, and the failure mode of missing one is the worst kind: a
 * metric that saves and reads but is never SUMMED renders a confident 0 rather
 * than an error (widget-data ZERO_FLOW/addFact).
 *
 * So the list, the key rule, the formats and the label lookup live here, and both
 * runtimes import THIS file:
 *   - dash-gate/lib/dim-sources.mjs decides which keys may be STORED,
 *   - the workspace mapping screen, widget columns and dim sums decide what is
 *     OFFERED, SUMMED and LABELLED.
 * Browser/Vite: globalThis.MetricRegistry; Node: module.exports.
 *
 * SCOPE. This is about a dimension source's own metric COLUMNS. It is not the
 * pacing's metric vocabulary: a custom metric has no plan, no goal, no margin and
 * no rate, so it never enters pacing math, the canonical bases (VCR/ACR/CPM) or a
 * derived ratio. It is a number read from a sheet, summed, and shown.
 */
(function (root) {
"use strict";

// The seven that every source may map, in the order they are offered. `dc` is
// deliberately absent: client cost is derived from spend and a margin, never
// imported (see the note above DIM_METRIC_SLOTS' old home).
var BUILT_IN = [
  { key: 'im', label: 'Impressions', alias: 'impressions', format: 'int' },
  { key: 'cl', label: 'Clicks', alias: 'clicks', format: 'int' },
  { key: 'sp', label: 'Spend', alias: 'spend', format: 'money' },
  { key: 'co', label: 'Completes', alias: 'completes', format: 'int' },
  { key: 'cv', label: 'Conversions', alias: 'conversions', format: 'int' },
  { key: 'pc', label: 'Post-click conv.', alias: null, format: 'int' },
  { key: 'pv', label: 'Post-view conv.', alias: null, format: 'int' }
];

var BUILT_IN_KEYS = BUILT_IN.map(function (m) { return m.key; });

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

/** Every metric this source may map: the seven, then its own, in that order. */
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
