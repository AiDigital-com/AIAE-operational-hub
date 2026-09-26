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
 *   - No separate `display.liNames` map - `PacingLineItemPlanV1.description` already IS the line
 *     item's display name (`types.ts`'s own docblock: "the closest thing to a display name").
 *   - `liPlan[id].ch` -> `liPlan[id].channel` (the Hub's own field name).
 *   - `facts.factsDaily` -> a flat `factsDaily` array (the Hub passes it as its own prop, not
 *     nested under a `facts` object).
 *   - Values are RAW here too, same as the reference (filters match raw strings; no tag grammar,
 *     no slugify - see the reference file's own note on this).
 *
 * FIXED DISAGREEMENT WITH THIS CODEBASE (2026-09-25 follow-up, item 4 - see `tierOf`'s own comment
 * below): an earlier pass ported the reference's dim-value rule verbatim (Scope iff the value has a
 * declared split target, via `collectSplitKeys`), labelled it "not papered over," and left it. That
 * was wrong to ship as-is: this Hub never vendored the reference's `dim-scope.js`
 * (`matchDimSplits`/`buildVirtualPlanFromDimChild`) - the engine that actually re-paces a headline
 * against a declared split's own target. Without it, a `brkf` dim-value filter in THIS codebase
 * (`breakdown-filter.ts`'s `buildBreakdownFacts`, called from `build-metrics.ts`) only ever narrows
 * `series`/`daily` (Lens), never `cm`/`campaign` (Scope) - see `build-metrics.ts:301-327`. A panel
 * that labelled such a value "SCOPE · paces the dashboard" was lying about the maths, which is worse
 * than under-promising - the whole reason this tiering exists. `tierOf` now tags every dim value
 * LENS, unconditionally, until `dim-scope.js` lands. `collectSplitKeys` stays (it is the one piece
 * of that future engine already re-derived here from `PacingLineItemPlanV1.containers`), but
 * `tierOf` no longer consults it - see its own comment for exactly what flips this back.
 */
import { rankSources } from "../journal/tags-core";
import type { TagSource } from "../journal/tags-core";
import { derivePlatforms, deriveDimValues, formatPlatform } from "../journal/fact-dims";
import type { FactRow } from "../journal/fact-dims";
import { FILTERABLE_DIMS } from "./breakdown-filter";
import { resolveDimAbs } from "../../pacing-plan/containers";
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

/** Only the fields `collectSplitKeys` needs off a container/dim-child - `PacingLineItemPlanV1`'s
 *  own `containers` field is opaque on the wire (`{[key:string]:unknown}[]`, see `types.ts`), so
 *  this file reads it structurally rather than importing the settings-side `PacingContainer`/
 *  `PacingDimChild` types wholesale. `resolveDimAbs` (`pacing-plan/containers.ts`, the Hub-side
 *  mirror of `pacing-core.js:resolveDimAbs`) only needs `target_mode`/`target_value`/
 *  `target_impressions`, so this stays structurally compatible with it without a cast beyond the
 *  wire's own opaque typing. */
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
 * items - ported from the reference's `dim-scope.js:collectSplitKeys` (never vendored into this
 * Hub as its own module - this is the one piece of it `tierOf` needs, re-derived here from data
 * already on `PacingLineItemPlanV1.containers`. See this file's docblock for what is NOT ported).
 */
export function collectSplitKeys(
  liPlan: Record<string, SpotlightLiPlan | null | undefined> | null | undefined
): Set<string> {
  const keys = new Set<string>();
  if (!liPlan) return keys;
  for (const plan of Object.values(liPlan)) {
    if (!plan) continue;
    for (const container of plan.containers ?? []) {
      if (!container) continue;
      for (const child of container.dim_children ?? []) {
        if (!child || child.dim_key == null || child.dim_value == null) continue;
        // `resolveDimAbs` requires `target_mode`; a missing one reads as "absolute" at runtime
        // in `pacing-core.js` too (only an explicit `'percent'` takes the percent branch).
        const normalized = { target_mode: child.target_mode ?? ("absolute" as const), target_value: child.target_value ?? null };
        const normalizedContainer = { target_impressions: container.target_impressions ?? null };
        if (!(resolveDimAbs(normalized, normalizedContainer) > 0)) continue;
        keys.add(`${child.dim_key}:${child.dim_value}`);
      }
    }
  }
  return keys;
}

/**
 * Tier of a single browse/spotlight source: `li`/`channel`/`label` are Scope (plan-backed, pace the
 * whole dashboard); `platform` is Lens (delivery-only, narrows the breakdown, never the headline);
 * any other type is a breakdown dim value - `lens`, always, in THIS build (see this file's docblock
 * for why: it does not actually pace anything here, so it must not claim to).
 *
 * The reference's own rule (`filter-spotlight-core.js`'s `tierOf`) instead reads `splitKeys` here
 * and returns `scope` when the dim value has a declared split target - correct THERE, because the
 * reference also has `dim-scope.js` to back the claim up. `splitKeys` is accepted but deliberately
 * unused (`_splitKeys`) rather than dropped from the signature, so the day `dim-scope.js` is ported
 * (and `build-metrics.ts` gains a path from a declared split to `cm`/`campaign` - see that file's
 * own `range/customRange` comment block), flipping this back is a one-line diff: replace the
 * `default` arm below with `return _splitKeys.has(\`${source.type}:${source.value}\`) ? "scope" :
 * "lens";` (the reference's own line, still sitting in this file's git history) and rename the
 * parameter back.
 */
export function tierOf(source: Pick<FilterSource, "type" | "value">, _splitKeys: Set<string>): FilterTier {
  if (!source) return "lens";
  switch (source.type) {
    case "li":
    case "channel":
    case "label":
      return "scope";
    case "platform":
    default:
      return "lens";
  }
}

export interface BuildFilterSourcesInput {
  liPlan?: Record<string, SpotlightLiPlan | null | undefined> | null;
  factsDaily?: readonly FactRow[] | null;
}

/** Builds the full, tier-tagged source list the spotlight searches/browses: every line item,
 *  channel, label, platform and breakdown-dim value this pacing carries. Ported from the
 *  reference's `buildFilterSources` - see this file's docblock for the input-shape differences. */
export function buildFilterSources({ liPlan, factsDaily }: BuildFilterSourcesInput = {}): FilterSource[] {
  const items: Array<Omit<FilterSource, "tier">> = [];

  for (const [id, plan] of Object.entries(liPlan ?? {})) {
    const name = plan?.description ?? "";
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
