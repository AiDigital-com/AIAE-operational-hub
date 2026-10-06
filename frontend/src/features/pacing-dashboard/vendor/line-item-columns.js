/**
 * line-item-columns.js — the Line Items block's column catalogue and the shape of its
 * settings (Line Items settings spec 2026-10-01, Part B).
 *
 * Pure, dependency-free, ES5. dash-gate requires it (lib/widgets-validate.mjs validates an
 * incoming `display.lineItems` with normLineItems); the workspace imports it through the
 * alias door workspace/src/lib/dashboard/line-item-columns.js, which adds the cell readers.
 * Browser: global `LineItemColumns`. Node: module.exports.
 *
 *   display.lineItems = {
 *     columns: ['margin', 'spend', 'units', 'pacing', 'rate', 'conv'],   // display order, 1..8 distinct keys
 *     sort:    { key: 'default' | <column key> | 'name' | 'channel' | 'flightEnd', dir: 'asc' | 'desc' },
 *     view:    'all' | 'byChannel',
 *     rows:    6,                                                          // 3..40
 *   }
 *
 * Absent key = today's render. All four keys are required when the object is present; `null`
 * removes the key. `conv` alone is refused (it renders nothing on a pacing without conversions).
 */
(function (root) {
'use strict';

var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
function freezeDeep(v) {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (var k in v) if (has(v, k)) freezeDeep(v[k]);
  }
  return v;
}

/** The catalogue, in catalogue order. `label` is the EDITOR label; the cell labels keep the
 *  card's dynamic rules (basisLabel, rateLabel, completionLabelForLI) in the workspace door. */
var COLUMNS = freezeDeep([
  { key: 'margin', label: 'Margin', sortable: true },
  { key: 'spend', label: 'Spend / Cost Bud.', sortable: true },
  { key: 'units', label: 'Units', sortable: true },
  { key: 'pacing', label: 'Pacing', sortable: true },
  { key: 'rate', label: 'Cost per unit', sortable: true },
  { key: 'conv', label: 'Conv', sortable: true },
  { key: 'ctr', label: 'CTR', sortable: true },
  { key: 'vcr', label: 'VCR', sortable: true },
  { key: 'cpa', label: 'CPA', sortable: true },
  { key: 'clicks', label: 'Clicks', sortable: true },
  { key: 'views', label: 'Views', sortable: true },
  { key: 'neededPerDay', label: 'Needed / day', sortable: true },
  { key: 'daysLeft', label: 'Days left', sortable: true },
  { key: 'budget', label: 'Client budget', sortable: true }
]);
var COLUMN_KEYS = Object.freeze(COLUMNS.map(function (c) { return c.key; }));
var DEFAULT_COLUMNS = Object.freeze(['margin', 'spend', 'units', 'pacing', 'rate', 'conv']);
var MAX_COLUMNS = 8;
var ROWS_MIN = 3;
var ROWS_MAX = 40;
var SORT_FIELDS = Object.freeze(['default', 'name', 'channel', 'flightEnd']);
var SORT_FIELD_LABELS = Object.freeze({ default: 'Default order', name: 'Name', channel: 'Channel', flightEnd: 'Flight end' });
var SORT_DIRS = Object.freeze(['asc', 'desc']);
var VIEWS = Object.freeze(['all', 'byChannel']);
var DEFAULTS = freezeDeep({ columns: DEFAULT_COLUMNS.slice(), sort: { key: 'default', dir: 'asc' }, view: 'all', rows: 6 });
var KEYS = ['columns', 'sort', 'view', 'rows'];

var isPlainObject = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
var isColumnKey = function (k) { return typeof k === 'string' && COLUMN_KEYS.indexOf(k) >= 0; };
var short = function (v) { return String(v).slice(0, 40); };

/**
 * Validate and normalise one `display.lineItems` value.
 * @returns {{ok:true, value:object|null}|{ok:false, error:string}} the value is a FRESH object in
 *   canonical key order; the error is one line a user reads in the drawer's save error.
 */
function normLineItems(value) {
  if (value === null) return { ok: true, value: null };
  if (!isPlainObject(value)) return { ok: false, error: 'must be an object or null' };
  for (var i = 0; i < KEYS.length; i++) {
    if (!has(value, KEYS[i])) return { ok: false, error: 'missing key "' + KEYS[i] + '"' };
  }
  for (var k in value) {
    if (has(value, k) && KEYS.indexOf(k) < 0) return { ok: false, error: 'unknown key "' + short(k) + '"' };
  }
  var cols = value.columns;
  if (!Array.isArray(cols) || cols.length < 1 || cols.length > MAX_COLUMNS) {
    return { ok: false, error: 'columns must be an array of 1 to ' + MAX_COLUMNS + ' column keys' };
  }
  var seen = {};
  for (var c = 0; c < cols.length; c++) {
    if (!isColumnKey(cols[c])) return { ok: false, error: 'unknown column "' + short(cols[c]) + '"' };
    if (has(seen, cols[c])) return { ok: false, error: 'duplicate column "' + cols[c] + '"' };
    seen[cols[c]] = true;
  }
  var other = false;
  for (var o = 0; o < cols.length; o++) if (cols[o] !== 'conv') other = true;
  if (!other) return { ok: false, error: 'columns need a column other than conv' };
  var sort = value.sort;
  if (!isPlainObject(sort) || !has(sort, 'key') || !has(sort, 'dir') || Object.keys(sort).length !== 2) {
    return { ok: false, error: 'sort must be an object { key, dir }' };
  }
  if (!(SORT_FIELDS.indexOf(sort.key) >= 0 || isColumnKey(sort.key))) {
    return { ok: false, error: 'unknown sort key "' + short(sort.key) + '"' };
  }
  if (SORT_DIRS.indexOf(sort.dir) < 0) return { ok: false, error: 'sort.dir must be asc or desc' };
  if (VIEWS.indexOf(value.view) < 0) return { ok: false, error: 'view must be all or byChannel' };
  var rows = value.rows;
  if (typeof rows !== 'number' || !isFinite(rows) || Math.floor(rows) !== rows || rows < ROWS_MIN || rows > ROWS_MAX) {
    return { ok: false, error: 'rows must be an integer from ' + ROWS_MIN + ' to ' + ROWS_MAX };
  }
  return { ok: true, value: { columns: cols.slice(), sort: { key: sort.key, dir: sort.dir }, view: value.view, rows: rows } };
}

/** Absent, null and the default object are the same setting: today's render. */
function isDefault(value) {
  if (value === undefined || value === null) return true;
  var r = normLineItems(value);
  if (!r.ok) return false;
  var v = r.value;
  if (v.columns.length !== DEFAULTS.columns.length) return false;
  for (var i = 0; i < v.columns.length; i++) if (v.columns[i] !== DEFAULTS.columns[i]) return false;
  return v.sort.key === DEFAULTS.sort.key && v.sort.dir === DEFAULTS.sort.dir
    && v.view === DEFAULTS.view && v.rows === DEFAULTS.rows;
}

var api = Object.freeze({
  COLUMNS: COLUMNS, COLUMN_KEYS: COLUMN_KEYS, DEFAULT_COLUMNS: DEFAULT_COLUMNS,
  MAX_COLUMNS: MAX_COLUMNS, ROWS_MIN: ROWS_MIN, ROWS_MAX: ROWS_MAX,
  SORT_FIELDS: SORT_FIELDS, SORT_FIELD_LABELS: SORT_FIELD_LABELS, SORT_DIRS: SORT_DIRS, VIEWS: VIEWS,
  DEFAULTS: DEFAULTS,
  normLineItems: normLineItems, isDefault: isDefault
});
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.LineItemColumns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
