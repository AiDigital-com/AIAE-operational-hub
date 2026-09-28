/**
 * Grouping tables for dimension-source values. Ported from the retired SPA's
 * `workspace/src/lib/dashboard/dim-groups.js` - the value-resolution half only (`fold`,
 * `DEVICE_GROUPS`, `groupsFor`, `tableFromStored`, `indexFor`, `groupValue`).
 *
 * NOT ported: everything below the reference's `// ── candidates:` banner (`stripDecoration`,
 * `headToken`, `PLATFORM_SUFFIX`, `groupCandidates`) - it generates merge PROPOSALS for the SPA's
 * mapping settings screen, which this app does not have.
 *
 * One device arrives from the marts under several spellings - 'Ctv', 'Connected Tv',
 * 'Connected_Tv' and 'Connected Tvs' are the same screen, almost certainly one per DSP. Measured
 * 2026-08-09: device_type has 26 distinct values for four real families. Without this table a
 * device breakdown lists the same thing four times.
 *
 * Two rules that matter:
 *   - Anything not in the table passes through unchanged. The table is a set of explicit merges,
 *     not a list of allowed values, so a new value from a new DSP appears on its own rather than
 *     disappearing.
 *   - `drop` means "fold into the no-value bucket", never "delete". The parts must still add up to
 *     delivery (spec §5.2), so deleting a value would break the arithmetic the UI relies on.
 */

/** A grouping table: display label -> the raw spellings it absorbs, plus the folded-away values. */
export interface DimGroupTable {
  groups: Record<string, readonly string[]>;
  drop: readonly string[];
}

/** `groupValue`'s answer. `drop: true` means "fold into the no-value bucket", never "delete". */
export interface GroupedValue {
  label: string;
  drop: boolean;
}

/**
 * The comparison form both the read side (here) and the save side use. dash-gate's validator
 * refuses one value claimed by two groups, and comparing raw strings there let `Hulu` and
 * `⎵hulu⎵` both save while this side then answered with whichever came last - so dash-gate keeps
 * a copy of this exact function, and Pacing's `tests/dim-group-fold-parity-test.mjs` runs the two
 * over one set of fixtures.
 */
export function fold(s: unknown): string {
  // The mart mixes case and separators for the same device, so compare on a
  // form with both removed. A hyphen only counts as a separator between two
  // letters: '-1' is on the drop list, and removing every hyphen would fold a
  // bare '1' onto it, so the first number a new platform reports would inherit a
  // rule written for something else and disappear. The lookahead leaves the
  // right-hand letter unconsumed, so runs like 'set-top-box' collapse whole.
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "")
    .replace(/([a-z])-+(?=[a-z])/g, "$1");
}

export const DEVICE_GROUPS: DimGroupTable = {
  groups: {
    Mobile: ["Mobile", "Iphone", "Smart Phone", "Smartphone", "Android"],
    Desktop: ["Desktop", "Personal Computer", "Pc", "Computer"],
    CTV: [
      "Ctv",
      "Connected Tv",
      "Connected_Tv",
      "Connected Tvs",
      "Set Top Box",
      "Set_Top_Box",
      "Games_Console",
      "Connected Device",
      "Connected_Device",
    ],
    Tablet: ["Tablet", "Ipad"],
  },
  // Values that carry no information. 'Other' and 'Homeassistant' are NOT here:
  // they are real answers the DSP gave, and hiding a real answer inside "no
  // value" would misreport what was measured.
  drop: ["Unknown", "-1", "Wap"],
};

const TABLES: Record<string, DimGroupTable> = { device_type: DEVICE_GROUPS };

interface FoldedIndex {
  byValue: Map<string, string>;
  dropped: Set<string>;
}

// Built once per table: folded raw value -> label, and the folded drop set.
const INDEX = new Map<DimGroupTable, FoldedIndex>();
function indexFor(table: DimGroupTable): FoldedIndex {
  const cached = INDEX.get(table);
  if (cached) return cached;
  const byValue = new Map<string, string>();
  for (const [label, members] of Object.entries(table.groups)) {
    for (const m of members) byValue.set(fold(m), label);
  }
  const dropped = new Set(table.drop.map(fold));
  const built: FoldedIndex = { byValue, dropped };
  INDEX.set(table, built);
  return built;
}

/** The built-in table for a dimension, or null - only `device_type` has one. */
export function groupsFor(dimKey: string): DimGroupTable | null {
  return Object.prototype.hasOwnProperty.call(TABLES, dimKey) ? TABLES[dimKey] : null;
}

// A per-source dictionary, as stored: [{label, members:[raw…], drop?}]. Converted
// to the same shape the built-in table has, and cached BY REFERENCE - the array
// comes from the payload and is stable between renders, so the index is built once
// per edit rather than once per row.
const STORED_INDEX = new Map<readonly unknown[], DimGroupTable>();
function tableFromStored(list: readonly unknown[]): DimGroupTable {
  const cached = STORED_INDEX.get(list);
  if (cached) return cached;
  // NULL-prototype, because the label comes from a spreadsheet. `groups[label]`
  // for the single label '__proto__' runs the inherited setter instead of making
  // a key: the group is accepted by the validator, stored, and then silently
  // absent here - its values resolve to themselves and the merge the user made
  // is gone with no error anywhere. dim-coverage.ts already guards its buckets
  // with defineProperty for exactly this; this is the same hole on the way in.
  const groups: Record<string, readonly string[]> = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  const drop: string[] = [];
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    const entry = g as Record<string, unknown>;
    const label = entry.label;
    const members = entry.members;
    if (typeof label !== "string" || !label || !Array.isArray(members)) continue;
    // Members are folded before use, so coercing here changes nothing fold would not.
    const asStrings = members.map((m: unknown) => String(m ?? ""));
    if (entry.drop) drop.push(...asStrings);
    else groups[label] = asStrings;
  }
  const table: DimGroupTable = { groups, drop };
  STORED_INDEX.set(list, table);
  return table;
}

/**
 * Resolve one raw value to its display label.
 *
 * `stored` is this SOURCE's dictionary for this dimension, straight off the opaque payload
 * (`data.dim_sources[].groups[dimKey]`). It is passed rather than looked up by dimension name
 * because two sources may both map a column called `city`: resolving by name alone would silently
 * merge one source's spellings into the other's. The built-in device table stays the fallback for
 * rows that carry no dictionary of their own.
 */
export function groupValue(dimKey: string, raw: unknown, stored?: unknown): GroupedValue {
  const value = String(raw == null ? "" : raw);
  const table =
    Array.isArray(stored) && stored.length ? tableFromStored(stored) : groupsFor(dimKey);
  if (!table || value === "") return { label: value, drop: false };
  const { byValue, dropped } = indexFor(table);
  const key = fold(value);
  if (dropped.has(key)) return { label: value, drop: true };
  const label = byValue.get(key);
  return { label: label === undefined ? value : label, drop: false };
}
