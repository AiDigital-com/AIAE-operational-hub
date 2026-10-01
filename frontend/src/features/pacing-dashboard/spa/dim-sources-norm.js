// workspace/src/lib/settings/dim-sources-norm.js
//
// Toggle <-> stored-shape conversion for the Settings · Data dimension-source
// checkboxes (spec docs/superpowers/specs/2026-08-09-dimension-sources-design.md
// §3, §9 wave 1). Wave 1 exposes one catalogue key; the stored value is already
// the generic array, so wave 3 can add sheet-backed sources without a migration.
//
// The rebuilt entry is byte-identical to what the server stores, key order
// included (safeDimSource in dash-gate/lib/dim-sources.mjs rebuilds it in this
// same order). That matters: the drawer fingerprints the array with
// JSON.stringify for its dirty check, so a round trip that reordered the keys
// would leave the drawer dirty with nothing to save.
//
// Wave 3 note: this map owns only the built-in keys below. Entries added by the
// "+ Add source" UI are not ours, and that wave has to carry them through here
// rather than let a checkbox drop them.
//
// No React, no DOM — plain ESM, so host tests import it directly.

import { breakdownState, breakdownServable } from './dim-coverage.js';
import MetricRegistry from '@shared/metric-registry';

// What each built-in source offers as an axis: which dimension it carries, and
// how to name it on screen. Mirrors DIM_SOURCE_CATALOG in
// dash-gate/lib/dim-sources.mjs — the server owns the table and the column, this
// owns only the words. Adding a source means adding it here as well, or it
// loads and then has no way to be picked.
export const DIM_SOURCE_AXES = Object.freeze({
  devices: Object.freeze({ dim: 'device_type', label: 'Device', note: 'from DSP',
    // The keys this catalogued source carries beyond the delivery universe (viewable
    // impressions today), offered in formulas on its grains (spec 2026-09-08 §3.5).
    extraMetrics: Object.freeze(MetricRegistry.dimKeysFor('devices_mart').filter((k) => !MetricRegistry.DELIVERY_KEYS.includes(k))) }),
});

/** A catalogued bq_mart source's own keys outside the delivery universe, with labels. */
export function catalogExtraMetrics(source) {
  if (!source || source.loader !== 'bq_mart') return [];
  const catalog = source.origin && source.origin.catalog;
  // Own-property, this file's rule at `dimAxisLabel` and its two neighbours: a catalog name
  // like `constructor` must not answer for a source that does not exist.
  if (!Object.prototype.hasOwnProperty.call(DIM_SOURCE_AXES, catalog)) return [];
  const entry = DIM_SOURCE_AXES[catalog];
  if (!entry.extraMetrics) return [];
  return entry.extraMetrics.map((key) => ({ key, label: MetricRegistry.byKey(key).label }));
}

/**
 * The same question of a source that MAPS its columns by hand (a Google Sheet): which of the
 * registry's roles it maps that are not delivery fields — `vi` today, and nothing else.
 *
 * Without this the mapping screen offers «Viewable impressions» (it is a `sheet` role), the
 * loader writes `metrics.vi` on every row, and no reader ever asks for it: the column is
 * stored and silently unread. The delivery keys are not here because they arrive through the
 * shared dim set; the source's own `m1..m4` come from `customMetricsOf`.
 */
export function mappedExtraMetrics(source) {
  const mapped = source && source.origin && source.origin.columns
    ? source.origin.columns.metrics : null;
  if (!mapped || typeof mapped !== 'object') return [];
  const out = [];
  for (const key of Object.keys(mapped)) {
    const entry = MetricRegistry.byKey(key);
    if (entry && !entry.delivery) out.push({ key, label: entry.label });
  }
  return out;
}

// Derived, so the two lists cannot drift apart.
const BUILT_IN = Object.keys(DIM_SOURCE_AXES);

/**
 * Toggle map -> the array stored in config.data.dim_sources.
 *
 * `existing` is the stored array, and passing it is NOT optional once a pacing
 * can hold a source this map does not own. Rebuilt from BUILT_IN alone, a tick on
 * an unrelated checkbox erased every sheet-backed source in the pacing — a silent
 * data loss on a click that has nothing to do with them. The file's own header
 * has warned about this since wave 1; this is that warning honoured.
 *
 * Built-ins are rebuilt from the toggles (that is what a checkbox means); every
 * other entry is carried through untouched, in its original order.
 */
export function dimSourcesFromToggles(toggles, existing) {
  const t = toggles || {};
  const kept = (Array.isArray(existing) ? existing : [])
    .filter((d) => d && typeof d === 'object' && !BUILT_IN.includes(d.id));
  const builtIn = BUILT_IN
    .filter((k) => t[k] === true)
    .map((k) => ({ id: k, loader: 'bq_mart', origin: { catalog: k } }));
  return [...builtIn, ...kept];
}

/**
 * Axis options for the widget pickers, as [dimKey, label] pairs.
 *
 * Driven by what actually LOADED, not by what is configured: a source whose file
 * is missing or stale is absent from this map, and offering its axis would give
 * the user an empty widget with nothing to explain it. Same presence rule the
 * Breakdown panel uses.
 */
export function dimSourceAxisOptions(loaded, configured) {
  const map = loaded && typeof loaded === 'object' ? loaded : {};
  const hasRows = (id) => {
    if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
    const entry = map[id];
    return !!(entry && Array.isArray(entry.rows) && entry.rows.length > 0);
  };
  const out = [];
  for (const id of BUILT_IN) {
    if (!hasRows(id)) continue;
    const axis = DIM_SOURCE_AXES[id];
    out.push([`ds:${id}:${axis.dim}`, `${axis.label} (${axis.note})`]);
  }
  // Sheet-backed sources are per pacing, so their axes come from the stored
  // config rather than from a table in this file — one entry per mapped
  // dimension, since such a source may carry several.
  for (const src of Array.isArray(configured) ? configured : []) {
    if (!src || typeof src !== 'object' || src.loader !== 'sheet') continue;
    if (BUILT_IN.includes(src.id) || !hasRows(src.id)) continue;
    const dims = ((src.origin || {}).columns || {}).dims;
    for (const d of Array.isArray(dims) ? dims : []) {
      if (!d || !d.key) continue;
      // Rows exist, but not for THIS breakdown: its column was re-pointed since
      // the read, or it left the sheet. Offering the axis would build a widget
      // on values that answer a different question (spec §6.2).
      if (!breakdownServable(map, src.id, d.key)) continue;
      const label = d.label || d.key;
      out.push([`ds:${src.id}:${d.key}`, src.title ? `${label} (${src.title})` : label]);
    }
  }
  return out;
}

/**
 * How a widget axis names itself in a header. A namebuilder dim is its own key
 * and reads fine; a dimension-source key is machine text ('ds:devices:device_type')
 * and must not reach a column header.
 */
export function dimAxisLabel(dimKey, configured) {
  if (typeof dimKey !== 'string' || !dimKey.startsWith('ds:')) return dimKey || '';
  const cut = dimKey.indexOf(':', 3);
  const id = cut < 0 ? '' : dimKey.slice(3, cut);
  const dim = cut < 0 ? '' : dimKey.slice(cut + 1);
  if (Object.prototype.hasOwnProperty.call(DIM_SOURCE_AXES, id)) return DIM_SOURCE_AXES[id].label;
  // A per-pacing source names its own dimensions. Found by scanning, not by a
  // keyed lookup, so an id like 'constructor' cannot answer for a real source.
  const src = (Array.isArray(configured) ? configured : [])
    .find((s) => s && typeof s === 'object' && s.id === id);
  const dims = ((src || {}).origin || {}).columns;
  const found = ((dims || {}).dims || []).find((d) => d && d.key === dim);
  // Falling back to the machine key is deliberate: a header reading
  // 'ds:dv_apps:app' is ugly but truthful, where a blank or a guessed word would
  // hide that the source behind this widget is gone.
  return (found && found.label) || dimKey;
}

/**
 * …and the second line under that name: WHOSE file these values come from
 * (section-widget parity 2026-09-04). The legacy Breakdown tab bar carries it — `from DSP`
 * under Device, the source's own title under a configured one — and it is the one place a
 * reader learns that two similarly named tabs read different data.
 *
 * Null for a key that is not a dimension source, and null when a per-pacing source has no
 * title: a chip with no second line stays one line, which is the shape every other chip on
 * that row has.
 */
export function dimSourceNote(dimKey, configured) {
  if (typeof dimKey !== 'string' || !dimKey.startsWith('ds:')) return null;
  const cut = dimKey.indexOf(':', 3);
  const id = cut < 0 ? '' : dimKey.slice(3, cut);
  if (Object.prototype.hasOwnProperty.call(DIM_SOURCE_AXES, id)) return DIM_SOURCE_AXES[id].note || null;
  // Scanned, not looked up by key, for dimAxisLabel's reason: an id like 'constructor' must
  // not answer for a real source.
  const src = (Array.isArray(configured) ? configured : [])
    .find((s) => s && typeof s === 'object' && s.id === id);
  return (src && src.title) || null;
}

/** Stored array -> toggle map. Anything unreadable reads as all-off. */
export function togglesFromDimSources(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = {};
  for (const k of BUILT_IN) {
    out[k] = arr.some((d) => d && d.id === k && d.loader === 'bq_mart');
  }
  return out;
}

/**
 * Why a tile on a dimension-source axis has nothing to draw — or null when the
 * source is there and the emptiness means something else.
 *
 * The validator stopped refusing a widget whose source is absent (2026-08-11):
 * a namebuilder dim the pacing lacks has always been accepted and drawn empty,
 * removal was impossible while one save rejected the lot, and layouts are meant
 * to travel between pacings. What it must not do is leave an empty table with
 * nothing to explain it — the state the release notes already recorded as a
 * known bad one.
 */
export function dimSourceMissingReason(dimKey, configured, loaded) {
  if (typeof dimKey !== 'string' || !dimKey.startsWith('ds:')) return null;
  const cut = dimKey.indexOf(':', 3);
  const id = cut < 0 ? '' : dimKey.slice(3, cut);
  const dim = cut < 0 ? '' : dimKey.slice(cut + 1);
  if (!id || !dim) return 'This tile’s dimension is malformed.';
  if (Object.prototype.hasOwnProperty.call(DIM_SOURCE_AXES, id)) {
    const has = loaded && Object.prototype.hasOwnProperty.call(loaded, id);
    return has ? null : `Waiting for “${DIM_SOURCE_AXES[id].label}” — it has not been fetched yet.`;
  }
  const src = (Array.isArray(configured) ? configured : [])
    .find((s) => s && typeof s === 'object' && s.id === id);
  if (!src) {
    return `This tile needs a data source this pacing does not have (“${id}”). `
      + 'Add it in Settings → Data, or delete the tile.';
  }
  const dims = ((src.origin || {}).columns || {}).dims || [];
  if (!dims.some((d) => d && d.key === dim)) {
    return `“${src.title || id}” no longer has the column this tile is broken down by.`;
  }
  const has = loaded && Object.prototype.hasOwnProperty.call(loaded, id);
  if (!has) return `“${src.title || id}” has not been read yet — press Re-read on the Data tab.`;
  // The source IS loaded and DOES carry this breakdown, and the rows still may
  // not be read for it (spec §6.2). Both states are a tile drawing nothing, and
  // they have different fixes — one waits for a read, the other needs the sheet
  // put back — so they are not allowed to share a sentence.
  const state = breakdownState(loaded, id, dim);
  if (state === 'not_read') {
    return `“${src.title || id}” has changed since it was last read — save the settings, `
      + 'or press Re-read on the Data tab, and this fills in.';
  }
  if (state === 'broken') {
    return `The column behind this tile is no longer in “${src.title || id}”. `
      + 'Point the breakdown at a column that exists, on the Mapping tab.';
  }
  return null;
}
