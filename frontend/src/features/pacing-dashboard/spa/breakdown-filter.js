import { buildFactsAggregates } from './normalize.js';
import PacingCore from './pacing-core.js';
import { makeVerdictCounter, purityIndex, countedTags, splitCauses } from './primary-cv.js';
import { declaringWindows } from './dim-scope.js';

// Synthetic value for "everything this line item's covering containers do NOT
// declare" (spec 2026-08-14-container-dim-scope §4). It is the one NEGATIVE
// filter in the system, and it is bound to ONE line item — delivery is per line
// item, so the complement only means something inside one — hence the
// `<dim>:__outside__@<liId>` shape rather than a bare value.
export const OUTSIDE_KEY = '__outside__';
export const outsidePair = (dim, liId) => `${dim}:${OUTSIDE_KEY}@${liId}`;

/**
 * The `brkf` list after one click on a row or a slice (section-widget parity 2026-09-04) —
 * the write a v2 Breakdown tile makes, in the same words the legacy panel's `handleRowFilter`
 * makes it. It lives HERE, beside the parser that reads these pairs back, rather than inline
 * in the tile: it is the one piece of that click a host test can drive, and a toggle nobody
 * can run is a toggle nobody can check.
 *
 * A pair that is on comes OFF and nothing else moves: clicking an active row removes that one
 * pair, which is what lets a reader unpick one dimension of a multi-dimension filter.
 *
 * The caller writes `brk` alongside, so both surfaces stand on the cut that was clicked.
 *
 * The legacy panel still spells its own copy inline (Breakdown.jsx:209), guarded by the two
 * refusals it makes before it gets here — a leftover row and an unfilterable dimension. The
 * tile makes both of those refusals earlier, where it decides whether a view gets a picker at
 * all, which is why this half is the same four lines on both sides and nothing more.
 */
export function nextBrkfPairs(pairs, dim, value) {
  const cur = Array.isArray(pairs) ? pairs : [];
  const pair = `${dim}:${value}`;
  return cur.indexOf(pair) === -1 ? [...cur, pair] : cur.filter((p) => p !== pair);
}

// Namebuilder positions tracked as independent dim axes (per-position model).
export const OTHER_DIMS = ['comment', 'geo', 'creative', 'message', 'keyword', 'flight', 'language'];

// Dims that may appear in brk/brkf URL state. Audience is the primary first-class
// dim; tactic + platform are first-class BQ fields; OTHER_DIMS are namebuilder
// per-position carve-outs. Keep this in sync with Breakdown.jsx:DIM_ORDER.
export const FILTERABLE_DIMS = ['audience', 'tactic', 'platform', ...OTHER_DIMS];

/** Filter an auxiliary export only when its own metadata can answer every cut.
 * Missing context means unknown; an explicitly empty value means measured without
 * a name. A row ruled out by a known field cannot make the remaining slice unknown. */
export function filterAuxRows(rows, filters, { liIds, liPlan = {}, range = null, outsidePlanMap = liPlan, containerFilters = {}, lensContext = false,
  tagMembers = null, tagsOn = false, fileTags = null } = {}) {
  const ids = liIds == null ? null : new Set(Array.from(liIds, String));
  const pairs = parseBreakdownFilters(filters);
  const byDim = groupBreakdownFilters(pairs);
  const outside = outsideFiltersOf(pairs);
  const indexes = outsideIndexes(outside, outsidePlanMap);
  const platforms = filters?.platforms?.length ? new Set(filters.platforms.map(String)) : null;
  const kept = [];
  const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const id = String(row.line_item_id);
    if (ids && !ids.has(id)) continue;
    const p = liPlan[id];
    if (p?.fs && p?.fe && (row.date < p.fs || row.date > p.fe)) continue;
    if (range && (row.date < range.from || row.date > range.to)) continue;
    const context = row.filter_context;
    // A row carrying its OWN tags (conversion tags, spec 2026-09-13 §4) is read through the tags
    // that count: a value its line item never delivered on is unknown, like a missing key. A
    // context joined from creatives (the lens box, no own marker) is read as before.
    const own = !!context && context.own === true;
    const fact = own
      ? { ...countedTags(row, tagMembers), line_item_id: id, date: row.date }
      : { ...(context?.dims || {}), line_item_id: id, date: row.date };
    if (!own && has(context, 'platform')) fact.platform = context.platform;
    let unknown = false;
    let matches = true;
    if (platforms) {
      if (!has(fact, 'platform')) unknown = true;
      else if (!platforms.has(String(fact.platform))) matches = false;
    }
    for (const [dim, values] of byDim) {
      if (!has(fact, dim)) unknown = true;
      else if (!values.has(readDimValue(fact, dim))) matches = false;
    }
    for (const [dim, values] of Object.entries(containerFilters[id] || {})) {
      if (!has(fact, dim)) unknown = true;
      else {
        const value = readDimValue(fact, dim);
        if (value && !values.includes(value)) matches = false;
      }
    }
    for (const o of outside) {
      if (id !== o.liId) { matches = false; continue; }
      if (!has(fact, o.dim) || !indexes[o.liId]) unknown = true;
      else if (!factMatchesOutside(fact, [o], indexes)) matches = false;
    }
    if (!matches) continue;
    if (unknown) {
      // Spec 2026-09-09-lens-context-flag §3.3. Off: this pacing never fetches the
      // context, so say where the switch is. On: the rows on disk predate the flag
      // (or the file is stale); a refresh fixes both. Both start with "This data" —
      // filterSourceRows swaps that prefix for the cut's name.
      // Conversion tags (spec 2026-09-13 §4): on a file that already carries a tag state, a refresh
      // would not add the missing tags. On a file without one, only a refresh brings them, and a
      // Paused or Complete pacing gets none until it is Live again, so that sentence asks for no
      // refresh. Each sentence says only what is true.
      const reason = tagsOn === true && fileTags
        ? 'Some of this data has no tag for these filters. Clear these filters to see the breakdown.'
        : tagsOn === true
          ? "This data has no tags until this pacing's next refresh, so it cannot follow these filters. Clear these filters to see the breakdown."
          : lensContext === true
            ? 'This data does not follow the dashboard filters yet. Refresh this pacing to apply them, or clear these filters to see the breakdown.'
            : 'This data does not follow the dashboard filters on this pacing. Turn on "Apply dashboard filters to creatives and conversions" in Settings, Data tab, then refresh this pacing, or clear these filters to see the breakdown.';
      return { rows: [], reason };
    }
    kept.push(row);
  }
  return { rows: kept, reason: null };
}

/** Read a fact's value for a given dim key. Empty / '-' / missing → ''. */
function readDimValue(fact, dim) {
  const raw = fact && fact[dim] != null ? String(fact[dim]).trim() : '';
  return (raw && raw !== '-') ? raw : '';
}

/** Parse the multi-value breakdown filter. Accepts string[] (canonical) or a
 *  legacy single 'dim:value' string (bookmark compat). Order-preserving dedup;
 *  unknown dims and the muted buckets are rejected. → [{ dim, key }]. */
export function parseBreakdownFilters(filters) {
  const raw = Array.isArray(filters?.brkf)
    ? filters.brkf
    : (typeof filters?.brkf === 'string' && filters.brkf ? [filters.brkf] : []);
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const s = String(entry).trim();
    const idx = s.indexOf(':');
    if (idx <= 0) continue;
    const dim = s.slice(0, idx);
    const key = s.slice(idx + 1).trim();
    if (!FILTERABLE_DIMS.includes(dim)) continue;
    if (key.startsWith(OUTSIDE_KEY)) {
      // `__outside__@<liId>` — unbound form is dropped: without a line item the
      // complement has no definition, and a pair that matches nothing would
      // silently empty the dashboard.
      const at = key.indexOf('@');
      const liId = at > 0 ? key.slice(at + 1).trim() : '';
      if (!liId) continue;
      const osig = `${dim}:${OUTSIDE_KEY}@${liId}`;
      if (seen.has(osig)) continue;
      seen.add(osig);
      out.push({ dim, key: OUTSIDE_KEY, liId });
      continue;
    }
    if (!key || key === '__others__' || key === '__unclassified__') continue;
    const sig = `${dim}:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ dim, key });
  }
  return out;
}

/** Group parsed VALUE pairs: Map<dim, Set<value>>. AND across dims, OR within one.
 *  Outside pairs are not values and are excluded — see outsideFiltersOf. */
export function groupBreakdownFilters(list) {
  const byDim = new Map();
  for (const f of list || []) {
    if (f.key === OUTSIDE_KEY) continue;
    if (!byDim.has(f.dim)) byDim.set(f.dim, new Set());
    byDim.get(f.dim).add(f.key);
  }
  return byDim;
}

/** The outside pairs of a parsed list: [{ dim, liId }]. */
export function outsideFiltersOf(list) {
  const out = [];
  for (const f of list || []) {
    if (f.key === OUTSIDE_KEY && f.liId) out.push({ dim: f.dim, liId: String(f.liId) });
  }
  return out;
}

/** Per-LI dim-scope indexes for the line items an outside filter names. */
export function outsideIndexes(outside, planMap) {
  const idx = {};
  for (const o of outside || []) {
    if (idx[o.liId]) continue;
    const plan = planMap && planMap[o.liId];
    idx[o.liId] = plan ? PacingCore.buildDimScopeIndex(plan) : null;
  }
  return idx;
}

/**
 * Does a fact row satisfy every active outside filter? A row of ANOTHER line
 * item never does: the filter reads "what LI X delivered outside its splits",
 * and no other line item's delivery is part of that answer.
 */
export function factMatchesOutside(fact, outside, indexes) {
  for (const o of outside) {
    if (String((fact && fact.line_item_id) || '') !== o.liId) return false;
    if (!PacingCore.factOutsideSplits(indexes[o.liId], o.dim, fact)) return false;
  }
  return true;
}

export function factMatchesBreakdownFilters(fact, byDim) {
  for (const [dim, values] of byDim) {
    if (!values.has(readDimValue(fact, dim))) return false;
  }
  return true;
}

/**
 * The delivery predicate of buildBreakdownFacts, asked about ONE conversion row through the tags
 * it has (primary conversions, spec 2026-09-13 §4 Filters). `fact` carries only the row's tags
 * that count (primary-cv.js countedTags) plus line_item_id and date. A filter on a dimension the
 * row has no counting tag for makes it 'unknown', unless a tag it does have already rules it out:
 * then it is 'drop' (the filterAuxRows rule, a row ruled out by a known field cannot make the rest
 * unknown). PacingCore.factMatchesDimFilter reads a missing key as untagged and would keep the
 * row, so it is only ever asked about a key the fact carries.
 * -> (liId, fact) => 'keep' | 'drop' | 'unknown'
 */
export function conversionRowTest({ platformSet = null, byDim = new Map(), outside = [], outIdx = null, containerFilters = null } = {}) {
  const has = (fact, dim) => Object.prototype.hasOwnProperty.call(fact, dim);
  return (liId, fact) => {
    const id = String(liId);
    let unknown = false;
    const cf = containerFilters ? containerFilters[id] : null;
    if (cf) {
      for (const dim of Object.keys(cf)) {
        if (!has(fact, dim)) { unknown = true; continue; }
        if (!PacingCore.factMatchesDimFilter(fact, { [dim]: cf[dim] })) return 'drop';
      }
    }
    if (platformSet) {
      if (!has(fact, 'platform')) unknown = true;
      else if (!platformSet.has(String(fact.platform || ''))) return 'drop';
    }
    for (const [dim, values] of byDim) {
      if (!has(fact, dim)) { unknown = true; continue; }
      if (!values.has(readDimValue(fact, dim))) return 'drop';
    }
    for (const o of outside) {
      if (id !== o.liId) return 'drop';
      if (!has(fact, o.dim) || !outIdx || !outIdx[o.liId]) { unknown = true; continue; }
      if (!PacingCore.factOutsideSplits(outIdx[o.liId], o.dim, fact)) return 'drop';
    }
    return unknown ? 'unknown' : 'keep';
  };
}

// The dates a dimension Scope chip judges each declaring line item in (owner decision 2026-09-16,
// spec §4): dim-scope.js declaringWindows, each cut to the period when one is selected. null when
// the chip declares nothing.
function scopeChipWindows(planMap, filters, bound) {
  const pairs = Array.isArray(filters?.brkf) ? filters.brkf
    : (typeof filters?.brkf === 'string' && filters.brkf ? [filters.brkf] : []);
  const declared = declaringWindows(planMap, pairs);
  if (declared.size === 0) return null;
  if (!bound) return declared;
  const out = new Map();
  for (const [id, list] of declared) {
    out.set(id, list.map((w) => ({ from: w.from > bound.from ? w.from : bound.from, to: w.to < bound.to ? w.to : bound.to }))
      .filter((w) => w.from <= w.to));
  }
  return out;
}

export function buildBreakdownFacts(facts, filters, rate, planMap, containerFilters = null, judgeWindow = null) {
  if (!facts) return facts;
  const brkFilters = parseBreakdownFilters(filters);
  const platforms = Array.isArray(filters?.platforms)
    ? filters.platforms.filter((p) => p != null)
    : [];
  if (brkFilters.length === 0 && platforms.length === 0 && !Object.keys(containerFilters || {}).length) return facts;
  if (!Array.isArray(facts.factsDaily)) return facts;

  const platformSet = platforms.length ? new Set(platforms.map((p) => String(p))) : null;
  const byDim = groupBreakdownFilters(brkFilters);
  const outside = outsideFiltersOf(brkFilters);
  const outIdx = outside.length ? outsideIndexes(outside, planMap) : null;

  // Primary conversions (spec 2026-09-13 §4 Filters): while the one predicate runs, count each
  // judged line item's delivery rows seen and kept. Chips judge every line item; container
  // filters alone judge only the ones they name. `judgeWindow` is a period's dates; a dimension
  // Scope chip adds each declaring line item's own dates. Not operative: no counter, no scope,
  // no extra work per row.
  const cvCtx = facts.cvCtx || null;
  const chips = platformSet !== null || brkFilters.length > 0;
  let counter = null;
  let windows = null;
  // With chips and container filters both on, which one splits a line item decides its reason
  // (spec §4 "Reasons"): a second count of what the chips alone keep, over the same dates.
  let byChips = null;
  if (cvCtx && cvCtx.operative === true) {
    windows = scopeChipWindows(planMap, filters, judgeWindow);
    counter = makeVerdictCounter(judgeWindow, windows);
    if (chips && containerFilters && Object.keys(containerFilters).length) byChips = makeVerdictCounter(judgeWindow, windows);
    for (const id of Object.keys(planMap || {})) {
      if (chips || (containerFilters && containerFilters[id])) {
        counter.expect(id);
        if (byChips) byChips.expect(id);
      }
    }
  }
  const chipsKeep = (fact) => !(platformSet && !platformSet.has(String(fact.platform || '')))
    && !(byDim.size > 0 && !factMatchesBreakdownFilters(fact, byDim))
    && !(outIdx && !factMatchesOutside(fact, outside, outIdx));

  const filteredFactsDaily = facts.factsDaily.filter((fact) => {
    const id = String(fact.line_item_id);
    let kept = true;
    if (containerFilters && !PacingCore.factMatchesDimFilter(fact, containerFilters[id])) kept = false;
    else if (platformSet && !platformSet.has(String(fact.platform || ''))) kept = false;
    else if (byDim.size > 0 && !factMatchesBreakdownFilters(fact, byDim)) kept = false;
    else if (outIdx && !factMatchesOutside(fact, outside, outIdx)) kept = false;
    if (counter && (chips || (containerFilters && containerFilters[id]))) {
      counter.see(id, fact, kept);
      if (byChips) byChips.see(id, fact, kept || chipsKeep(fact));
    }
    return kept;
  });
  // :76 — THE choke point. planMap carries the per-LI coef override so filtered
  // views resolve `dc` identically to the unfiltered aggregate (spec §3.1).
  // The scope carries the filter result to both overlays: the delivery verdicts, the same
  // predicate for single conversion rows, and the unfiltered rows their tags are checked against.
  const scope = counter ? {
    verdicts: counter.result(), outside: counter.outside(), window: judgeWindow, windows,
    rowTest: conversionRowTest({ platformSet, byDim, outside, outIdx, containerFilters }),
    members: purityIndex(facts.factsDaily), why: byChips ? splitCauses(byChips.result()) : (chips ? 'filter' : 'container'),
  } : null;
  const { LD, LSD } = buildFactsAggregates(filteredFactsDaily, rate, planMap, cvCtx, scope);

  // Construct explicitly rather than spreading `facts`: spreading would read the
  // store's lazy liSplitDaily getter and build the FULL LSD only to discard it.
  // cvCtx rides along only when the input had one, so a facts object without it
  // keeps today's exact keys.
  return {
    factsDaily: facts.factsDaily,
    liDaily: LD,
    liSplitDaily: LSD,
    asOf: facts.asOf,
    rate: facts.rate,
    ...(cvCtx ? { cvCtx } : null),
  };
}

/** Distinct non-empty `platform` values from facts.factsDaily, sorted ascending. */
export function derivePlatforms(facts) {
  if (!facts || !Array.isArray(facts.factsDaily)) return [];
  const set = new Set();
  for (const f of facts.factsDaily) {
    const v = f && f.platform != null ? String(f.platform).trim() : '';
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

/** Distinct non-empty values of a breakdown dim from facts.factsDaily, sorted.
 *  Generalizes derivePlatforms to any dim (tactic, geo, …). '' / '-' skipped. */
export function deriveDimValues(facts, dim) {
  if (!facts || !Array.isArray(facts.factsDaily) || !dim) return [];
  const set = new Set();
  for (const f of facts.factsDaily) {
    const raw = f && f[dim] != null ? String(f[dim]).trim() : '';
    if (raw && raw !== '-') set.add(raw);
  }
  return Array.from(set).sort();
}

// Raw `platform` values from BQ are tech slugs (dv_360_dlv, TTD, …). Display
// layer renders the prettified label; raw value stays for URL state + fact
// matching. Unknown raw values pass through unchanged.
export const PLATFORM_LABELS = {
  dv_360_dlv: 'DV360',
  TTD: 'The Trade Desk',
  beeswax: 'Beeswax',
  Beeswax: 'Beeswax',
  facebook: 'Facebook',
  Facebook: 'Facebook',
  amazon: 'Amazon DSP',
  Amazon: 'Amazon DSP',
  google_ads: 'Google Ads',
  'Google Ads': 'Google Ads',
  linkedin: 'LinkedIn',
  LinkedIn: 'LinkedIn',
  vistar: 'Vistar',
  Vistar: 'Vistar',
  spotify: 'Spotify',
  Spotify: 'Spotify',
  tiktok: 'TikTok',
  TikTok: 'TikTok',
};

export function formatPlatform(raw) {
  if (raw == null) return '';
  return PLATFORM_LABELS[raw] ?? String(raw);
}
