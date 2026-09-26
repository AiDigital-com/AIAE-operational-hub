/**
 * Fact-row-level filtering: `platforms` and `brk`/`brkf` narrow which delivery rows count, not
 * which line items do (that's `eff-lis.ts`). Ported from the internal `buildBreakdownFacts` and its
 * helpers inside the vendored `dashboard-metrics.js` (search that file for `OUTSIDE_KEY` /
 * `buildBreakdownFacts`) - that copy is NOT exported from `DashboardMetrics.create()`'s returned
 * instance (it's a private closure used for the engine's own widget-level breakdown scoping), so it
 * is ported here rather than called, using the exported `buildFactsAggregates` to recompute the
 * filtered `LD`/`LSD` exactly the way the engine's own copy does.
 *
 * This is the simpler, 4-argument form (`facts, filters, rate, planMap`) that both the vendored
 * engine's internal copy and the retired SPA's oldest `breakdown-filter.js` share - it does not
 * carry the SPA's later `containerFilters` parameter (period/container scoping), which is out of
 * scope for the dashboard filter bar (§6 of the migration; containers are read-only reference
 * figures here, matching `dash-gate/lib/merge.mjs`'s own unfiltered container readings).
 *
 * `derivePlatforms`/`deriveDimValues` are NOT re-ported here - `journal/fact-dims.ts` already has
 * them (ported for the journal tag palette); this module reuses that copy.
 */
import { getPacingCore } from "../engine/engine-loader";
import type { FactRow, LiDaily, LiPlanMap } from "../engine/vendor-types";

/** Synthetic value for "everything this line item's covering containers do NOT declare" - the one
 *  negative filter in the system, bound to one line item (`<dim>:__outside__@<liId>`). */
export const OUTSIDE_KEY = "__outside__";

// Namebuilder positions tracked as independent dim axes (per-position model).
const OTHER_DIMS = ["comment", "geo", "creative", "message", "keyword", "flight", "language"];

/** Dims that may appear in `brk`/`brkf` URL state. */
export const FILTERABLE_DIMS = ["audience", "tactic", "platform", ...OTHER_DIMS];

export interface BreakdownFiltersInput {
  brkf?: string[] | string;
  platforms?: (string | null)[];
}

interface OutsideEntry {
  dim: string;
  liId: string;
}

interface ParsedPair {
  dim: string;
  key: string;
  liId?: string;
}

/** Parses the multi-value breakdown filter. Accepts `string[]` (canonical) or a legacy single
 *  `'dim:value'` string. Order-preserving dedup; unknown dims and the muted buckets are rejected. */
export function parseBreakdownFilters(filters: BreakdownFiltersInput | null | undefined): ParsedPair[] {
  const raw = Array.isArray(filters?.brkf)
    ? filters!.brkf!
    : typeof filters?.brkf === "string" && filters.brkf
      ? [filters.brkf]
      : [];
  const out: ParsedPair[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const s = String(entry).trim();
    const idx = s.indexOf(":");
    if (idx <= 0) continue;
    const dim = s.slice(0, idx);
    const key = s.slice(idx + 1).trim();
    if (!FILTERABLE_DIMS.includes(dim)) continue;
    if (key.startsWith(OUTSIDE_KEY)) {
      const at = key.indexOf("@");
      const liId = at > 0 ? key.slice(at + 1).trim() : "";
      if (!liId) continue;
      const osig = `${dim}:${OUTSIDE_KEY}@${liId}`;
      if (seen.has(osig)) continue;
      seen.add(osig);
      out.push({ dim, key: OUTSIDE_KEY, liId });
      continue;
    }
    if (!key || key === "__others__" || key === "__unclassified__") continue;
    const sig = `${dim}:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ dim, key });
  }
  return out;
}

/** Groups parsed VALUE pairs: `Map<dim, Set<value>>`. AND across dims, OR within one. Outside
 *  pairs are not values and are excluded. */
export function groupBreakdownFilters(list: ParsedPair[]): Map<string, Set<string>> {
  const byDim = new Map<string, Set<string>>();
  for (const f of list ?? []) {
    if (f.key === OUTSIDE_KEY) continue;
    if (!byDim.has(f.dim)) byDim.set(f.dim, new Set());
    byDim.get(f.dim)!.add(f.key);
  }
  return byDim;
}

/** The outside pairs of a parsed list. */
export function outsideFiltersOf(list: ParsedPair[]): OutsideEntry[] {
  const out: OutsideEntry[] = [];
  for (const f of list ?? []) {
    if (f.key === OUTSIDE_KEY && f.liId) out.push({ dim: f.dim, liId: String(f.liId) });
  }
  return out;
}

/** Per-LI dim-scope indexes for the line items an outside filter names. */
export function outsideIndexes(outside: OutsideEntry[], planMap: LiPlanMap): Record<string, unknown> {
  const PacingCore = getPacingCore();
  const idx: Record<string, unknown> = {};
  for (const o of outside ?? []) {
    if (idx[o.liId]) continue;
    const plan = planMap && planMap[o.liId];
    idx[o.liId] = plan ? PacingCore.buildDimScopeIndex(plan) : null;
  }
  return idx;
}

/** Read a fact's value for a given dim key. Empty / '-' / missing -> ''. */
function readDimValue(fact: FactRow, dim: string): string {
  const raw = fact && fact[dim] != null ? String(fact[dim]).trim() : "";
  return raw && raw !== "-" ? raw : "";
}

/** Does a fact row satisfy every active outside filter? A row of ANOTHER line item never does. */
export function factMatchesOutside(
  fact: FactRow,
  outside: OutsideEntry[],
  indexes: Record<string, unknown>
): boolean {
  const PacingCore = getPacingCore();
  for (const o of outside) {
    if (String((fact && fact.line_item_id) || "") !== o.liId) return false;
    if (!PacingCore.factOutsideSplits(indexes[o.liId], o.dim, fact)) return false;
  }
  return true;
}

export function factMatchesBreakdownFilters(fact: FactRow, byDim: Map<string, Set<string>>): boolean {
  for (const [dim, values] of byDim) {
    if (!values.has(readDimValue(fact, dim))) return false;
  }
  return true;
}

export interface FactsBundle {
  factsDaily: FactRow[];
  liDaily: LiDaily;
  liSplitDaily?: Record<string, Record<string, Record<string, Record<string, number>>>>;
  asOf: string | null;
  rate?: number | null;
}

/**
 * Filters `facts.factsDaily` by `platforms`/`brk`/`brkf` and rebuilds `liDaily`/`liSplitDaily` from
 * the filtered rows via the vendored engine's `buildFactsAggregates` - THE choke point: `planMap`
 * carries the per-LI coef override so a filtered view resolves `dc` identically to the unfiltered
 * aggregate.
 *
 * Returns `facts` UNCHANGED, by reference, when no filter is active - matching the vendored
 * engine's own short-circuit (`if (brkFilters.length === 0 && platforms.length === 0) return
 * facts;`). This is what makes the no-filter crown test hold without special-casing: the caller
 * hands in the already-unfiltered `liDaily` (from `normalize()`) as part of `facts`, and gets that
 * exact object back when there is nothing to filter.
 */
export function buildBreakdownFacts(
  facts: FactsBundle | null | undefined,
  filters: BreakdownFiltersInput,
  rate: number | null | undefined,
  planMap: LiPlanMap,
  buildFactsAggregates: (
    factsDaily: FactRow[],
    rate: number | null | undefined,
    planMap: LiPlanMap
  ) => { LD: LiDaily; LSD: FactsBundle["liSplitDaily"]; asOf: string | null }
): FactsBundle | null {
  if (!facts) return null;
  const brkFilters = parseBreakdownFilters(filters);
  const platforms = Array.isArray(filters?.platforms) ? filters.platforms.filter((p) => p != null) : [];
  if (brkFilters.length === 0 && platforms.length === 0) return facts;
  if (!Array.isArray(facts.factsDaily)) return facts;

  const platformSet = platforms.length ? new Set(platforms.map((p) => String(p))) : null;
  const byDim = groupBreakdownFilters(brkFilters);
  const outside = outsideFiltersOf(brkFilters);
  const outIdx = outside.length ? outsideIndexes(outside, planMap) : null;

  const filteredFactsDaily = facts.factsDaily.filter((fact) => {
    if (platformSet && !platformSet.has(String(fact.platform ?? ""))) return false;
    if (byDim.size > 0 && !factMatchesBreakdownFilters(fact, byDim)) return false;
    if (outIdx && !factMatchesOutside(fact, outside, outIdx)) return false;
    return true;
  });

  const { LD, LSD } = buildFactsAggregates(filteredFactsDaily, rate, planMap);

  return {
    factsDaily: facts.factsDaily,
    liDaily: LD,
    liSplitDaily: LSD,
    asOf: facts.asOf,
    rate: facts.rate,
  };
}
