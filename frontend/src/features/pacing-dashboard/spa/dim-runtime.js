// The UI-facing state of every dimension source, and the counts it is built from.
//
// MOVED from the retired SPA's settings drawer (`buildDimRuntime`), because the editors it feeds were
// moved with it: they read `runtime.rows` as a NUMBER, `runtime.unbound` as a {names, rows} pair, and
// a status that merges "a read is in flight" with "the last read failed". The dashboard payload
// carries none of that - its `rows` is the row ARRAY - so handing the raw envelope over printed
// "NaN rows read" and no unrouted count at all.
//
// `dimCounts` is the expensive half and is kept apart for the same reason the reference keeps it
// apart: it walks every row of every source, while the rest may re-run as often as it likes.

import { dimSourceCardinality } from "../breakdown/dim-coverage";

/**
 * Two counts per breakdown, and the difference is not marginal.
 *
 * `distinct` is the raw vocabulary - what a person is grouping. `rowCount` is what a widget or the
 * Breakdown panel would actually SHOW, counted through this source's own dictionary by the same
 * function the panel gates on. Measured on the reference: 80 raw values collapse to 1 under one
 * group, so deciding "Breakdown or a table of its own" on the raw count sends a perfectly readable
 * breakdown to a widget and tells the user the Breakdown cannot take it.
 *
 * @param {object} loaded   the payload's `dimSources` map
 * @param {Array}  sources  the sheet sources as the drawer currently has them
 * @returns {object} per source id: {rows, distinct, rowCount}
 */
export function buildDimCounts(loaded, sources) {
  const out = {};
  const configured = Array.isArray(sources) ? sources : [];
  for (const [id, entry] of Object.entries(loaded || {})) {
    const rows = (entry && Array.isArray(entry.rows)) ? entry.rows : [];
    const src = configured.find((s) => s && s.id === id);
    const distinct = {};
    for (const r of rows) {
      for (const k of Object.keys((r && r.dims) || {})) {
        const v = String(r.dims[k] == null ? '' : r.dims[k]).trim();
        if (!v) continue;
        if (!distinct[k]) distinct[k] = new Set();
        distinct[k].add(v);
      }
    }
    const rowCount = {};
    for (const k of Object.keys(distinct)) {
      rowCount[k] = dimSourceCardinality(rows, k, null, ((src || {}).groups || {})[k]);
    }
    out[id] = {
      rows: rows.length,
      distinct: Object.fromEntries(Object.entries(distinct).map(([k, set]) => [k, set.size])),
      rowCount,
    };
  }
  return out;
}

/**
 * The cheap, UI-facing state for every dimension source.
 *
 * A first read has no aux entry yet. Building this map from aux entries alone
 * therefore hid both the in-flight state and a terminal first-read error. The
 * local sheet list is part of the identity set so a source exists here before
 * its first successful publish.
 */
export function buildDimRuntime(dimSources, localDimSources, dimCounts, readingIds, readErrors) {
  const stored = (dimSources && typeof dimSources === 'object') ? dimSources : {};
  const configured = Array.isArray(localDimSources) ? localDimSources : [];
  const sourceById = new Map(configured.filter((s) => s && s.id).map((s) => [s.id, s]));
  const ids = new Set(Object.keys(stored));
  for (const src of configured) {
    if (src && src.loader === 'sheet' && src.id) ids.add(src.id);
  }
  const reading = new Set(Array.isArray(readingIds) ? readingIds : []);
  const transient = (readErrors && typeof readErrors === 'object') ? readErrors : {};
  const out = {};

  for (const id of ids) {
    const entry = stored[id] || null;
    const src = sourceById.get(id);
    const binding = (src || {}).binding || {};
    const answered = new Set([
      ...Object.keys(binding.map || {}),
      ...(Array.isArray(binding.exclude) ? binding.exclude : []),
    ].map((name) => String(name).trim().toLowerCase()).filter(Boolean));
    const open = (entry && Array.isArray(entry.unbound) ? entry.unbound : [])
      .filter((u) => u && !answered.has(String(u.value || '').trim().toLowerCase()));
    const localError = transient[id];
    const message = typeof localError === 'string' ? localError : localError?.message;
    out[id] = {
      ...(dimCounts?.[id] || { rows: 0, distinct: {}, rowCount: {} }),
      unbound: { names: open.length, rows: open.reduce((n, u) => n + (Number(u.rows) || 0), 0) },
      breakdowns: entry && entry.breakdowns,
      reading: reading.has(id),
      fetched_at: entry && entry.fetched_at,
      // The file's REAL size, so the Size tile stops guessing once a read has happened. Without it
      // the screen says "about 4.8 MB" for a file that is 2.1 MB on disk - the estimate is per-row
      // and deliberately pessimistic, which is the right thing to show BEFORE a read and the wrong
      // thing after one.
      file_bytes: entry && Number.isFinite(entry.file_bytes) ? entry.file_bytes : null,
      // AdditionalMappingEditor already renders `stale` as a terminal read
      // failure. Reuse that presentation for a first-read error even though no
      // stale rows exist; the zero row count remains the honest data state.
      status: message ? 'stale' : entry && entry.status,
      error: message || (entry && entry.error),
      behind: !!(entry && entry.behind),
      coverage_hint: entry && entry.coverage_hint,
    };
  }
  return out;
}
