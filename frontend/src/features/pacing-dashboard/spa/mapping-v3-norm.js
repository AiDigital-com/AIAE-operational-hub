// workspace/src/lib/settings/mapping-v3-norm.js
//
// Pure dirty-detection fingerprint for the Settings · Mapping tab's v3
// dimension-library model (config_json.mapping_v3, spec 2026-07-05
// docs/superpowers/specs/2026-07-05-mapping-v3-dimensions-design.md §2).
// Replaces third-party-norm.js:normMappings (the v1 pairs/overrides model).
//
// The drawer's unified save contract diffs baseRef (the fingerprint at load)
// against the live fingerprint of the working mapping_v3 to decide "dirty".
// So the fingerprint MUST change on every author-visible edit and MUST NOT
// change on incidental object-key reordering. No React, no DOM, no imports —
// plain ESM so host tests import it directly.
//
// Sensitive to (all change the fingerprint):
//   - dimension REORDER (array order = column / breakdown order = meaning);
//   - dimension rename, source / auto_kind change;
//   - value add / remove / REORDER (dropdown order is meaning — values kept in
//     array order, unlike aliases);
//   - alias add / remove (aliases are a SET — order does not matter);
//   - cell_override add / remove / value change, either side.
// Insensitive to:
//   - object key order anywhere (fields are read by name; override maps are
//     flattened to sorted tuples);
//   - alias ORDER (aliases are sorted before hashing).
// Audit fields (updated_at / updated_by) are excluded — they are stamped
// server-side and the user never edits them, so they must not drive dirtiness.

function normValue(v) {
  // value kept verbatim (order-significant); aliases sorted (set semantics).
  return [v.value, [...(v.aliases || [])].sort()];
}

function normDimension(d) {
  return [
    d.id,
    d.name || '',
    d.source,
    d.auto_kind ?? null,
    (d.values || []).map(normValue),
  ];
}

// Flatten { delivery|cm360: { rowKey: { dimId: value } } } into [side, key,
// dimId, value] tuples and sort — makes the fingerprint independent of key
// insertion order while staying sensitive to any added / removed / changed pick.
function normOverrides(cellOverrides) {
  const co = cellOverrides || {};
  const tuples = [];
  for (const side of ['delivery', 'cm360']) {
    const sideMap = co[side] || {};
    for (const key of Object.keys(sideMap)) {
      const inner = sideMap[key] || {};
      for (const dimId of Object.keys(inner)) {
        tuples.push([side, key, dimId, inner[dimId]]);
      }
    }
  }
  tuples.sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  });
  return tuples;
}

/** Stable fingerprint of a mapping_v3 BODY object (or null). */
export function normMappingV3(m) {
  if (!m || typeof m !== 'object') return JSON.stringify(null);
  return JSON.stringify([
    (m.dimensions || []).map(normDimension),
    normOverrides(m.cell_overrides),
  ]);
}

// Stable fingerprint of a mappings_v3 ENTITY list (v3.2). Each entity is
// reduced to [id, name, kind, level, <body fingerprint>] IN ORDER — so an
// entity rename, kind change, level change (D5, spec 2026-07-10; absent level
// normalizes to 'placement', its default), reorder, add/remove, or any body
// edit (via normMappingV3, which reads dimensions + cell_overrides off the
// entity) all move the fingerprint; audit fields never do (normMappingV3
// excludes them). null / a non-array collapse to the same "empty" fingerprint.
export function normMappingsV3(list) {
  if (!Array.isArray(list)) return JSON.stringify(null);
  return JSON.stringify(list.map((e) => [
    (e && e.id) || '',
    (e && e.name) || '',
    (e && e.kind) || '',
    (e && (e.level === 'creative' || e.level === 'li_creative')) ? e.level : 'placement',
    normMappingV3(e),
  ]));
}
