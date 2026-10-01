// workspace/src/lib/mapping/delivery-rows.js
//
// D4 (spec 2026-07-10): the delivery classification ROW is `LI × split-fields
// tuple`, not one-per-LI — a line item carrying 4 audiences must classify and
// pivot per audience, matching CM360's per-audience placements. Facts rows are
// already `date × LI × CNB_audience × CNB_other`; this module just stops
// flattening them (shared/third-party-compare.js:buildLiIndexFromFacts, which
// DID flatten, stays untouched for its other consumers).
//
// Plain ESM, NO React, NO @shared alias imports — the host node runner imports
// this file directly (tests/mapping-delivery-rows-test.mjs), exactly like
// dnd.js / effective.js.
//
// KEY CONTRACT: `deliverySubKey` / `deliverySubKeyFromFactsRow` are the ONLY
// producers of sub-row keys. classifyAll cells and the widget's daily series
// must key rows through these helpers — key equality is what joins them.

export const SEP = '\u0001';

// The 8 per-row CNB fields (the dashboard's split model set). channel/tactic
// are per-LI and deliberately NOT part of the key.
export const SPLIT_FIELDS = [
  'audience', 'add_smth', 'geo', 'creative_tag',
  'message', 'keyword_group', 'flight_identifier', 'language',
];

/** Field normalization — same convention as buildLiIndexFromFacts ('' → '-'). */
export function dv(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s === '' ? '-' : s;
}

/** The same fields shape buildLiIndexFromFacts emitted, from ONE facts row. */
export function factsRowFields(f, channel) {
  const r = f || {};
  return {
    channel: dv(channel),
    tactic: dv(r.tactic),
    audience: dv(r.audience),
    buying_model: '-', // not carried in facts rows
    add_smth: dv(r.comment),
    geo: dv(r.geo),
    creative_tag: dv(r.creative),
    message: dv(r.message),
    keyword_group: dv(r.keyword),
    flight_identifier: dv(r.flight),
    language: dv(r.language),
  };
}

export function deliverySubKey(liId, fields) {
  let key = String(liId);
  for (const f of SPLIT_FIELDS) key += SEP + dv(fields[f]);
  return key;
}

/** Daily-series key for one facts row — channel-independent (not in the key). */
export function deliverySubKeyFromFactsRow(f) {
  return deliverySubKey(String(f.line_item_id == null ? '' : f.line_item_id), factsRowFields(f, '-'));
}

/** Human label: the row's non-empty tuple values, ' · '-joined ('' when none). */
export function subRowLabel(fields) {
  const parts = [];
  for (const f of SPLIT_FIELDS) {
    const v = fields[f];
    if (v && v !== '-') parts.push(v);
  }
  return parts.join(' · ');
}

/** Advance a row's last_seen to `date` when the daily row carries impressions. */
function bumpLastSeen(row, date, impressions) {
  if (!(Number(impressions) > 0)) return;
  const d = String(date == null ? '' : date);
  if (!d) return;
  if (row.last_seen == null || d > row.last_seen) row.last_seen = d;
}

/** Max last_seen across two row sets (view-filter reference date); null when none. */
export function latestSeen(rowsA, rowsB) {
  let max = null;
  for (const r of [...(rowsA || []), ...(rowsB || [])]) {
    if (r && r.last_seen != null && (max === null || r.last_seen > max)) max = r.last_seen;
  }
  return max;
}

/**
 * buildDeliverySubRows(factsDaily, types, liPlan)
 *   -> [{key, liId, name:'', label, display, fields, impressions}]
 * One row per (LI, split-fields tuple); impressions summed per tuple (feeds
 * the row-table Impr column only — classifyAll ignores it). LIs present in
 * types/liPlan but absent from facts get ONE stub sub-row ('-' fields), same
 * universe completion buildLiIndexFromFacts performed. Sorted by numeric-aware
 * LI id, then key. `tactic` varying inside one LI id (dirty data) collapses
 * first-seen, exactly as before — it is not part of the key.
 */
export function buildDeliverySubRows(factsDaily, types, liPlan) {
  const typeByLi = {};
  for (const t of types || []) {
    if (t && t.line_item_id != null) typeByLi[String(t.line_item_id)] = dv(t.type);
  }
  const channelFor = (liId) => (typeByLi[liId] != null ? typeByLi[liId] : '-');

  const byKey = new Map();
  for (const f of factsDaily || []) {
    const liId = String(f.line_item_id == null ? '' : f.line_item_id);
    if (!liId) continue;
    const fields = factsRowFields(f, channelFor(liId));
    const key = deliverySubKey(liId, fields);
    let r = byKey.get(key);
    if (!r) {
      r = { key, liId, name: '', fields, impressions: 0, last_seen: null };
      byKey.set(key, r);
    }
    r.impressions += Number(f.impressions) || 0;
    bumpLastSeen(r, f.date, f.impressions);
  }

  // Universe completion: types + liPlan ids with no facts rows.
  const seenLi = new Set();
  for (const r of byKey.values()) seenLi.add(r.liId);
  const universe = new Set(Object.keys(typeByLi));
  for (const k of Object.keys(liPlan || {})) universe.add(String(k));
  for (const liId of universe) {
    if (seenLi.has(liId)) continue;
    const fields = factsRowFields({}, channelFor(liId));
    const key = deliverySubKey(liId, fields);
    byKey.set(key, { key, liId, name: '', fields, impressions: 0, last_seen: null });
  }

  const rows = [...byKey.values()];
  rows.sort((a, b) =>
    a.liId.localeCompare(b.liId, undefined, { numeric: true })
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const r of rows) {
    r.label = subRowLabel(r.fields);
    r.display = r.label ? `LI ${r.liId} · ${r.label}` : `LI ${r.liId}`;
  }
  return rows;
}

/**
 * Re-key the {liId: [creative names]} surface to sub-row keys: an LI's creative
 * names attach to EACH of its sub-rows (a creative cannot be attributed to a
 * sub-tuple — two-aggregates limitation, spec D4).
 */
export function creativesBySubRow(creativesByLi, deliveryRows) {
  if (!creativesByLi) return null;
  const out = {};
  for (const r of deliveryRows || []) {
    const names = creativesByLi[r.liId];
    if (names && names.length) out[r.key] = names;
  }
  return Object.keys(out).length ? out : null;
}

/* ── D5: creative↔creative comparison level (spec 2026-07-10) ─────────────────
   Keys are 'cr'-prefixed so the two levels can never collide inside one
   cell_overrides map; entries for the other level are inert by construction. */

const CR_PREFIX = 'cr' + SEP;

export function creativeRowKey(liId, creative) {
  return CR_PREFIX + String(liId) + SEP + String(creative == null ? '' : creative);
}
export function cm360CreativeKey(placement, creative) {
  return CR_PREFIX + String(placement) + SEP + String(creative == null ? '' : creative);
}
export function deliveryCreativeDailyKey(row) {
  const liId = row && row.line_item_id != null ? String(row.line_item_id) : '';
  const cr = row && row.creative != null ? String(row.creative).trim() : '';
  return liId && cr ? creativeRowKey(liId, cr) : '';
}
export function cm360CreativeDailyKey(row) {
  const placement = row && row.placement ? String(row.placement) : '';
  return placement ? cm360CreativeKey(placement, row && row.creative != null ? String(row.creative) : '') : '';
}

/**
 * Delivery creative rows — one per (LI, creative name) from the creatives aux.
 * `name` = the creative (token surface). `fields` are inherited from the LI
 * ONLY where the LI carries exactly one distinct value for that field over its
 * facts rows: an ambiguous field is OMITTED, so a CNB dimension resolves to
 * unresolved instead of inheriting a lie (multi-audience LIs must not claim a
 * single audience — spec D5). channel is per-LI (types) and always present.
 *
 * `creativeLabel` (raw name → shown name, or null) changes `display` alone: the CM360
 * comparison on the dashboard shows a creative under the pacing's display name (spec
 * docs/2026-09-24-display-names.md). A function and not the shared lookup, because this file
 * takes no @shared import. key, creative and name stay raw — the mapping's rules and its
 * stored picks are written against raw names. The Mapping tab passes nothing.
 */
export function buildDeliveryCreativeRows(creativesAux, factsDaily, types, creativeLabel = null) {
  if (!Array.isArray(creativesAux) || creativesAux.length === 0) return [];
  const typeByLi = {};
  for (const t of types || []) {
    if (t && t.line_item_id != null) typeByLi[String(t.line_item_id)] = dv(t.type);
  }
  // Per-LI distinct value sets over tactic + the 8 split fields.
  const FIELDS = ['tactic', ...SPLIT_FIELDS];
  const sets = new Map(); // liId -> {field -> Set}
  for (const f of factsDaily || []) {
    const liId = String(f.line_item_id == null ? '' : f.line_item_id);
    if (!liId) continue;
    let s = sets.get(liId);
    if (!s) { s = {}; for (const fld of FIELDS) s[fld] = new Set(); sets.set(liId, s); }
    const fields = factsRowFields(f, '-');
    for (const fld of FIELDS) s[fld].add(fields[fld]);
  }
  const inheritedFields = (liId) => {
    const out = { channel: typeByLi[liId] != null ? typeByLi[liId] : '-', buying_model: '-' };
    const s = sets.get(liId);
    for (const fld of FIELDS) {
      if (s && s[fld].size === 1) out[fld] = [...s[fld]][0];
      // ambiguous / no facts → omitted → no structured hit for this field
    }
    return out;
  };

  const byKey = new Map();
  for (const row of creativesAux) {
    const liId = String(row.line_item_id == null ? '' : row.line_item_id);
    const cr = row.creative == null ? '' : String(row.creative).trim();
    if (!liId || !cr) continue;
    const key = creativeRowKey(liId, cr);
    let r = byKey.get(key);
    if (!r) {
      r = {
        key, liId, creative: cr, name: cr,
        display: `${creativeLabel ? creativeLabel(cr) : cr} · LI ${liId}`,
        fields: inheritedFields(liId), impressions: 0, last_seen: null,
      };
      byKey.set(key, r);
    }
    r.impressions += Number(row.impressions) || 0;
    bumpLastSeen(r, row.date, row.impressions);
  }
  const rows = [...byKey.values()];
  rows.sort((a, b) =>
    a.liId.localeCompare(b.liId, undefined, { numeric: true })
    || a.creative.localeCompare(b.creative));
  return rows;
}

/** CM360 creative groups — one per (placement, creative). name = matching surface. */
export function buildCm360CreativeGroups(cm360Raw) {
  const byKey = new Map();
  for (const r of cm360Raw || []) {
    const placement = r && r.placement ? String(r.placement) : '';
    if (!placement) continue;
    const creative = r && r.creative != null ? String(r.creative) : '';
    const key = cm360CreativeKey(placement, creative);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key, placement, creative,
        name: (placement + ' ' + creative).trim(),
        display: creative ? `${placement} — ${creative}` : `${placement} — (no creative)`,
        impressions: 0, last_seen: null,
      };
      byKey.set(key, g);
    }
    g.impressions += Number(r.impressions) || 0;
    bumpLastSeen(g, r.date, r.impressions);
  }
  return [...byKey.values()];
}

/** Creative-rows impressions ÷ facts impressions (BQ drops unnamed creatives). */
export function creativeCoverage(creativesAux, factsDaily) {
  let cr = 0, facts = 0;
  for (const r of creativesAux || []) cr += Number(r.impressions) || 0;
  for (const f of factsDaily || []) facts += Number(f.impressions) || 0;
  return facts > 0 ? cr / facts : null;
}

/**
 * CM360 placement key — the classify group key AND the daily pivot key. Raw
 * String(placement) (NOT folded), empty → '' (callers drop those rows, exactly
 * as the classify group derivation skips them). Keeping this the single
 * definition is what pins cm360Cells keys to cm360Daily keys.
 */
export function cm360PlacementKey(row) {
  return row && row.placement ? String(row.placement) : '';
}

/**
 * CM360 classify rows — one per distinct placement. key = placement, name =
 * placement + ' ' + its creatives (the classifier reads key + name only;
 * creatives count + impressions feed the Settings row-table columns and are
 * inert to classification).
 */
export function buildCm360Groups(cm360Raw) {
  const groups = new Map();
  for (const r of (cm360Raw || [])) {
    const placement = cm360PlacementKey(r);
    if (!placement) continue;
    let g = groups.get(placement);
    if (!g) { g = { key: placement, creatives: new Set(), impressions: 0, last_seen: null }; groups.set(placement, g); }
    if (r.creative) g.creatives.add(String(r.creative));
    g.impressions += Number(r.impressions) || 0;
    bumpLastSeen(g, r.date, r.impressions);
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    name: (g.key + ' ' + [...g.creatives].join(' ')).trim(),
    creatives: g.creatives.size,
    impressions: g.impressions,
    last_seen: g.last_seen,
  }));
}
