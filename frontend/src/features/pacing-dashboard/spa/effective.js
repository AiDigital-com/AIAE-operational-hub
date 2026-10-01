// workspace/src/lib/mapping/effective.js
//
// The EFFECTIVE mapping view (Mapping v3.1) — one implementation shared by the
// Settings → Mapping tab AND the Delivery-vs-CM360 widget, so both surfaces
// classify over the SAME dimensions. Before this seam existed the widget read
// the raw saved mapping_v3: an auto dim's derived-but-unaliased values worked
// in the tab but silently vanished in the widget (cm360 'Display' → null →
// real overlap mis-bucketed delivery_only).
//
// Plain ESM, NO React, NO @shared alias import — the host node runner imports
// this file directly (tests/dnd-helpers-test.mjs), exactly like MappingV3Tab's
// dnd.js. That is why buildEffectiveMapping takes the engine's deriveAutoValues
// as an ARGUMENT: shared/mapping-dims.js is a UMD reachable in Vite only via the
// '@shared/mapping-dims' alias, which plain node cannot resolve. Components
// never see the injection — lib/mapping/rows.js exports the bound two-argument
// buildEffectiveMapping(mapping, deliveryRows) both consumers import.

/** Fold a string the same way shared/mapping-dims.js does (whitespace-collapsed, lowercased). */
function fold(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Effective value list for an AUTO dim: the delivery-derived read-only labels
 * merged with the draft's stored entries. Derived values come first, in derived
 * order, each carrying any user aliases stored for it; a stored value that has
 * VANISHED from the delivery data is kept ONLY when it still carries aliases
 * (else dropped). Pure, fold-compared throughout; deep-copies aliases so the
 * stored draft is never mutated through the merged view.
 *
 *   derivedValues  string[]           (MappingDims.deriveAutoValues output)
 *   storedValues   [{value, aliases}] (the auto dim's draft values[])
 *   returns        [{value, aliases}]
 */
export function mergeAutoValues(derivedValues, storedValues) {
  const derived = derivedValues || [];
  const stored = storedValues || [];
  const storedByFold = new Map();
  for (const v of stored) if (v && v.value != null) storedByFold.set(fold(v.value), v);
  const out = [];
  const seen = new Set();
  for (const dv of derived) {
    const f = fold(dv);
    if (seen.has(f)) continue;
    seen.add(f);
    const s = storedByFold.get(f);
    out.push({ value: dv, aliases: s ? [...(s.aliases || [])] : [] });
  }
  for (const v of stored) {
    const f = fold(v.value);
    if (seen.has(f)) continue;
    if ((v.aliases || []).length > 0) {
      out.push({ value: v.value, aliases: [...(v.aliases || [])] });
      seen.add(f);
    }
  }
  return out;
}

/**
 * D4 (spec 2026-07-10): saved cell_overrides.delivery may be keyed by bare LI
 * id (the pre-sub-row shape). Expand each such legacy entry to EVERY sub-row
 * key of that LI so old manual picks keep applying; a specific sub-row entry
 * wins per dimId. Render/classify view ONLY — never persisted. Keys containing
 * the separator (sub-row or 'cr…' creative keys) pass through untouched; the
 * legacy key itself stays in the map (inert — it matches no row).
 */
export function expandDeliveryLiOverrides(cellOverrides, deliveryRows) {
  const co = cellOverrides || {};
  const dlv = co.delivery || {};
  const legacyKeys = Object.keys(dlv).filter((k) => !k.includes('\u0001'));
  if (legacyKeys.length === 0) return co;
  const subKeysByLi = new Map();
  for (const r of deliveryRows || []) {
    if (!r || typeof r.key !== 'string' || !r.key.includes('\u0001') || r.key.startsWith('cr\u0001')) continue;
    const liId = r.liId != null ? String(r.liId) : r.key.slice(0, r.key.indexOf('\u0001'));
    if (!subKeysByLi.has(liId)) subKeysByLi.set(liId, []);
    subKeysByLi.get(liId).push(r.key);
  }
  // Reference-identity contract: return the SAME cell_overrides object when
  // nothing actually expands (a legacy key present, but no sub-row matched it —
  // e.g. old one-per-LI delivery rows). buildEffectiveMapping's shared consumers
  // rely on `eff.cell_overrides === mapping.cell_overrides` in that case
  // (dnd-helpers "overrides carried"); a value-equal fresh object would break it.
  const outDlv = { ...dlv };
  let changed = false;
  for (const lk of legacyKeys) {
    const subKeys = subKeysByLi.get(lk);
    if (!subKeys) continue;
    for (const sk of subKeys) {
      outDlv[sk] = { ...(dlv[lk] || {}), ...(outDlv[sk] || {}) };
      changed = true;
    }
  }
  return changed ? { ...co, delivery: outDlv } : co;
}

/**
 * The effective mapping: the stored/draft mapping_v3 with each AUTO dim's
 * values replaced by mergeAutoValues(deriveAutoValues(deliveryRows, kind),
 * stored values). Library dims pass through BY REFERENCE (untouched); the
 * input mapping is never mutated. This is a RENDER/CLASSIFY view only — it
 * must never be persisted (a derived label enters the draft only when the
 * user aliases it, see dnd.js addAliasToValue).
 *
 *   mapping          config.mapping_v3 (draft or saved), or null
 *   deliveryRows     [{key, fields}] (lib/mapping/rows.js buildDeliveryRows)
 *   deriveAutoValues the engine fn (MappingDims.deriveAutoValues) — injected
 *                    for host-testability; rows.js binds it for components
 *   returns          a new mapping object, or null when mapping is null/invalid
 */
export function buildEffectiveMapping(mapping, deliveryRows, deriveAutoValues) {
  if (!mapping || !Array.isArray(mapping.dimensions)) return null;
  const dimensions = mapping.dimensions.map((d) => {
    if (!d || !d.auto_kind) return d;
    return { ...d, values: mergeAutoValues(deriveAutoValues(deliveryRows, d.auto_kind), d.values || []) };
  });
  return {
    ...mapping,
    dimensions,
    cell_overrides: expandDeliveryLiOverrides(mapping.cell_overrides, deliveryRows),
  };
}

/**
 * Delivery creatives surface (v3.1 spec §10.5): the store's `creatives` aux rows
 * ({date, line_item_id, creative, …}) → { liId: [distinct creative names] } for
 * classifyAll's deliveryCreatives input. Keys are String(line_item_id);
 * consumers re-key to sub-row keys via rows.js:creativesBySubRow before
 * handing the map to classifyAll. Names trimmed, blank/missing rows dropped.
 * Returns null when the slice is absent/empty so callers' classify + mining
 * paths behave exactly as before the creatives feature.
 */
export function buildDeliveryCreativesMap(creatives) {
  if (!Array.isArray(creatives) || creatives.length === 0) return null;
  const byLi = {};
  for (const row of creatives) {
    const lid = row && row.line_item_id != null ? String(row.line_item_id) : '';
    const name = row && row.creative != null ? String(row.creative).trim() : '';
    if (!lid || !name) continue;
    (byLi[lid] || (byLi[lid] = new Set())).add(name);
  }
  const out = {};
  for (const lid of Object.keys(byLi)) out[lid] = [...byLi[lid]];
  return Object.keys(out).length ? out : null;
}
