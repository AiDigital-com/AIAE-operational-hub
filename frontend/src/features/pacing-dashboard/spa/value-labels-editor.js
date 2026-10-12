// workspace/src/lib/settings/value-labels-editor.js
//
// Every decision the Display names editor makes (Settings → Mapping, spec
// docs/2026-09-24-display-names.md), as pure functions, so a host test can drive the
// whole editor with no React in the room. The screen renders; these answer.
//
// The draft is the stored shape, config.data.value_labels:
//     { conversion_action: [{ raw, label }], creative: [{ raw, label }] }
// A label is kept as typed (a space between two words has to survive the keystroke);
// `fingerprint` and the server's `validate` trim it. Matching is shared/value-labels.js's:
// trimmed, then exact.

import ValueLabels from '@shared/value-labels';

export const FIELDS = ValueLabels.FIELDS;
export const MAX_LABEL_LEN = ValueLabels.MAX_LABEL_LEN;

/** How the screen names each field and what it ranks values by. */
export const FIELD_META = Object.freeze({
  conversion_action: { title: 'Conversion actions', one: 'conversion action', many: 'conversion actions', metric: 'conversions' },
  creative: { title: 'Creatives', one: 'creative', many: 'creatives', metric: 'impressions' },
});

const listOf = (draft, field) => (draft && Array.isArray(draft[field]) ? draft[field] : []);

/**
 * The raw value a data row carries for a field — the same value the dashboard's aux cut
 * looks up (widget-data.js auxRaw): an action trimmed; a creative's trimmed name, else its id.
 * '' when the row names nothing (the dashboard's «Unclassified» row, which cannot be named).
 */
export function rawOf(field, row) {
  if (!row) return '';
  if (field === 'conversion_action') return ValueLabels.keyOf(row.conversion_action);
  return ValueLabels.keyOf(row.creative) || ValueLabels.keyOf(row.creative_id);
}

const VALUES_CACHE = { conversion_action: new WeakMap(), creative: new WeakMap() };

/**
 * The distinct raw values the loaded file carries for a field: { raw, volume, lis } with
 * volume = conversions (actions) or impressions (creatives) over the whole file, and lis =
 * how many line items carry the value. Highest volume first, then by raw value. Cached per
 * rows array: the store replaces the array on every data load and never mutates it.
 */
export function valuesInData(field, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const cache = VALUES_CACHE[field];
  if (cache && cache.has(rows)) return cache.get(rows);
  const byRaw = new Map();
  const metric = FIELD_META[field]?.metric;
  for (const r of rows) {
    const raw = rawOf(field, r);
    if (!raw) continue;
    let e = byRaw.get(raw);
    if (!e) { e = { raw, volume: 0, liSet: new Set() }; byRaw.set(raw, e); }
    e.volume += Number(r[metric]) || 0;
    if (r.line_item_id != null && r.line_item_id !== '') e.liSet.add(String(r.line_item_id));
  }
  const out = [...byRaw.values()]
    .map((e) => ({ raw: e.raw, volume: e.volume, lis: e.liSet.size }))
    .sort((a, b) => (b.volume - a.volume) || (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));
  if (cache) cache.set(rows, out);
  return out;
}

/** The draft's label for a raw value, as typed; '' when it has none. */
export function labelFor(draft, field, raw) {
  for (const e of listOf(draft, field)) if (e && e.raw === raw) return typeof e.label === 'string' ? e.label : '';
  return '';
}

/**
 * The draft with one value's label set. An empty (or blank) label removes the entry: an
 * unnamed value shows as itself. Other entries keep their order. Returns the INPUT draft by
 * identity when nothing changes, so a keystroke that changes nothing does not dirty anything.
 */
export function setLabel(draft, field, raw, label) {
  const next = typeof label === 'string' ? label : '';
  const list = listOf(draft, field);
  const i = list.findIndex((e) => e && e.raw === raw);
  if (i === -1 && next.trim() === '') return draft;
  if (i !== -1 && list[i].label === next) return draft;
  const nextList = next.trim() === ''
    ? list.filter((_, j) => j !== i)
    : i === -1 ? [...list, { raw, label: next }] : list.map((e, j) => (j === i ? { raw, label: next } : e));
  return { ...emptyDraft(), ...(draft || {}), [field]: nextList };
}

/** A fresh empty draft (both fields present). */
export function emptyDraft() {
  return { conversion_action: [], creative: [] };
}

/** A deep copy of a stored value, for the drawer's draft; absent → the empty shape. */
export function cloneDraft(stored) {
  const out = emptyDraft();
  for (const f of FIELDS) {
    out[f] = listOf(stored, f)
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({ raw: String(e.raw ?? ''), label: String(e.label ?? '') }));
  }
  return out;
}

/**
 * The draft's identity for dirty detection: what the server would store, without refusing
 * anything — trimmed, entries naming nothing dropped, sorted by raw value. Absent, null and
 * the empty shape are the same fingerprint, so opening a pacing that never had names is clean.
 */
export function fingerprint(draft) {
  const out = {};
  for (const f of FIELDS) {
    out[f] = listOf(draft, f)
      .map((e) => [ValueLabels.keyOf(e && e.raw), ValueLabels.keyOf(e && e.label)])
      .filter(([raw, label]) => raw && label && label !== raw)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  return JSON.stringify(out);
}

/** What Save would be refused for, as the server's own sentence, or null. */
export function draftProblem(draft) {
  const v = ValueLabels.validate(draft || emptyDraft());
  return v.ok ? null : v.detail;
}

/** A per-row problem with the typed label, or null: a name the dashboard keeps for its own rows. */
export function labelProblem(label) {
  const t = typeof label === 'string' ? label.trim() : '';
  if (t && ValueLabels.isReserved(t)) return `“${t}” is a name the dashboard uses for its own rows. Choose another name.`;
  return null;
}


/**
 * The rows the editor lists for one field.
 *   rows     every value in the data: { raw, volume, lis, label, together }, where
 *            `together` lists the OTHER values in the data that show under the same name
 *            (two values given one name — or a name equal to another value — are one row on
 *            the dashboard). Empty when the value is alone.
 *   orphans  draft entries whose value the data does not carry: { raw, label }.
 */
export function editorRows(draft, field, dataValues) {
  const values = Array.isArray(dataValues) ? dataValues : [];
  // One pass over the draft, so a keystroke on a 2,000-creative pacing stays linear.
  const typed = new Map();
  for (const e of listOf(draft, field)) {
    if (e && !typed.has(e.raw)) typed.set(e.raw, typeof e.label === 'string' ? e.label : '');
  }
  const shownAs = (raw) => (typed.get(raw) || '').trim() || raw;
  const byShown = new Map();
  for (const v of values) {
    const shown = shownAs(v.raw);
    if (!byShown.has(shown)) byShown.set(shown, []);
    byShown.get(shown).push(v.raw);
  }
  const inData = new Set(values.map((v) => v.raw));
  const rows = values.map((v) => ({
    ...v,
    label: typed.get(v.raw) || '',
    together: byShown.get(shownAs(v.raw)).filter((raw) => raw !== v.raw),
  }));
  const orphans = listOf(draft, field)
    .filter((e) => e && !inData.has(e.raw) && typeof e.label === 'string' && e.label.trim() !== '')
    .map((e) => ({ raw: e.raw, label: e.label }));
  return { rows, orphans };
}

/** The sentence under a row whose value shares its shown name with others, or null. */
export function togetherNote(row) {
  const n = row && Array.isArray(row.together) ? row.together.length : 0;
  if (!n) return null;
  const names = row.together.slice(0, 3).map((raw) => `“${raw}”`).join(', ');
  const more = n > 3 ? ` and ${n - 3} more` : '';
  return `Shown as one row with ${names}${more}.`;
}

/** Search: the raw value or the typed label contains the query, case-insensitive. */
export function matchesQuery(row, query) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return true;
  return String(row.raw).toLowerCase().includes(q) || String(row.label || '').toLowerCase().includes(q);
}

/** How many values the draft names, per field and in total (ValueLabels.counts). */
export function namedCounts(draft) {
  return ValueLabels.counts(draft);
}

/** The Mapping list card's summary line, or null when the draft names nothing. */
export function summaryLine(draft) {
  const c = namedCounts(draft);
  if (!c.total) return null;
  const parts = [];
  for (const f of FIELDS) {
    const n = c[f];
    if (n) parts.push(`${n} ${n === 1 ? FIELD_META[f].one : FIELD_META[f].many}`);
  }
  return `${parts.join(' · ')} named`;
}
