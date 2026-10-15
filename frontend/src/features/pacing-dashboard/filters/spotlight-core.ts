/**
 * Pure, framework-free core for the FilterBar's Spotlight search (Task 1 of the 2026-09-25 filter
 * bar brief) - a TypeScript port of the retired SPA's
 * `workspace/src/lib/dashboard/filter-spotlight-core.js`, the same way `journal/tags-core.ts` was
 * ported from `journal-tags-core.js` (see that pair for the house pattern: same behaviour, only
 * the syntax and the input shapes change to the Hub's own contract). Golden-tested against that
 * file's own `tests/filter-spotlight-core-test.mjs` (ported to `spotlight-core.test.ts`).
 *
 * One search across every filterable entity - line items, channels, labels, platforms, breakdown
 * dim values - each tagged with its Scope/Lens TIER (see `tierOf` below). `browseSources` builds
 * the two-section catalogue the panel shows on focus with an empty query; `searchFilterSources`
 * is the flat fuzzy ranking it shows once the reader types, reusing the SAME ranker
 * `journal/tags-core.ts`'s tag palette uses (`rankSources` is generic over `{type,value,display}` -
 * see that file's own docblock). `patchForSource` is what clicking or Entering a result does to
 * `DashboardFilters`.
 *
 * Differences from the reference, all forced by the Hub's contract shape rather than a behaviour
 * change:
 *   - A line item reads by its custom display name (`display.liNames[id]`, Settings → Pacing)
 *     when it has one, as in the reference; with none, by `PacingLineItemPlanV1.description`
 *     (`types.ts`'s own docblock: "the closest thing to a display name"), where the reference
 *     shows the bare id.
 *   - `liPlan[id].ch` -> `liPlan[id].channel` (the Hub's own field name).
 *   - `facts.factsDaily` -> a flat `factsDaily` array (the Hub passes it as its own prop, not
 *     nested under a `facts` object).
 *   - Values are RAW here too, same as the reference (filters match raw strings; no tag grammar,
 *     no slugify - see the reference file's own note on this).
 *
 * Dim values follow the reference's rule: Scope iff the value carries a declared split target
 * (`collectSplitKeys`, the moved `spa/dim-scope.js`'s own). The claim is backed on this page: the
 * board's widgets resolve a split-backed `brkf` chip through the moved `spa/selectors.js`
 * (`resolvePlanningScope` -> `matchDimSplits`), re-pacing against the split's own target, and the
 * dashboard alerts do the same (`../engine/build-alerts.ts`). Between 2026-09-25 and 2026-10-14
 * this file tagged every dim value Lens on the premise that `dim-scope.js` was not in this build;
 * it has been, under `spa/`, since the renderer moved, so that departure is gone.
 */
import { rankSources } from "../journal/tags-core";
import type { TagSource } from "../journal/tags-core";
import { derivePlatforms, deriveDimValues, formatPlatform } from "../journal/fact-dims";
import type { FactRow } from "../journal/fact-dims";
import { FILTERABLE_DIMS } from "./breakdown-filter";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { collectSplitKeys as collectSplitKeysMoved } from "../spa/dim-scope.js";
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";

export const KIND_LABELS: Record<string, string> = {
  li: "Line item",
  channel: "Channel",
  label: "Label",
  platform: "Platform",
  audience: "Audience",
  tactic: "Funnel",
  comment: "Comment",
  geo: "Geo",
  creative: "Creative",
  message: "Message",
  keyword: "Keyword",
  flight: "Flight",
  language: "Language",
};

export type FilterTier = "scope" | "lens";

export interface FilterSource {
  type: string;
  value: string;
  display: string;
  tier: FilterTier;
}

/** The line-item-plan shape this file reads - deliberately the narrow slice `PacingLineItemPlanV1`
 *  actually carries for this purpose (channel/labels/description/containers), not the whole
 *  generated type, so a test fixture doesn't have to fabricate every other field. */
export interface SpotlightLiPlan {
  channel?: string | null;
  labels?: string[] | null;
  description?: string | null;
  containers?: readonly SplitContainer[] | null;
}

/** Only the fields `collectSplitKeys` reads off a container/dim-child - `PacingLineItemPlanV1`'s
 *  own `containers` field is opaque on the wire (`{[key:string]:unknown}[]`, see `types.ts`), so
 *  this file reads it structurally rather than importing the settings-side `PacingContainer`/
 *  `PacingDimChild` types wholesale. */
export interface SplitDimChild {
  dim_key?: string | null;
  dim_value?: string | null;
  target_mode?: "absolute" | "percent";
  target_value?: number | null;
}
export interface SplitContainer {
  target_impressions?: number | null;
  dim_children?: readonly SplitDimChild[] | null;
}

/**
 * Every '<dim_key>:<dim_value>' that has a declared dim split (a positive target) across ALL line
 * items - the moved `spa/dim-scope.js:collectSplitKeys` itself, typed for this file's callers.
 */
export function collectSplitKeys(
  liPlan: Record<string, SpotlightLiPlan | null | undefined> | null | undefined
): Set<string> {
  return collectSplitKeysMoved(liPlan ?? {}) as Set<string>;
}

/**
 * Tier of a single browse/spotlight source, the reference's `filter-spotlight-core.js:tierOf`:
 * `li`/`channel`/`label` are Scope (plan-backed, pace the whole dashboard); `platform` is Lens
 * (delivery-only, narrows the breakdown, never the headline); any other type is a breakdown dim
 * value - Scope iff it has a declared split (`splitKeys`), else Lens.
 */
export function tierOf(source: Pick<FilterSource, "type" | "value">, splitKeys: Set<string>): FilterTier {
  if (!source) return "lens";
  switch (source.type) {
    case "li":
    case "channel":
    case "label":
      return "scope";
    case "platform":
      return "lens";
    default:
      // a dim source (audience/tactic/geo/…): Scope iff it has a declared split.
      return splitKeys && splitKeys.has(`${source.type}:${source.value}`) ? "scope" : "lens";
  }
}

export interface BuildFilterSourcesInput {
  liPlan?: Record<string, SpotlightLiPlan | null | undefined> | null;
  factsDaily?: readonly FactRow[] | null;
  /** The custom display names by line item id (`display.liNames`), when the pacing has any. */
  liNames?: Record<string, string> | null;
}

/** Builds the full, tier-tagged source list the spotlight searches/browses: every line item,
 *  channel, label, platform and breakdown-dim value this pacing carries. Ported from the
 *  reference's `buildFilterSources` - see this file's docblock for the input-shape differences. */
export function buildFilterSources({ liPlan, factsDaily, liNames }: BuildFilterSourcesInput = {}): FilterSource[] {
  const items: Array<Omit<FilterSource, "tier">> = [];

  for (const [id, plan] of Object.entries(liPlan ?? {})) {
    const name = liNames?.[id] || plan?.description || "";
    items.push({ type: "li", value: id, display: name ? `${id} — ${name}` : id });
  }

  const channels = new Set<string>();
  const labels = new Set<string>();
  for (const plan of Object.values(liPlan ?? {})) {
    if (!plan) continue;
    if (plan.channel) channels.add(plan.channel);
    for (const l of plan.labels ?? []) labels.add(l);
  }
  for (const ch of [...channels].sort()) items.push({ type: "channel", value: ch, display: ch });
  for (const l of [...labels].sort()) items.push({ type: "label", value: l, display: l });

  for (const raw of derivePlatforms(factsDaily)) {
    items.push({ type: "platform", value: raw, display: formatPlatform(raw) });
  }

  for (const dim of FILTERABLE_DIMS) {
    if (dim === "platform") continue; // covered above with pretty labels
    for (const v of deriveDimValues(factsDaily, dim)) items.push({ type: dim, value: v, display: v });
  }

  const splitKeys = collectSplitKeys(liPlan);
  return items.map((item) => ({ ...item, tier: tierOf(item, splitKeys) }));
}

const KIND_ORDER = Object.keys(KIND_LABELS);

export interface BrowseGroups {
  scope: FilterSource[];
  lens: FilterSource[];
}

/**
 * The two-section BROWSE list for the empty-query, on-focus state: `{ scope, lens }`, each a FLAT
 * list ordered by `KIND_LABELS` key order and capped at `perKindCap` items per kind. Ported from
 * the reference's `browseSources` - no ranking math, a deterministic catalogue.
 */
export function browseSources(sources: readonly FilterSource[] | null | undefined, perKindCap = 6): BrowseGroups {
  const groups: Record<FilterTier, Map<string, FilterSource[]>> = { scope: new Map(), lens: new Map() };
  for (const s of sources ?? []) {
    const tier: FilterTier = s.tier === "scope" ? "scope" : "lens";
    const byKind = groups[tier];
    if (!byKind.has(s.type)) byKind.set(s.type, []);
    byKind.get(s.type)!.push(s);
  }
  const flatten = (byKind: Map<string, FilterSource[]>): FilterSource[] => {
    const out: FilterSource[] = [];
    for (const kind of KIND_ORDER) {
      const list = byKind.get(kind);
      if (!list) continue;
      for (let i = 0; i < list.length && i < perKindCap; i += 1) out.push(list[i]);
    }
    return out;
  };
  return { scope: flatten(groups.scope), lens: flatten(groups.lens) };
}

export interface RankedFilterSource extends FilterSource {
  score: number;
  recent: boolean;
}

/**
 * Fuzzy search across ALL kinds at once, reusing `journal/tags-core.ts`'s `rankSources` (generic
 * over `{type,value,display}` - see that file's docblock). Empty query -> empty result (the
 * spotlight opens on typing, unlike the journal palette's own recents view).
 *
 * `rankSources`'s own return type spreads the input source (`{...s, score, recent}`), so `tier`
 * genuinely survives on every result at runtime; the cast below just tells TypeScript what
 * `rankSources`'s generic `TagSource` signature can't express on its own.
 */
export function searchFilterSources(
  sources: readonly FilterSource[] | null | undefined,
  query: string,
  limit = 10
): RankedFilterSource[] {
  const q = String(query ?? "").trim();
  if (!q) return [];
  return rankSources((sources ?? []) as readonly TagSource[], { query: q, limit }) as RankedFilterSource[];
}

/** Picked item -> `setFilters` patch. Additive + idempotent - ported verbatim from the
 *  reference's `patchForSource`. */
export function patchForSource(filters: DashboardFilters, item: Pick<FilterSource, "type" | "value">): DashboardFiltersPatch {
  const add = (arr: readonly string[] | undefined, v: string): string[] =>
    (arr ?? []).includes(v) ? [...(arr ?? [])] : [...(arr ?? []), v];
  switch (item.type) {
    case "li":
      return { selection: add(filters.selection, item.value) };
    case "channel":
      // Mirrors the FilterBar coupling rule: a channel change clears selection.
      return { channels: add(filters.channels, item.value), selection: [] };
    case "label":
      return { labels: add(filters.labels, item.value) };
    case "platform":
      return { platforms: add(filters.platforms, item.value) };
    default:
      return { brk: item.type, brkf: add(filters.brkf, `${item.type}:${item.value}`) };
  }
}
