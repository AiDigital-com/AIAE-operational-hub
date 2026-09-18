/**
 * Bulk-edit helpers for the Create Pacing review panel (§8, US-123/124) - a faithful TypeScript port
 * of the retired SPA's `workspace/src/lib/create-bulk.js` (BULK_FIELDS, coerceValue, matchTable,
 * GAP_FILTERS, viewOrder), renamed to the Hub's camelCase field keys.
 *
 * This is string parsing, not pacing arithmetic: `coerceValue` turns what a person typed or pasted
 * from a spreadsheet into a plain number/date string, and `viewOrder`/`GAP_FILTERS` filter/sort rows
 * by fields already on screen. Nothing here sums, prorates or otherwise computes a pacing figure -
 * that ban is unaffected.
 */

/** A bulk-editable field's value kind - drives both `coerceValue` and the paste-table header match. */
export type BulkFieldKind = "num" | "int" | "date";

/** The seven fields a bulk-set or a pasted sheet may write, in the order offered (ported verbatim). */
export type BulkFieldKey =
  | "targetVcr"
  | "targetCtr"
  | "marginPercent"
  | "targetImpressions"
  | "nativeBudget"
  | "flightStart"
  | "flightEnd";

export interface BulkField {
  key: BulkFieldKey;
  label: string;
  kind: BulkFieldKind;
}

export const BULK_FIELDS: BulkField[] = [
  { key: "targetVcr", label: "VCR %", kind: "num" },
  { key: "targetCtr", label: "CTR %", kind: "num" },
  { key: "marginPercent", label: "Margin %", kind: "num" },
  { key: "targetImpressions", label: "MP Units", kind: "int" },
  { key: "nativeBudget", label: "MP Budget", kind: "num" },
  { key: "flightStart", label: "Start date", kind: "date" },
  { key: "flightEnd", label: "End date", kind: "date" },
];

// ── Value coercion ──
// Numbers tolerate "70%", NBSP/space thousands, "1,234" thousands and "1,5" decimal-comma. Dates
// accept YYYY-MM-DD and DD.MM.YYYY. Ported verbatim from create-bulk.js's coerceValue.
export type CoerceResult = { ok: true; value: string } | { ok: false; error: string };

export function coerceValue(kind: BulkFieldKind, raw: string): CoerceResult {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "empty" };
  if (kind === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return { ok: true, value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
    return { ok: false, error: "bad date (YYYY-MM-DD or DD.MM.YYYY)" };
  }
  let t = s.replace(/%$/, "").replace(/[\s ]/g, "");
  if (t.includes(".") && t.includes(",")) t = t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{3}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "not a number" };
  if (kind === "int") return { ok: true, value: String(Math.round(n)) };
  return { ok: true, value: String(n) };
}

// ── Paste parsing (header-driven table) ──
// First row = headers; first column = LI ID (its header text is ignored); every other column is
// matched to a field by header alias. Copy straight from Google Sheets / Excel (TSV).
const HEADER_ALIASES: Record<BulkFieldKey, string[]> = {
  targetVcr: ["vcr", "vcr %", "target vcr"],
  targetCtr: ["ctr", "ctr %", "target ctr"],
  marginPercent: ["margin", "margin %", "margin%", "marja"],
  targetImpressions: ["mp units", "units", "impressions", "target impressions", "imp"],
  nativeBudget: ["mp budget", "budget", "spend", "target spend"],
  flightStart: ["start", "start date", "flight start"],
  flightEnd: ["end", "end date", "flight end"],
};

function headerToField(raw: string): BulkFieldKey | null {
  const h = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(h)) return field as BulkFieldKey;
  }
  return null;
}

export interface MatchColumn {
  field: BulkFieldKey;
  label: string;
  header: string;
  set: number;
  invalid: number;
}
export interface MatchUpdate {
  index: number;
  field: BulkFieldKey;
  value: string;
}
export interface MatchResult {
  error?: string;
  columns?: MatchColumn[];
  skippedHeaders?: string[];
  notFound?: string[];
  updates?: MatchUpdate[];
}

/**
 * Matches a pasted TSV table (as copied from Google Sheets/Excel) against `rows` by their
 * `lineItemId`, using REAL indexes into `rows`. Per LI+field, the last matching row wins. A blank
 * cell is skipped (not an error); an unmatched id is reported in `notFound`, not thrown.
 */
export function matchTable(text: string, rows: { lineItemId: string }[]): MatchResult {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { error: "empty" };
  const table = lines.map((l) => l.split("\t").map((c) => c.trim()));
  if (table[0].length < 2) {
    return {
      error:
        "need a header row and at least two columns (LI ID + a value column) — copy from Sheets keeps tabs",
    };
  }
  const headers = table[0];
  const cols: { at: number; field: BulkFieldKey; label: string; header: string }[] = [];
  const skippedHeaders: string[] = [];
  headers.forEach((h, at) => {
    if (at === 0) return; // LI ID column, any header text
    const field = headerToField(h);
    if (field) cols.push({ at, field, label: BULK_FIELDS.find((f) => f.key === field)?.label ?? field, header: h });
    else skippedHeaders.push(h || "(empty)");
  });
  if (cols.length === 0) {
    return { error: "no recognized column headers — expected any of: VCR, CTR, Margin, MP Units, MP Budget, Start, End" };
  }
  const byId = new Map<string, number>();
  rows.forEach((r, i) => byId.set(String(r.lineItemId).trim(), i));
  const seen = new Map<string, MatchUpdate>(); // `${index}:${field}` -> update slot (last wins)
  const notFound: string[] = [];
  const stats = new Map<BulkFieldKey, { set: number; invalid: number }>(
    cols.map((c) => [c.field, { set: 0, invalid: 0 }])
  );
  for (const row of table.slice(1)) {
    const id = String(row[0] || "").trim();
    if (!id) continue;
    const index = byId.get(id);
    if (index === undefined) {
      notFound.push(id);
      continue;
    }
    for (const c of cols) {
      const raw = row[c.at];
      if (raw === undefined || String(raw).trim() === "") continue; // blank cell = skip, not error
      const kind = BULK_FIELDS.find((f) => f.key === c.field)?.kind ?? "num";
      const v = coerceValue(kind, raw);
      const st = stats.get(c.field);
      if (!v.ok) {
        if (st) st.invalid += 1;
        continue;
      }
      const key = index + ":" + c.field;
      if (!seen.has(key) && st) st.set += 1;
      seen.set(key, { index, field: c.field, value: v.value });
    }
  }
  return {
    columns: cols.map((c) => ({ field: c.field, label: c.label, header: c.header, ...(stats.get(c.field) ?? { set: 0, invalid: 0 }) })),
    skippedHeaders,
    notFound: [...new Set(notFound)],
    updates: [...seen.values()],
  };
}

/**
 * One editable row's current on-screen values, for sorting/filtering (§8's gap-filter + bulk-edit
 * loop). Merges the line item's static NetSuite fields with whatever the reviewer has typed so far -
 * `viewOrder`/`GAP_FILTERS` need the LIVE values (a bulk-filled flight date must clear "missing"
 * immediately), not the original draft response.
 */
export interface BulkViewRow {
  lineItemId: string;
  channel: string | null;
  rateType: string;
  flightStart: string;
  flightEnd: string;
  marginPercent: string;
  targetImpressions: string;
  nativeBudget: string;
  targetCtr: string;
  targetVcr: string;
}

// ── Sorting / gap filter (view-order helpers — return REAL indexes) ──
export type BulkSortKey = keyof BulkViewRow;
type SortKey = BulkSortKey;
const SORTABLE: Record<SortKey, (row: BulkViewRow) => string | number> = {
  lineItemId: (r) => String(r.lineItemId || ""),
  channel: (r) => String(r.channel || "").toLowerCase(),
  rateType: (r) => String(r.rateType || ""),
  flightStart: (r) => String(r.flightStart || ""),
  flightEnd: (r) => String(r.flightEnd || ""),
  marginPercent: (r) => Number(r.marginPercent) || 0,
  targetImpressions: (r) => Number(String(r.targetImpressions).replace(/,/g, "")) || 0,
  nativeBudget: (r) => Number(String(r.nativeBudget).replace(/,/g, "")) || 0,
  targetCtr: (r) => Number(r.targetCtr) || 0,
  targetVcr: (r) => Number(r.targetVcr) || 0,
};

const isEmpty = (v: string | null | undefined): boolean => !String(v ?? "").trim();

export interface GapFilter {
  label: string;
  test: (row: BulkViewRow) => boolean;
}

export const GAP_FILTERS: Record<string, GapFilter> = {
  all: { label: "All rows", test: () => true },
  vcr: { label: "Missing VCR", test: (row) => isEmpty(row.targetVcr) },
  ctr: { label: "Missing CTR", test: (row) => isEmpty(row.targetCtr) },
  required: {
    label: "Missing required",
    test: (row) =>
      isEmpty(row.marginPercent) ||
      isEmpty(row.targetImpressions) ||
      isEmpty(row.nativeBudget) ||
      isEmpty(row.flightStart) ||
      isEmpty(row.flightEnd),
  },
};

export interface ViewOrderOptions {
  sortKey?: SortKey;
  sortDir?: "asc" | "desc";
  gapFilter?: string;
}

/** Filters `rows` by the named gap filter, then (optionally) sorts - stable, returns REAL indexes. */
export function viewOrder(rows: BulkViewRow[], { sortKey, sortDir, gapFilter }: ViewOrderOptions = {}): number[] {
  const gap = (gapFilter && GAP_FILTERS[gapFilter]) || GAP_FILTERS.all;
  let idxs = rows.map((_, i) => i).filter((i) => gap.test(rows[i]));
  if (sortKey && SORTABLE[sortKey]) {
    const get = SORTABLE[sortKey];
    const dir = sortDir === "desc" ? -1 : 1;
    idxs = [...idxs].sort((a, b) => {
      const va = get(rows[a]);
      const vb = get(rows[b]);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a - b; // stable
    });
  }
  return idxs;
}
