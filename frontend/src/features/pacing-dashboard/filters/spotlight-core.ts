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
import { collectSplitKeys as collectSplitKeysMoved, splitLinesByKey } from "../spa/dim-scope.js";
import { fD } from "../spa/format.js";
import PacingCore from "../spa/pacing-core.js";
import { customRangeState, formatRangeLabel } from "./custom-range-core";
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
  /** A line item's name alone (custom display name, else description) - the explanation panel
   *  prints the name and the id in their own places, not the search display. */
  name?: string;
}

/** The line-item-plan shape this file reads - deliberately the narrow slice `PacingLineItemPlanV1`
 *  actually carries for this purpose (channel/labels/description/containers), not the whole
 *  generated type, so a test fixture doesn't have to fabricate every other field. */
export interface SpotlightLiPlan {
  channel?: string | null;
  labels?: string[] | null;
  description?: string | null;
  containers?: readonly SplitContainer[] | null;
  /** Value groups (spec 2026-10-02), for the explanation panel's "what this group stands for". */
  dimGroups?: readonly DimGroup[] | null;
}

/** One value group of a line item, as `PacingLineItemPlanV1.dimGroups` carries it. */
export interface DimGroup {
  dim_key?: string | null;
  name?: string | null;
  values?: readonly string[] | null;
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
    items.push({ type: "li", value: id, display: name ? `${id} — ${name}` : id, name });
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

export const KIND_ORDER = Object.keys(KIND_LABELS);

/** One kind's rows in a browse section: the items shown and how many the cap holds back. */
export interface BrowseGroup {
  kind: string;
  items: FilterSource[];
  hidden: number;
}

export interface BrowseGroups {
  scope: BrowseGroup[];
  lens: BrowseGroup[];
}

/**
 * The browse list as GROUPS (reference spec 2026-10-01): per tier, one group per kind in
 * `KIND_ORDER`, each capped at `perKindCap` unless `expandedKinds` holds its `tier:kind` key, with
 * the count the cap left out so the component can offer "Show {n} more". A deterministic catalogue,
 * no ranking - the reference's `browseSources`.
 */
export function browseSources(
  sources: readonly FilterSource[] | null | undefined,
  { expandedKinds = new Set<string>(), perKindCap = 6 }: { expandedKinds?: ReadonlySet<string>; perKindCap?: number } = {}
): BrowseGroups {
  const groups: Record<FilterTier, Map<string, FilterSource[]>> = { scope: new Map(), lens: new Map() };
  for (const s of sources ?? []) {
    const tier: FilterTier = s.tier === "scope" ? "scope" : "lens";
    const byKind = groups[tier];
    if (!byKind.has(s.type)) byKind.set(s.type, []);
    byKind.get(s.type)!.push(s);
  }
  const flatten = (tier: FilterTier, byKind: Map<string, FilterSource[]>): BrowseGroup[] => {
    const out: BrowseGroup[] = [];
    for (const kind of KIND_ORDER) {
      const list = byKind.get(kind);
      if (!list) continue;
      const items = expandedKinds.has(`${tier}:${kind}`) ? list : list.slice(0, perKindCap);
      out.push({ kind, items, hidden: list.length - items.length });
    }
    return out;
  };
  return { scope: flatten("scope", groups.scope), lens: flatten("lens", groups.lens) };
}

export interface RankedFilterSource extends FilterSource {
  score: number;
  recent: boolean;
}

/**
 * Fuzzy search across ALL kinds at once, the WHOLE ranked list (the spotlight shows 20 and offers
 * "Show all {n} matches"), reusing `journal/tags-core.ts`'s `rankSources` (generic over
 * `{type,value,display}`). Empty query -> empty result.
 *
 * `rankSources`'s own return type spreads the input source (`{...s, score, recent}`), so `tier`
 * genuinely survives on every result at runtime; the cast below just tells TypeScript what
 * `rankSources`'s generic `TagSource` signature can't express on its own.
 */
export function searchFilterSources(
  sources: readonly FilterSource[] | null | undefined,
  query: string,
  limit = Infinity
): RankedFilterSource[] {
  const q = String(query ?? "").trim();
  if (!q) return [];
  return rankSources((sources ?? []) as readonly TagSource[], { query: q, limit }) as RankedFilterSource[];
}

/** Search hits grouped by kind in `KIND_ORDER`, rank order kept inside each group. */
export function groupByKind<T extends Pick<FilterSource, "type">>(items: readonly T[] | null | undefined): Array<{ kind: string; items: T[] }> {
  const byKind = new Map<string, T[]>();
  for (const it of items ?? []) {
    if (!byKind.has(it.type)) byKind.set(it.type, []);
    byKind.get(it.type)!.push(it);
  }
  const out: Array<{ kind: string; items: T[] }> = [];
  for (const kind of KIND_ORDER) if (byKind.has(kind)) out.push({ kind, items: byKind.get(kind)! });
  for (const [kind, list] of byKind) if (!KIND_ORDER.includes(kind)) out.push({ kind, items: list });
  return out;
}

/** Is this source (or the range row) on in the URL filters? */
export function isActive(filters: Partial<DashboardFilters> | null | undefined, item: Pick<FilterSource, "type" | "value">): boolean {
  const f = filters ?? {};
  switch (item.type) {
    case "li":
      return (f.selection ?? []).includes(item.value);
    case "channel":
      return (f.channels ?? []).includes(item.value);
    case "label":
      return (f.labels ?? []).includes(item.value);
    case "platform":
      return (f.platforms ?? []).includes(item.value);
    case "range":
      return customRangeState(f as Pick<DashboardFilters, "range" | "customRange">).rangeActive;
    default:
      return (f.brkf ?? []).includes(`${item.type}:${item.value}`);
  }
}

/** The removal a row asks the bar for: ONE removal path, the chip's (`FilterBar`'s `removePill`). */
export function removeDescriptorOf(item: Pick<FilterSource, "type" | "value">): { type: string; value: string } {
  switch (item.type) {
    case "li":
      return { type: "selection", value: item.value };
    case "channel":
    case "label":
    case "platform":
      return { type: item.type, value: item.value };
    case "range":
      return { type: "range", value: item.value };
    default:
      return { type: "breakdown", value: `${item.type}:${item.value}` };
  }
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

// ── The explanation panel (reference spec 2026-10-01) ─────────────────────────────────────
// Ported from the reference's `filter-spotlight-core.js` (`TIER_SENTENCES` .. `panelFor`). Hover a
// spotlight row or an applied chip and one panel says what the filter touches (how many lines),
// whether it paces the dashboard (Scope) or narrows delivery only (Lens), and - for a value
// group - which values it stands for. Same input-shape differences as the rest of this file:
// `liPlan[id].channel` for `.ch`, a flat `factsDaily` for `facts.factsDaily`.

/** The two tier sentences, the one wording the rows and the chips say. */
export const TIER_SENTENCES: Record<FilterTier, string> = Object.freeze({
  scope: "Scope · paces the dashboard: plan, expected and pacing follow this filter",
  lens: "Lens · delivery only: charts, tables and line-item cells narrow to this filter; pacing still uses the full line",
});
export const RANGE_SENTENCE = "Scope · the whole dashboard reads this window";
export const DOWNGRADE_NOTE = "Has a split, but this combination has no plan here, so it works as a Lens";
export const MISSING_NOTE = "Not in the current data";
export const TOUCH_FOOTER = "Scope paces the dashboard · Lens narrows delivery only";

const WHOLE_TYPES = new Set(["li", "channel", "label", "platform"]);
/** A dim-value source (anything that is not a whole unit, a platform or the range). */
export const isDimType = (type: string): boolean => !WHOLE_TYPES.has(type) && type !== "range";
const lines = (n: number): string => (n === 1 ? "1 line" : `${n} lines`);

/** What the explanation panel prints. `members` only on a value group. */
export interface ExplainContent {
  title: string;
  sentence: string;
  note: string | null;
  members?: string;
}

/** One applied filter as the chips row has it (the reference's Active row). */
export interface ActiveItem {
  key: string;
  type: string;
  value: string;
  label: string;
  /** A named line item's id, printed beside its name. */
  sub?: string | null;
  title?: string;
  tier: FilterTier;
  missing: boolean;
  display: string;
  name: string;
  /** Dim values only: whether a split exists for it, whatever tier it shows now - the panel's
   *  downgrade note reads it. */
  hasSplit?: boolean;
  /** The range row only: what puts this range back (a frozen, removed row clicked again). */
  restore?: Pick<DashboardFilters, "range" | "customRange">;
}

/** The period-aware Scope answer for the applied cuts - `spa/selectors.js:selectScopeFilters`. */
export interface ScopeFilters {
  brkf: readonly string[];
}

interface ActiveDescriptor {
  kind: string;
  value: string;
}

/**
 * The applied filters split into Scope and Lens, the reference's `classifyActive`: selection,
 * channels and labels are Scope; platforms are Lens; a `brkf` pair is Scope when the period-aware
 * `actualScope` says so, else (no answer) when it is the only dimension cut and has a declared split.
 */
export function classifyActive(
  filters: Partial<DashboardFilters> | null | undefined,
  splitKeys: Set<string> | null,
  actualScope: ScopeFilters | null = null
): { scope: ActiveDescriptor[]; lens: ActiveDescriptor[] } {
  const scope: ActiveDescriptor[] = [];
  const lens: ActiveDescriptor[] = [];
  const f = filters ?? {};
  for (const id of f.selection ?? []) scope.push({ kind: "li", value: id });
  for (const ch of f.channels ?? []) scope.push({ kind: "channel", value: ch });
  for (const l of f.labels ?? []) scope.push({ kind: "label", value: l });
  for (const p of f.platforms ?? []) lens.push({ kind: "platform", value: p });

  const brkf = Array.isArray(f.brkf) ? f.brkf.filter(Boolean) : [];
  if (brkf.length > 0) {
    const dims = new Set<string>();
    for (const pair of brkf) {
      const idx = pair.indexOf(":");
      if (idx > 0) dims.add(pair.slice(0, idx));
    }
    const hasOutside = brkf.some((pair) => pair.slice(pair.indexOf(":") + 1).startsWith("__outside__"));
    const singleDim = dims.size === 1 && !hasOutside;
    for (const pair of brkf) {
      const isScope = actualScope ? actualScope.brkf.includes(pair) : singleDim && !!splitKeys && splitKeys.has(pair);
      (isScope ? scope : lens).push({ kind: "dim", value: pair });
    }
  }
  return { scope, lens };
}

/** The date-range row, in the chip's own words, or null when no range is on. */
export function rangeRow(filters: Pick<DashboardFilters, "range" | "customRange"> | null | undefined): ActiveItem | null {
  const { from, to, customActive, rangeActive } = customRangeState(filters);
  if (!rangeActive || !filters) return null;
  const range = String(filters.range);
  const label = customActive ? formatRangeLabel(from, to) : `${range}d`;
  const title = customActive ? `${fD(from)} – ${fD(to)}` : Number(range) === 1 ? "Last day" : `Last ${range} days`;
  return {
    key: "range",
    type: "range",
    value: range,
    label,
    sub: null,
    title,
    tier: "scope",
    missing: false,
    display: label,
    name: "",
    restore: { range, customRange: { from, to } },
  };
}

/**
 * The applied filters as rows, the chips' order: Scope (the range last among them), then Lens. A
 * filter with no source behind it is still a row (`missing`), labelled from its type and value.
 */
export function activeItems(
  filters: Partial<DashboardFilters> & Pick<DashboardFilters, "range" | "customRange">,
  sources: readonly FilterSource[] | null | undefined,
  scopeFilters: ScopeFilters | null
): ActiveItem[] {
  const tiers = classifyActive(filters, null, scopeFilters);
  const byKey = new Map((sources ?? []).map((s) => [`${s.type}:${s.value}`, s]));
  const rows: ActiveItem[] = [];
  const push = (desc: ActiveDescriptor, tier: FilterTier) => {
    let type: string;
    let value: string;
    if (desc.kind === "dim") {
      const i = desc.value.indexOf(":");
      type = desc.value.slice(0, i);
      value = desc.value.slice(i + 1);
    } else {
      type = desc.kind;
      value = desc.value;
    }
    const src = byKey.get(`${type}:${value}`) ?? null;
    let label: string;
    let sub: string | null = null;
    if (type === "li") {
      label = src?.name || `LI ${value}`;
      sub = src?.name ? `LI ${value}` : null;
    }
    else if (type === "platform") label = formatPlatform(value);
    else if (type === "channel" || type === "label") label = value;
    else label = `${type}: ${value}`;
    rows.push({
      key: `${type}:${value}`,
      type,
      value,
      label,
      sub,
      tier,
      missing: !src,
      display: src?.display || label,
      name: src?.name || "",
      hasSplit: isDimType(type) ? !!(src && src.tier === "scope") : undefined,
    });
  };
  tiers.scope.forEach((d) => push(d, "scope"));
  const range = rangeRow(filters);
  if (range) rows.push(range);
  tiers.lens.forEach((d) => push(d, "lens"));
  return rows;
}

/**
 * The count every row prints: the line items the filter touches. Channel and label from the plan;
 * a Scope dim value the lines carrying that split; a platform or a Lens dim value the lines with
 * delivery rows on it. `delivery:<type>:<value>` carries the delivery count for a split-backed
 * value too, for the panel's downgraded case. Line-item rows have no count.
 */
export function countsFor(
  sources: readonly FilterSource[] | null | undefined,
  { liPlan, factsDaily }: { liPlan?: Record<string, SpotlightLiPlan | null | undefined> | null; factsDaily?: readonly FactRow[] | null } = {}
): Map<string, number> {
  const counts = new Map<string, number>();
  const plan = liPlan ?? {};
  const chCounts = new Map<string, number>();
  const lbCounts = new Map<string, number>();
  for (const p of Object.values(plan)) {
    if (!p) continue;
    if (p.channel) chCounts.set(p.channel, (chCounts.get(p.channel) || 0) + 1);
    for (const l of Array.isArray(p.labels) ? p.labels : []) lbCounts.set(l, (lbCounts.get(l) || 0) + 1);
  }
  const dims = ["platform", ...FILTERABLE_DIMS.filter((d) => d !== "platform")];
  const seen = new Map<string, Map<string, Set<string>>>(dims.map((d) => [d, new Map()]));
  for (const f of factsDaily ?? []) {
    if (!f) continue;
    const li = f.line_item_id == null ? "" : String(f.line_item_id);
    for (const d of dims) {
      const raw = f[d] != null ? String(f[d]).trim() : "";
      if (!raw || raw === "-") continue;
      const m = seen.get(d)!;
      if (!m.has(raw)) m.set(raw, new Set());
      if (li) m.get(raw)!.add(li);
    }
  }
  const splits = splitLinesByKey(plan) as Map<string, Set<string>>;
  for (const s of sources ?? []) {
    if (s.type === "li") continue;
    const key = `${s.type}:${s.value}`;
    if (s.type === "channel") {
      counts.set(key, chCounts.get(s.value) || 0);
      continue;
    }
    if (s.type === "label") {
      counts.set(key, lbCounts.get(s.value) || 0);
      continue;
    }
    const delivery = seen.get(s.type)?.get(s.value)?.size || 0;
    if (isDimType(s.type) && splits.has(key)) {
      counts.set(key, splits.get(key)!.size);
      counts.set(`delivery:${key}`, delivery);
    } else counts.set(key, delivery);
  }
  return counts;
}

const MEMBERS_SHOWN = 6;
const membersText = (values: readonly string[]): string =>
  values.length > MEMBERS_SHOWN
    ? `${values.slice(0, MEMBERS_SHOWN).join(", ")} +${values.length - MEMBERS_SHOWN} more`
    : values.join(", ");

/**
 * What a dimension value stands for when it is a value group (spec 2026-10-02): the raw values
 * that read as it, and where. null when no line declares a group under this name.
 *   one line:                          "Brand = A, B, C on LI 900101"
 *   several lines, the same members:   "Brand = A, B, C on 3 lines"
 *   several lines, different members:  "Brand is a value group on 3 lines, with different values"
 * A group is per line, so the same name may hold different values on another line. The name is
 * matched exactly (after trim), the way the rows carry it and the filter matches it.
 */
export function groupMembersLine(
  item: Pick<FilterSource, "type" | "value"> | null | undefined,
  liPlan: Record<string, SpotlightLiPlan | null | undefined> | null | undefined
): string | null {
  if (!item || !isDimType(item.type) || !liPlan) return null;
  const want = String(item.value ?? "").trim();
  if (!want) return null;
  const found: Array<{ id: string; group: DimGroup & { values: readonly string[] } }> = [];
  for (const id of Object.keys(liPlan)) {
    const groups = liPlan[id]?.dimGroups;
    if (!Array.isArray(groups)) continue;
    const g = groups.find((x) => x && x.dim_key === item.type && String(x.name ?? "").trim() === want);
    if (g && Array.isArray(g.values) && g.values.length) found.push({ id, group: g as DimGroup & { values: readonly string[] } });
  }
  if (!found.length) return null;
  const { group } = found[0];
  if (found.length === 1) return `${group.name} = ${membersText(group.values)} on LI ${found[0].id}`;
  const signature = (g: { values: readonly string[] }) =>
    g.values.map((v) => PacingCore.dimGroupFold(v)).sort().join("\u0000");
  const same = found.every((f) => signature(f.group) === signature(group));
  return same
    ? `${group.name} = ${membersText(group.values)} on ${found.length} lines`
    : `${group.name} is a value group on ${found.length} lines, with different values`;
}

/**
 * The explanation panel's lines for a row or a chip. `displayedTier` is the tier the row SHOWS (a
 * chip's actual, period-aware tier; a spotlight row's own), so the sentence never disagrees with
 * the tag beside it. A dimension value that is a value group also carries `members`.
 */
export function panelFor(
  item: Pick<ActiveItem, "type" | "value"> & Partial<Pick<ActiveItem, "label" | "display" | "title" | "name" | "hasSplit" | "tier">>,
  {
    displayedTier,
    counts,
    liPlan,
    missing = false,
  }: {
    displayedTier?: FilterTier;
    counts?: Map<string, number> | null;
    liPlan?: Record<string, SpotlightLiPlan | null | undefined> | null;
    missing?: boolean;
  } = {}
): ExplainContent {
  const tier: FilterTier = displayedTier || item.tier || "lens";
  const key = `${item.type}:${item.value}`;
  const n = counts && counts.has(key) ? counts.get(key)! : 0;
  if (item.type === "range") return { title: item.title || item.label || "", sentence: RANGE_SENTENCE, note: null };
  if (missing) return { title: item.label || item.display || key, sentence: TIER_SENTENCES[tier], note: MISSING_NOTE };
  if (item.type === "li") {
    const ch = liPlan?.[item.value]?.channel || "";
    const name = item.name || "";
    return { title: `${name ? `${name} · ` : ""}LI ${item.value}${ch ? ` · ${ch}` : ""}`, sentence: TIER_SENTENCES.scope, note: null };
  }
  if (item.type === "channel" || item.type === "label") return { title: lines(n), sentence: TIER_SENTENCES.scope, note: null };
  if (item.type === "platform") {
    return { title: `${lines(n)} ${n === 1 ? "has" : "have"} delivery here`, sentence: TIER_SENTENCES.lens, note: null };
  }
  const hasSplit = item.hasSplit !== undefined ? !!item.hasSplit : item.tier === "scope";
  const membersLine = groupMembersLine(item, liPlan);
  const members = membersLine ? { members: membersLine } : {};
  if (tier === "scope") {
    return { title: `${lines(n)} ${n === 1 ? "carries" : "carry"} a split for this value`, sentence: TIER_SENTENCES.scope, note: null, ...members };
  }
  const d = hasSplit && counts && counts.has(`delivery:${key}`) ? counts.get(`delivery:${key}`)! : n;
  return {
    title: `${lines(d)} ${d === 1 ? "has" : "have"} delivery here`,
    sentence: TIER_SENTENCES.lens,
    note: hasSplit ? DOWNGRADE_NOTE : null,
    ...members,
  };
}
