// View-model helpers for Settings -> Mapping -> Additional source.
// Persistence stays in config.data.dim_sources; these functions only turn its
// source/binding/groups shape into the tasks a person actually performs.

import { fold } from './dim-groups.js';
import { homeOf } from './dim-value-editor.js';

export function additionalMappingStage(source) {
  const cols = (source?.origin || {}).columns;
  if (!cols) return 'connected';
  const routed = !!(cols.line_item || (source?.binding || {}).line_item_id);
  if (!cols.date || !routed || !Object.keys(cols.metrics || {}).length) return 'source_setup';
  if (!Array.isArray(cols.dims) || cols.dims.length === 0) return 'no_libraries';
  return 'ready';
}

export function isAdditionalMapping(source) {
  return source?.loader === 'sheet' && additionalMappingStage(source) !== 'connected';
}

// Raw rows stay valid when somebody only renames a library or edits its
// canonical values/aliases. They do NOT stay valid when the sheet, trunk, LI
// routing or this library's physical column changes. Keep that distinction out
// of the component: the full config fingerprint also includes groups and would
// make the manual vocabulary disappear after the first unsaved alias edit.
function sourceReadIdentity(source) {
  const origin = source?.origin || {};
  const columns = origin.columns || {};
  const binding = source?.binding || {};
  const pairs = (obj) => Object.keys(obj || {}).sort().map((key) => [key, String(obj[key] ?? '')]);
  return [
    String(origin.spreadsheet_id || ''),
    Number.isInteger(origin.sheet_id) ? origin.sheet_id : null,
    Number.isInteger(origin.header_row) ? origin.header_row : 0,
    String(columns.date || ''),
    String(columns.line_item || ''),
    pairs(columns.metrics),
    String(binding.mode || ''),
    String(binding.line_item_id || ''),
    pairs(binding.map),
    (Array.isArray(binding.exclude) ? binding.exclude : [])
      .map(lineItemNameKey).filter(Boolean).sort(),
  ];
}

/**
 * Whether a cached list of raw LI names belongs to the column currently on
 * screen. Manual routes and exclusions deliberately do not participate: they
 * edit the answers for this vocabulary, not the vocabulary itself.
 */
export function lineItemVocabularySignature(source) {
  const origin = source?.origin || {};
  const columns = origin.columns || {};
  return JSON.stringify([
    String(origin.spreadsheet_id || ''),
    Number.isInteger(origin.sheet_id) ? origin.sheet_id : null,
    Number.isInteger(origin.header_row) ? origin.header_row : 0,
    String(columns.line_item || ''),
  ]);
}

export function libraryReadSignature(source, dimKey) {
  const columns = source?.origin?.columns || {};
  const dim = (Array.isArray(columns.dims) ? columns.dims : [])
    .find((candidate) => candidate?.key === dimKey);
  return JSON.stringify([
    ...sourceReadIdentity(source),
    String(dim?.key || ''),
    String(dim?.column || ''),
  ]);
}

// /sheet-values collapses casing and surrounding whitespace for LI names. The
// persisted hand map and the loader use the same identity so one visible row in
// the editor cannot leave differently-cased source rows unmatched.
export function lineItemNameKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function indexedBinding(binding) {
  const exact = new Map();
  const folded = new Map();
  for (const [raw, lineItemId] of Object.entries(binding?.map || {})) {
    const spelling = String(raw).trim();
    const key = lineItemNameKey(raw);
    const id = String(lineItemId);
    if (spelling && !exact.has(spelling)) exact.set(spelling, id);
    if (!key) continue;
    if (!folded.has(key)) folded.set(key, id);
    else if (folded.get(key) !== id) folded.set(key, null);
  }
  const excluded = new Set((Array.isArray(binding?.exclude) ? binding.exclude : [])
    .map(lineItemNameKey).filter(Boolean));
  return { exact, folded, excluded };
}

function manualLineItem(index, raw) {
  const spelling = String(raw == null ? '' : raw).trim();
  if (index.exact.has(spelling)) return index.exact.get(spelling);
  return index.folded.get(lineItemNameKey(spelling)) || null;
}

/** The loader's auto-rule: one known LI id as an underscore-delimited token. */
export function automaticLineItem(raw, lineItems) {
  const known = new Set((lineItems || []).map((li) => String(li?.id ?? li?.line_item_id ?? ''))
    .filter(Boolean));
  const hits = [];
  for (const part of String(raw == null ? '' : raw).trim().split('_')) {
    if (/^\d+$/.test(part) && known.has(part) && !hits.includes(part)) hits.push(part);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Distinct LI names returned by /sheet-values -> editable routing rows. */
export function lineItemMatches(values, source, lineItems) {
  const bindingIndex = indexedBinding(source?.binding || {});
  const known = new Set((lineItems || []).map((li) => String(li?.id ?? li?.line_item_id ?? ''))
    .filter(Boolean));
  return (Array.isArray(values) ? values : []).map((entry) => {
    const raw = String((entry?.values || [])[0] == null ? '' : entry.values[0]).trim();
    const excluded = bindingIndex.excluded.has(lineItemNameKey(raw));
    const manualCandidate = excluded ? null : manualLineItem(bindingIndex, raw);
    const manual = manualCandidate && known.has(String(manualCandidate)) ? manualCandidate : null;
    const automaticCandidate = automaticLineItem(raw, lineItems);
    // A stale explicit rule must be repaired explicitly. Falling through to a
    // different automatic id would silently reroute delivery after its old LI
    // was deleted. Choosing “Automatic” in the editor removes the stale rule.
    const automatic = excluded || manualCandidate ? null : automaticCandidate;
    return {
      raw,
      rows: Number(entry?.rows) || 0,
      lineItemId: manual || automatic,
      missingLineItemId: manualCandidate && !manual ? String(manualCandidate) : null,
      automaticLineItemId: automaticCandidate,
      method: excluded ? 'excluded' : manual ? 'manual' : automatic ? 'automatic' : 'unmatched',
    };
  }).filter((entry) => entry.raw).sort((a, b) => b.rows - a.rows);
}

/**
 * Rebuild the editable LI-name vocabulary from the last published aux file.
 *
 * `bound` and `unbound` are deliberately answers from the stored read, not a
 * reason to inspect Google again merely because somebody opened Mapping. The
 * loader omits explicit exclusions from both arrays, so those names are added
 * with an unknown row count and remain visible/reversible offline.
 */
export function lineItemValuesFromAux(bound, unbound, excludedNames = []) {
  const byName = new Map();
  const add = (raw, rows, known = true) => {
    const value = String(raw == null ? '' : raw).trim();
    const key = lineItemNameKey(value);
    if (!key) return;
    const previous = byName.get(key);
    if (previous) {
      previous.rows += Number(rows) || 0;
      previous.rowsKnown = previous.rowsKnown && known;
      return;
    }
    byName.set(key, { values: [value], rows: Number(rows) || 0, rowsKnown: known });
  };
  for (const entry of Array.isArray(bound) ? bound : []) add(entry?.value, entry?.rows);
  for (const entry of Array.isArray(unbound) ? unbound : []) add(entry?.value, entry?.rows);
  for (const raw of Array.isArray(excludedNames) ? excludedNames : []) {
    const key = lineItemNameKey(raw);
    if (key && !byName.has(key)) add(raw, 0, false);
  }
  return [...byName.values()].sort((a, b) => b.rows - a.rows);
}

/**
 * Distinct library values, carrying the LI context they came from.
 * `values` contains [raw LI, raw library value] or just [raw library value] in
 * single-LI mode. Rows whose LI cannot be routed are reported separately rather
 * than silently entering the library.
 */
export function librarySourceValues(values, source, lineItems) {
  const cols = (source?.origin || {}).columns || {};
  const binding = source?.binding || {};
  const single = binding.mode === 'single' ? String(binding.line_item_id || '') : null;
  const bindingIndex = indexedBinding(binding);
  const byValue = new Map();
  let excludedRows = 0;

  for (const entry of Array.isArray(values) ? values : []) {
    const cells = Array.isArray(entry?.values) ? entry.values : [];
    const rawLi = cols.line_item ? String(cells[0] == null ? '' : cells[0]).trim() : '';
    const raw = String(cells[cols.line_item ? 1 : 0] == null ? '' : cells[cols.line_item ? 1 : 0]).trim();
    if (!raw) continue;
    const nameKey = lineItemNameKey(rawLi);
    const excluded = !single && bindingIndex.excluded.has(nameKey);
    const li = excluded ? null
      : single || manualLineItem(bindingIndex, rawLi) || automaticLineItem(rawLi, lineItems);
    const rows = Number(entry?.rows) || 0;
    if (!li) { excludedRows += rows; continue; }
    const key = fold(raw);
    if (!key) continue;
    let current = byValue.get(key);
    if (!current) {
      current = { value: raw, rows: 0, lineItems: new Set() };
      byValue.set(key, current);
    }
    current.rows += rows;
    current.lineItems.add(String(li));
  }

  return {
    values: [...byValue.values()].map((v) => ({
      value: v.value,
      rows: v.rows,
      lineItemIds: [...v.lineItems],
    })).sort((a, b) => b.rows - a.rows),
    excludedRows,
  };
}

/** Full vocabulary from the persisted aux rows (not the 500-combination sheet preview). */
export function libraryValuesFromRows(rows, dimKey) {
  const byValue = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = String(row?.dims?.[dimKey] == null ? '' : row.dims[dimKey]).trim();
    const key = fold(raw);
    if (!key) continue;
    let current = byValue.get(key);
    if (!current) {
      current = { value: raw, rows: 0, lineItems: new Set() };
      byValue.set(key, current);
    }
    current.rows += 1;
    if (row?.line_item_id != null) current.lineItems.add(String(row.line_item_id));
  }
  return { values: [...byValue.values()].map((value) => ({
    value: value.value, rows: value.rows, lineItemIds: [...value.lineItems],
  })).sort((a, b) => b.rows - a.rows), excludedRows: 0 };
}

/**
 * Collapse metric weights on the same identity the library editor exposes.
 *
 * `libraryValuesFromRows` already turns `Hulu`, ` hulu ` and `HULU` into one
 * editable value. Keeping three metric rows beside that one value made a Map
 * overwrite two shares and could show 30% for a value carrying 100%. The first
 * spelling stays the display spelling; every folded spelling contributes to its
 * amount. Presence is retained even when the amount is zero, which lets the UI
 * tell a true zero inside the current scope from a value absent from that scope.
 */
export function foldedMetricWeights(tally) {
  const byValue = new Map();
  for (const entry of Array.isArray(tally) ? tally : []) {
    const value = String(entry?.value == null ? '' : entry.value).trim();
    const key = fold(value);
    if (!key) continue;
    let current = byValue.get(key);
    if (!current) {
      current = { value, weight: 0 };
      byValue.set(key, current);
    }
    current.weight += Number(entry?.weight) || 0;
  }
  const out = [...byValue.values()].sort((a, b) => b.weight - a.weight);
  out.blankWeight = Number(tally?.blankWeight) || 0;
  out.from = tally?.from ?? null;
  out.to = tally?.to ?? null;
  return out;
}

/**
 * Attach the selected review metric to the folded source vocabulary and rank
 * by exactly the amount printed beside each value. `null` means the value has
 * source rows, but none inside the current pacing LI/flight scope; numeric zero
 * means it is inside scope and genuinely carries zero of the selected metric.
 */
export function libraryMetricView(values, metricWeights) {
  const weightByValue = new Map((Array.isArray(metricWeights) ? metricWeights : [])
    .map((entry) => [fold(entry?.value), Number(entry?.weight) || 0]));
  return (Array.isArray(values) ? values : []).map((entry) => {
    const key = fold(entry?.value);
    const inScope = weightByValue.has(key);
    return {
      ...entry,
      metricWeight: inScope ? weightByValue.get(key) : null,
      metricInScope: inScope,
    };
  }).sort((a, b) => {
    if (a.metricInScope !== b.metricInScope) return a.metricInScope ? -1 : 1;
    if (a.metricInScope && b.metricWeight !== a.metricWeight) return b.metricWeight - a.metricWeight;
    const rows = (Number(b.rows) || 0) - (Number(a.rows) || 0);
    if (rows) return rows;
    return String(a.value || '').localeCompare(String(b.value || ''));
  });
}

export function libraryModel(values, groups) {
  const list = Array.isArray(groups) ? groups : [];
  const canonical = list.filter((g) => g && g.drop !== true).map((g) => ({
    label: g.label,
    members: Array.isArray(g.members) ? g.members : [],
  }));
  const ignored = list.filter((g) => g && g.drop === true)
    .flatMap((g) => Array.isArray(g.members) ? g.members : []);
  const unassigned = (Array.isArray(values) ? values : []).filter((v) => !homeOf(list, v.value));
  return { canonical, ignored, unassigned };
}

/**
 * Capture exactly the one library removal may erase. Widget positions travel
 * with the snapshot so a local Undo can restore the dashboard draft without
 * resetting unrelated Display edits.
 */
export function removedLibrarySnapshot(source, dimKey, widgets, includeWidgets = false) {
  const dims = Array.isArray(source?.origin?.columns?.dims) ? source.origin.columns.dims : [];
  const index = dims.findIndex((candidate) => candidate?.key === dimKey);
  if (index < 0) return null;
  const axis = `ds:${source.id}:${dimKey}`;
  const usesAxis = (value) => value && typeof value === 'object' && value.dim === axis;
  const widgetSnapshots = includeWidgets
    ? (Array.isArray(widgets) ? widgets : []).flatMap((widget, widgetIndex) => (
      widget && (usesAxis(widget.rows) || usesAxis(widget.xAxis))
        ? [{ widget, index: widgetIndex }] : []
    )) : [];
  const hadGroups = Object.prototype.hasOwnProperty.call(source.groups || {}, dimKey);
  const hadDismissed = Object.prototype.hasOwnProperty.call(source.dismissed || {}, dimKey);
  return {
    dim: { ...dims[index] }, index,
    groups: hadGroups ? source.groups[dimKey] : [], hadGroups,
    dismissed: hadDismissed ? source.dismissed[dimKey] : [], hadDismissed,
    widgetSnapshots,
  };
}

/** Restore a removed library into the current source, preserving other edits. */
export function restoreRemovedLibrary(source, snapshot) {
  if (!snapshot?.dim?.key) return source;
  const origin = source?.origin || {};
  const columns = origin.columns || {};
  const dims = (Array.isArray(columns.dims) ? columns.dims : [])
    .filter((candidate) => candidate?.key !== snapshot.dim.key);
  dims.splice(Math.min(Math.max(0, snapshot.index), dims.length), 0, snapshot.dim);
  const groups = { ...(source.groups || {}) };
  if (snapshot.hadGroups) groups[snapshot.dim.key] = snapshot.groups;
  else delete groups[snapshot.dim.key];
  const dismissed = { ...(source.dismissed || {}) };
  if (snapshot.hadDismissed) dismissed[snapshot.dim.key] = snapshot.dismissed;
  else delete dismissed[snapshot.dim.key];
  const next = {
    ...source, groups,
    origin: { ...origin, columns: { ...columns, dims } },
  };
  if (Object.keys(dismissed).length) next.dismissed = dismissed;
  else delete next.dismissed;
  return next;
}
