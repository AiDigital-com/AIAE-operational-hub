// workspace/src/lib/dashboard/dim-groups.js
//
// One device arrives from the marts under several spellings — 'Ctv',
// 'Connected Tv', 'Connected_Tv' and 'Connected Tvs' are the same screen, almost
// certainly one per DSP. Measured 2026-08-09: device_type has 26 distinct values
// for four real families. Without this table a device breakdown lists the same
// thing four times.
//
// Two rules that matter:
//   - Anything not in the table passes through unchanged. The table is a set of
//     explicit merges, not a list of allowed values, so a new value from a new
//     DSP appears on its own rather than disappearing.
//   - `drop` means "fold into the no-value bucket", never "delete". The parts
//     must still add up to delivery (spec §5.2), so deleting a value would break
//     the arithmetic the UI relies on.
//
// Spec: docs/superpowers/specs/2026-08-09-dimension-sources-design.md §7

// Exported because the SAVE side has to compare what this side compares: the
// server validator refuses one value claimed by two groups, and comparing raw
// strings there let `Hulu` and `⎵hulu⎵` both save and this function then answer
// with whichever came last. dash-gate cannot import from here (its image carries
// dash-gate/lib and /shared only), so it keeps a copy of this exact function,
// and tests/dim-group-fold-parity-test.mjs runs the two over one set of fixtures.
export function fold(s) {
  // The mart mixes case and separators for the same device, so compare on a
  // form with both removed. A hyphen only counts as a separator between two
  // letters: '-1' is on the drop list, and removing every hyphen would fold a
  // bare '1' onto it, so the first number a new platform reports would inherit a
  // rule written for something else and disappear. The lookahead leaves the
  // right-hand letter unconsumed, so runs like 'set-top-box' collapse whole.
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
    .replace(/([a-z])-+(?=[a-z])/g, '$1');
}

export const DEVICE_GROUPS = {
  groups: {
    Mobile: ['Mobile', 'Iphone', 'Smart Phone', 'Smartphone', 'Android'],
    Desktop: ['Desktop', 'Personal Computer', 'Pc', 'Computer'],
    CTV: ['Ctv', 'Connected Tv', 'Connected_Tv', 'Connected Tvs',
          'Set Top Box', 'Set_Top_Box', 'Games_Console',
          'Connected Device', 'Connected_Device'],
    Tablet: ['Tablet', 'Ipad'],
  },
  // Values that carry no information. 'Other' and 'Homeassistant' are NOT here:
  // they are real answers the DSP gave, and hiding a real answer inside "no
  // value" would misreport what was measured.
  drop: ['Unknown', '-1', 'Wap'],
};

const TABLES = { device_type: DEVICE_GROUPS };

// Built once per table: folded raw value -> label, and the folded drop set.
const INDEX = new Map();
function indexFor(table) {
  if (INDEX.has(table)) return INDEX.get(table);
  const byValue = new Map();
  for (const [label, members] of Object.entries(table.groups)) {
    for (const m of members) byValue.set(fold(m), label);
  }
  const dropped = new Set(table.drop.map(fold));
  const built = { byValue, dropped };
  INDEX.set(table, built);
  return built;
}

export function groupsFor(dimKey) {
  return Object.prototype.hasOwnProperty.call(TABLES, dimKey) ? TABLES[dimKey] : null;
}

// A per-source dictionary, as stored: [{label, members:[raw…], drop?}]. Converted
// to the same shape the built-in table has, and cached BY REFERENCE — the array
// comes from the store and is stable between renders, so the index is built once
// per edit rather than once per row.
const STORED_INDEX = new Map();
function tableFromStored(list) {
  if (STORED_INDEX.has(list)) return STORED_INDEX.get(list);
  // NULL-prototype, because the label comes from a spreadsheet. `groups[label]`
  // for the single label '__proto__' runs the inherited setter instead of making
  // a key: the group is accepted by the validator, stored, and then silently
  // absent here — its values resolve to themselves and the merge the user made
  // is gone with no error anywhere. dim-coverage.js already guards its buckets
  // with defineProperty for exactly this; this is the same hole on the way in.
  const groups = Object.create(null);
  const drop = [];
  for (const g of list) {
    if (!g || !g.label || !Array.isArray(g.members)) continue;
    if (g.drop) drop.push(...g.members);
    else groups[g.label] = g.members;
  }
  const table = { groups, drop };
  STORED_INDEX.set(list, table);
  return table;
}

/**
 * Resolve one raw value to its display label.
 *
 * `stored` (wave 3) is this SOURCE's dictionary for this dimension. It is passed
 * rather than looked up by dimension name because two sources may both map a
 * column called `city`: resolving by name alone would silently merge one
 * source's spellings into the other's. The built-in device table stays the
 * fallback for rows that carry no dictionary of their own.
 */
export function groupValue(dimKey, raw, stored) {
  const value = String(raw == null ? '' : raw);
  const table = Array.isArray(stored) && stored.length ? tableFromStored(stored) : groupsFor(dimKey);
  if (!table || value === '') return { label: value, drop: false };
  const { byValue, dropped } = indexFor(table);
  const key = fold(value);
  if (dropped.has(key)) return { label: value, drop: true };
  const label = byValue.get(key);
  return { label: label === undefined ? value : label, drop: false };
}

// ── candidates: what to PROPOSE merging, never what to merge ────────────────
//
// Three layers, in increasing boldness. Measured on the owner's export
// (spec §1.2): layer 2 alone collapses 6 176 values to 5 802 — it is layer 3
// that catches Hulu's ten spellings, CNN's two and The Weather Channel's two.
//
// Nothing here is applied unasked. The built-in device presets ship applied
// because that vocabulary was audited once; these are generated per sheet and
// can be wrong, so a human confirms each one.

// The separator is OPTIONAL. Real exports carry both shapes — "Hulu - Roku (2285)"
// and "Hulu iOS" — and requiring a dash left the second one ungrouped while the
// first two collapsed, which is exactly the "same app, three rows" this exists to
// prevent. Seen on the owner's own list.
const PLATFORM_SUFFIX = /\s*(?:[-:–|]\s*)?(roku|android tv|androidtv|android|firetv|fire tv|lg tv|lgtv|samsung tv|samsungtv|apple tv|appletv|tvos|ios|iphone|ipad|vizio|xbox|playstation|ps4|ps5|web|tizen|smart ?tv|ctv)\s*$/i;

/** `Hulu - Samsung Tv (G16028006310)` → `Hulu`. */
function stripDecoration(value) {
  let s = String(value == null ? '' : value).trim();
  // The trailing "(…)" is an app id, and it is NOT enough on its own: the export
  // carries two different `Hulu - Samsung Tv` ids.
  s = s.replace(/\s*\([^()]*\)\s*$/, '').trim();
  let prev = null;
  while (prev !== s) { prev = s; s = s.replace(PLATFORM_SUFFIX, '').trim(); }
  return s;
}

/** The leading token: everything before the first separator. */
function headToken(value) {
  return stripDecoration(value).split(/[-:–|]/)[0].trim();
}

// Two values whose numeric RANGES differ are never proposed: `50-64` folded into
// `55-64` double-counts, and there is no way for a user to see that from a list
// of labels. Carried from wave-1 spec §7.
const RANGE_RE = /\d+\s*[-–]\s*\d+|\d+\s*\+/;

/**
 * @param {Array<{value:string, weight:number}>} values  distinct values, ranked
 * @returns {Array<{label:string, members:string[], weight:number, layer:number}>}
 *   proposals only, biggest first; a value appears in at most one.
 */
export function groupCandidates(values) {
  const list = (Array.isArray(values) ? values : [])
    .map((v) => (typeof v === 'string' ? { value: v, weight: 0 } : v))
    .filter((v) => v && typeof v.value === 'string' && v.value.trim() !== '');

  const claimed = new Set();
  const out = [];
  // The LABEL must come from whatever the layer matched on, not from the shortest
  // member: two Weather Channel rows collapse on their leading token, and naming
  // the group after one of them ("The Weather Channel - Radar") describes one
  // member rather than the family.
  const collect = (keyOf, layer, labelOf) => {
    const buckets = new Map();
    for (const v of list) {
      if (claimed.has(v.value)) continue;
      const k = keyOf(v.value);
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(v);
    }
    for (const [, members] of buckets) {
      if (members.length < 2) continue;
      // A range on one side and not the other, or two different ranges: leave
      // them apart. Equal ranges fold like anything else.
      const ranges = members.map((m) => (m.value.match(RANGE_RE) || [''])[0]);
      if (new Set(ranges).size > 1) continue;
      const shortest = members.reduce((a, b) => (a.value.length <= b.value.length ? a : b)).value;
      const label = labelOf(shortest);
      out.push({
        label: label || shortest,
        members: members.map((m) => m.value),
        weight: members.reduce((s, m) => s + (Number(m.weight) || 0), 0),
        layer,
      });
      for (const m of members) claimed.add(m.value);
    }
  };

  // the same value, spelled differently — keep it as written
  collect((v) => fold(v), 1, (v) => v);
  // …once the id and the platform are gone
  collect((v) => fold(stripDecoration(v)), 2, stripDecoration);
  // …and by the name it leads with
  collect((v) => fold(headToken(v)), 3, headToken);

  return out.sort((a, b) => b.weight - a.weight);
}
