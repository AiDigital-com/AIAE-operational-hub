/**
 * Pure, framework-free core for the journal tag palette (§15, US-139 follow-up). No JSX, no DOM.
 * Single source of truth for tag parsing, source building, fuzzy ranking, validation, and popover
 * geometry - a faithful TypeScript port of the retired SPA's
 * `workspace/src/lib/dashboard/journal-tags-core.js`, golden-tested by that file's own
 * `tests/journal-tags-core-test.mjs` (ported to `tags-core.test.ts` in this directory). Kept
 * byte-for-byte equivalent in behaviour: same tag types, same regex construction, same ranking, same
 * `\` → `#` trigger conversion - only the syntax changed.
 */

export const TAG_TYPES = [
  "LI", "ch", "aud", "dsp", "tactic", "label",
  // Breakdown dims (brk/brkf) — typed-only long tail (no chip). Token == dim.
  "geo", "creative", "comment", "message", "keyword", "flight", "language",
] as const;

export type TagType = (typeof TAG_TYPES)[number];

/** Types that get a category chip in the palette. The rest are reachable by typing `#geo:` etc. -
 *  keeps the chip row from crowding on data-rich pacings. */
export const CHIP_TYPES: TagType[] = ["LI", "ch", "aud", "dsp", "tactic"];

/** Structured journal tag: #LI:id / #ch:slug / #aud:slug / #dsp:platform. Built from TAG_TYPES so
 *  adding a type propagates to every consumer. A shared regex carries `lastIndex` between calls, so
 *  every consumer below clones it via `new RegExp(TAG_RE.source, "g")` before scanning. */
export const TAG_RE = new RegExp("#(" + TAG_TYPES.join("|") + "):([a-zA-Z0-9_-]+)", "g");

/** "type:" prefix matcher for the active-token parser (also TAG_TYPES-driven). */
const TYPE_PREFIX_RE = new RegExp("^(" + TAG_TYPES.join("|") + "):(.*)$");

export interface Tag {
  type: string;
  value: string;
  raw: string;
}

/** Slugify a free-text label into a tag-safe value (same rule everywhere). */
function slugify(label: unknown): string {
  return String(label).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Parse structured tags from a message. */
export function parseTags(text: unknown): Tag[] {
  const str = text == null ? "" : String(text);
  const tags: Tag[] = [];
  const re = new RegExp(TAG_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    tags.push({ type: m[1], value: m[2], raw: m[0] });
  }
  return tags;
}

/** An entry carrying journal text - the retired SPA read both `msg` and `message` across call
 *  sites, so this stays dual-read for parity even though the Hub's own `PacingJournalEntryV1` only
 *  ever carries `msg`. */
export interface TaggableEntry {
  msg?: string;
  message?: string;
}

/** Deduped set of tags across all entries (reads `entry.msg || entry.message`). */
export function collectAllTags(entries: readonly TaggableEntry[] | null | undefined): Tag[] {
  const seen = new Set<string>();
  const result: Tag[] = [];
  for (const entry of entries || []) {
    for (const tag of parseTags(entry.msg || entry.message || "")) {
      if (!seen.has(tag.raw)) {
        seen.add(tag.raw);
        result.push(tag);
      }
    }
  }
  return result;
}

export interface ActiveToken {
  start: number;
  type: string | null;
  query: string;
  raw: string;
}

/**
 * Find the # token under the caret in the composer text. Scans left to the nearest '#', stopping at
 * a space/newline (token break). `type` stays `null` until a valid "LI:"/"ch:"/"aud:" prefix is
 * typed; `query` is the text after '#' (or after the resolved "type:") up to the caret.
 */
export function findActiveToken(text: unknown, caret: number): ActiveToken | null {
  const str = text == null ? "" : String(text);
  const pos = Math.max(0, Math.min(caret | 0, str.length));
  let start = pos - 1;
  while (start >= 0 && str[start] !== "#" && str[start] !== " " && str[start] !== "\n") {
    start--;
  }
  if (start < 0 || str[start] !== "#") return null;
  const afterHash = str.slice(start + 1, pos);
  const raw = str.slice(start, pos);
  const m = TYPE_PREFIX_RE.exec(afterHash);
  if (m) return { start, type: m[1], query: m[2], raw };
  return { start, type: null, query: afterHash, raw };
}

export interface TagSource {
  type: string;
  value: string;
  display: string;
}

/** Loose shape of a plan entry as the tag-source builder reads it — deliberately narrow (only `ch`/
 *  `labels`), matching the retired SPA's internal store shape. The Hub's own `PacingLineItemPlanV1`
 *  names the field `channel` and carries no `labels` at all (§9/§10 sub-breakdown labels are opaque
 *  on this side - see `types.ts`), so the caller adapts `{ channel } → { ch }` before calling in;
 *  `labels` source entries are simply empty here, which this signature does not force. */
export interface TagSourceLiPlanEntry {
  ch?: string;
  labels?: string[];
}

export interface TagSourceInputs {
  liPlan?: Record<string, TagSourceLiPlanEntry | undefined>;
  display?: { liNames?: Record<string, string> };
  /** Kept for parity with the ported golden tests; the Hub's own dashboard payload carries no
   *  `availableSplits` field (the "splits" model was replaced by containers - see CLAUDE.md), so real
   *  callers here source the `aud` tag from `breakdowns` (factsDaily's own `audience` column) instead. */
  availableSplits?: { audience?: Record<string, string[]> };
  platforms?: Array<{ value: string; display?: string }>;
  breakdowns?: Array<{ type: string; values: string[] }>;
}

/**
 * Build the palette's tag source list from the dashboard data. LI → "id — name" (or bare id);
 * channels + audiences → slugged value, raw label.
 */
export function buildTagSources({
  liPlan,
  display,
  availableSplits,
  platforms,
  breakdowns,
}: TagSourceInputs = {}): TagSource[] {
  const items: TagSource[] = [];
  const seen = new Set<string>();
  const liNames = (display && display.liNames) || {};

  // LI sources
  for (const id of Object.keys(liPlan || {})) {
    const name = liNames[id] || "";
    const displayStr = name ? `${id} — ${name}` : id;
    items.push({ type: "LI", value: id, display: displayStr });
    seen.add(`LI:${id}`);
  }

  // Channel sources (deduplicated by slug)
  const chs = new Set<string>();
  for (const p of Object.values(liPlan || {})) {
    if (p && p.ch) chs.add(p.ch);
  }
  for (const ch of chs) {
    const slug = slugify(ch);
    const key = `ch:${slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ type: "ch", value: slug, display: ch });
    }
  }

  // Label sources (deduplicated by slug) — plan.labels arrays. Slugged value (tag grammar), raw
  // display kept so buildTagResolver can recover it for the labels filter cross-link.
  const lblSeen = new Set<string>();
  for (const p of Object.values(liPlan || {})) {
    for (const lbl of (p && p.labels) || []) {
      const slug = slugify(lbl);
      const key = `label:${slug}`;
      if (!slug || lblSeen.has(slug) || seen.has(key)) continue;
      lblSeen.add(slug);
      seen.add(key);
      items.push({ type: "label", value: slug, display: String(lbl) });
    }
  }

  // Audience sources from availableSplits.audience
  const audSeen = new Set<string>();
  const audObj = (availableSplits && availableSplits.audience) || {};
  for (const liId of Object.keys(audObj)) {
    for (const audVal of audObj[liId] || []) {
      const slug = slugify(audVal);
      if (slug && !audSeen.has(slug)) {
        audSeen.add(slug);
        items.push({ type: "aud", value: slug, display: audVal });
      }
    }
  }

  // DSP / platform sources. Caller passes [{ value: rawPlatform, display: prettyLabel }]. value stays
  // RAW; raw values that aren't tag-safe (e.g. contain a space) cannot be represented as a tag and are
  // skipped.
  for (const p of platforms || []) {
    if (!p || !p.value) continue;
    const value = String(p.value);
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) continue;
    const key = `dsp:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: "dsp", value, display: p.display || value });
  }

  // Breakdown-dimension sources (tactic, aud, geo, comment, …). Caller passes raw values per dim;
  // value is slugified (tag-safe), display keeps the raw label so buildTagResolver can recover it.
  for (const b of breakdowns || []) {
    if (!b || !b.type) continue;
    for (const raw of b.values || []) {
      const label = String(raw);
      const slug = slugify(label);
      const key = `${b.type}:${slug}`;
      if (!slug || seen.has(key)) continue;
      seen.add(key);
      items.push({ type: b.type, value: slug, display: label });
    }
  }

  return items;
}

/**
 * Map a tag's slug value back to the raw value a cross-linking consumer expects. Built only for
 * `types` whose tag value is a slug but whose display is the raw label (channels, labels, breakdown
 * dims, audience). LI/dsp are excluded — their tag values are already raw.
 */
export function buildTagResolver(sources: readonly TagSource[] | null | undefined, types: readonly string[] | null | undefined): Map<string, string> {
  const set = new Set(types || []);
  const m = new Map<string, string>();
  for (const s of sources || []) {
    if (set.has(s.type)) m.set(`${s.type}:${s.value}`, s.display);
  }
  return m;
}

export interface TriggerConversion {
  value: string;
  converted: boolean;
}

/**
 * Convert a `\` typed at a tag-start position into `#`, so Russian-layout users can trigger the
 * palette without switching layouts. Only converts when the backslash is at the start of the text or
 * right after a space/newline — never mid-token (e.g. a path like C:\x). Pure: returns the (possibly)
 * new value.
 */
export function maybeConvertTrigger(value: unknown, caret: number): TriggerConversion {
  const str = value == null ? "" : String(value);
  const i = (caret | 0) - 1;
  if (i < 0 || str[i] !== "\\") return { value: str, converted: false };
  const before = i === 0 ? "" : str[i - 1];
  if (before === "" || before === " " || before === "\n") {
    return { value: str.slice(0, i) + "#" + str.slice(i + 1), converted: true };
  }
  return { value: str, converted: false };
}

/* ─── Ranking / validation ──────────────────────────────────────────────────── */

/**
 * Fuzzy subsequence score. Case-insensitive, greedy left-to-right. Bonuses: start-of-string,
 * word-boundary, contiguous run. Returns `null` when `query` is not a subsequence of `text`.
 */
export function scoreMatch(query: unknown, text: unknown): number | null {
  const q = String(query == null ? "" : query).toLowerCase();
  const t = String(text == null ? "" : text).toLowerCase();
  if (!q) return 0;
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1;
      if (i === 0) score += 16; // start of string
      else if (!/[a-z0-9]/.test(t[i - 1])) score += 8; // word boundary (space/_/-)
      if (i === prev + 1) score += 8; // contiguous run
      prev = i;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

/** Tag usage counts across journal entries. */
export function tagFrequencies(entries: readonly TaggableEntry[] | null | undefined): Map<string, number> {
  const freq = new Map<string, number>();
  for (const e of entries || []) {
    for (const tag of parseTags(e.msg || e.message || "")) {
      const key = `${tag.type}:${tag.value}`;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  return freq;
}

/** Best fuzzy score across a source's display + value; `null` when neither matches. */
function bestScore(query: unknown, s: TagSource): number | null {
  const ds = scoreMatch(query, s.display);
  const vs = scoreMatch(query, s.value);
  if (ds == null && vs == null) return null;
  return Math.max(ds == null ? -Infinity : ds, vs == null ? -Infinity : vs);
}

export interface RankedTagSource extends TagSource {
  score: number;
  recent: boolean;
}

export interface RecentTag {
  type: string;
  value: string;
}

export interface RankSourcesOptions {
  type?: string | null;
  query?: string;
  recents?: readonly RecentTag[];
  freq?: Map<string, number>;
  limit?: number;
  exclude?: Set<string> | null;
}

/**
 * Filter + sort tag sources for the palette. Empty query → Recent (recents order) → Frequent (freq
 * desc) → display alpha. Non-empty → fuzzy score desc → freq desc → recent → display alpha. Capped at
 * `limit`.
 */
export function rankSources(
  sources: readonly TagSource[] | null | undefined,
  { type = null, query = "", recents = [], freq = new Map(), limit = 8, exclude = null }: RankSourcesOptions = {}
): RankedTagSource[] {
  const recentIndexOf = (s: TagSource) => {
    const i = (recents || []).findIndex((r) => r.type === s.type && r.value === s.value);
    return i < 0 ? Infinity : i;
  };
  const freqOf = (s: TagSource) => (freq && freq.get ? freq.get(`${s.type}:${s.value}`) || 0 : 0);
  const emptyQuery = !String(query == null ? "" : query);

  const scored: RankedTagSource[] = [];
  for (const s of sources || []) {
    if (type && s.type !== type) continue;
    // Tags already present in the entry being composed are excluded — the palette must not re-offer
    // what's already typed (2026-07-11).
    if (exclude && exclude.has(`${s.type}:${s.value}`)) continue;
    const score = bestScore(query, s);
    if (score == null) continue;
    scored.push({ ...s, score, recent: recentIndexOf(s) < Infinity });
  }

  scored.sort((a, b) => {
    if (!emptyQuery && b.score !== a.score) return b.score - a.score;
    const ra = recentIndexOf(a);
    const rb = recentIndexOf(b);
    if (emptyQuery && ra !== rb) return ra - rb;
    const fa = freqOf(a);
    const fb = freqOf(b);
    if (fb !== fa) return fb - fa;
    if (!emptyQuery && ra !== rb) return ra - rb;
    return a.display.localeCompare(b.display);
  });

  return scored.slice(0, limit);
}

/** True when (type, value) exists in the current tag sources. */
export function isKnownTag(type: string, value: string, sources: readonly TagSource[] | null | undefined): boolean {
  return (sources || []).some((s) => s.type === type && s.value === value);
}

export interface CaretPoint {
  left: number;
  top: number;
  lineHeight: number;
}
export interface PopoverSize {
  w: number;
  h: number;
}
export interface Viewport {
  w: number;
  h: number;
}
export interface PopoverPosition {
  left: number;
  top: number;
  placement: "below" | "above";
}

/**
 * Place the palette near the caret, clamped to the viewport. Anchors below the caret line; flips
 * above when there's no room below.
 */
export function clampPopoverPosition({
  caret,
  size,
  viewport,
  gap = 6,
}: {
  caret: CaretPoint;
  size: PopoverSize;
  viewport: Viewport;
  gap?: number;
}): PopoverPosition {
  const belowTop = caret.top + caret.lineHeight + gap;
  const fitsBelow = belowTop + size.h <= viewport.h;
  const placement: "below" | "above" = fitsBelow ? "below" : "above";
  const top = fitsBelow ? belowTop : Math.max(gap, caret.top - size.h - gap);
  const left = Math.max(gap, Math.min(caret.left, viewport.w - size.w - gap));
  return { left, top, placement };
}
