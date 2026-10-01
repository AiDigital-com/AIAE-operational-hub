// workspace/src/lib/dashboard/container-scope.js
//
// Per-container fact scoping. When a container's dim splits COVER it (spec
// 2026-08-14-container-dim-scope §2), its own delivery and its date children's
// count only rows carrying a declared value — untagged rows included.
//
// liDaily cannot answer that: it is already collapsed per day, dims gone. So
// this module rebuilds a per-day aggregate from factsDaily, once per distinct
// (line item, container filter) pair, and hands it to the same summers.
//
// The no-scope path is load-bearing: when NO container in the pacing covers
// itself, buildScopedDaily returns null and every caller falls back to the raw
// liDaily it used before — byte-identical, no extra pass over the facts.
//
// Primary conversions (spec 2026-09-13 §4): while operative, a container group and
// a period are also judged, inside their own dates, the way a filter is judged.
// One filter can then have one day map per judging window (a container's dates or
// one date child's), built from the same delivery rows. Under a user filter a date
// row is judged inside its own dates even when its container does not scope (or an
// Outside filter suspends the scoping): a group with no container filter, over the
// rows the view's filters keep. Off: nothing changes.
import PacingCore from './pacing-core.js';
import { buildLiDaily } from './normalize.js';
import { sid } from './format.js';
import {
  parseBreakdownFilters,
  groupBreakdownFilters,
  factMatchesBreakdownFilters,
  outsideFiltersOf,
  outsideIndexes,
  factMatchesOutside,
  conversionRowTest,
} from './breakdown-filter.js';
import { resolveOwningContainer } from './dim-scope.js';
import { copyCvState, makeVerdictCounter, purityIndex, splitCauses, windowOfPeriodKey } from './primary-cv.js';

const SEP = '\u001f';   // unit separator — never appears in an LI id or a dim value

/** Implicit cuts of the selected period. Unnamed facts stay in their container;
 * an explicit Outside lens suspends these cuts, as in buildScopedDaily. */
export function periodContainerFilters(liPlan, periodKey, filters) {
  const out = {};
  if (!periodKey || outsideFiltersOf(parseBreakdownFilters(filters)).length) return out;
  for (const id of Object.keys(liPlan || {})) {
    const owning = resolveOwningContainer(liPlan[id], periodKey);
    const filter = owning && PacingCore.containerDimFilter(owning.container);
    if (filter) out[id] = filter;
  }
  return out;
}

/** Stable key for a container filter — sorted keys, sorted values. */
export function filterKey(filter) {
  if (!filter) return '';
  return Object.keys(filter)
    .sort()
    .map((k) => k + '=' + [...filter[k]].sort().join(','))
    .join('|');
}

/** The dates a container group is judged in (primary conversions, spec 2026-09-13 §4): a date
 *  child's dates cut to its container's, else the container's own. null when an end is
 *  missing, which judges every date. */
function groupWindow(container, dateChild) {
  let from = container && container.fs ? String(container.fs) : '';
  let to = container && container.fe ? String(container.fe) : '';
  if (dateChild && dateChild.fs && dateChild.fe) {
    if (!from || String(dateChild.fs) > from) from = String(dateChild.fs);
    if (!to || String(dateChild.fe) < to) to = String(dateChild.fe);
  }
  return from && to ? { from, to } : null;
}

// facts → liPlan → scalar key → index. WeakMaps so a Settings save or a new
// dashboard load drops the whole tree.
const cache = new WeakMap();

function scalarKey(rate, filters) {
  const brkf = Array.isArray(filters?.brkf) ? filters.brkf.join(SEP) : (filters?.brkf || '');
  const platforms = (filters?.platforms || []).join('|');
  return `${rate ?? ''}|${brkf}|${platforms}`;
}

/**
 * @returns {null | { dailyFor, dayMapFor, groupKeyFor }}
 *   null  — no container in this pacing scopes (and no date row needs judging in
 *           its own dates, below); callers keep the raw liDaily.
 *   index — each method takes (liId, container, dateChild = null). dailyFor gives
 *           `{ [date]: row }` for that container's group, or null when the
 *           container itself does not scope. dayMapFor gives the whole
 *           `{ [liId]: days }` map those days were built in, which carries the
 *           primary-conversions state (dailyForContainer copies it). groupKeyFor
 *           names the group, for the wrapper cache.
 *   A group is one (line item, container filter). While primary conversions are
 *   operative it is also one judging window (groupWindow): the same delivery rows,
 *   judged inside those dates, so a card's period row and the period view of the
 *   same dates say the same thing (spec 2026-09-13 §4). Operative under a user
 *   filter (chips or Outside), a container that does not scope, and any container
 *   under Outside, also has a group per window: no container filter, the rows the
 *   view's filters keep, which are the rows of the view's own liDaily for that line
 *   item. A group is built on its first ask and kept, so its days keep one identity
 *   across renders, including a group no row reaches.
 */
export function buildScopedDaily(facts, liPlan, rate, filters) {
  if (!facts || !Array.isArray(facts.factsDaily) || !liPlan) return null;

  let byPlan = cache.get(facts);
  if (!byPlan) { byPlan = new WeakMap(); cache.set(facts, byPlan); }
  let byKey = byPlan.get(liPlan);
  if (!byKey) { byKey = new Map(); byPlan.set(liPlan, byKey); }
  const ck = scalarKey(rate, filters);
  if (byKey.has(ck)) return byKey.get(ck);

  // Distinct container filters per LI (one LI can hold several containers on one
  // window, and more than one of them can scope).
  const byLi = new Map();
  for (const id of Object.keys(liPlan)) {
    const cs = Array.isArray(liPlan[id]?.containers) ? liPlan[id].containers : [];
    let m = null;
    for (const c of cs) {
      const f = PacingCore.containerDimFilter(c);
      if (!f) continue;
      if (!m) m = new Map();
      const k = filterKey(f);
      if (!m.has(k)) m.set(k, f);
    }
    if (m) byLi.set(id, m);
  }

  // Compose with the active breakdown filter the same way buildBreakdownFacts
  // does — facts.factsDaily is always the FULL row set, even on a filtered
  // facts object, so the brkf pass has to be repeated here.
  const parsed = parseBreakdownFilters(filters);
  const outside = outsideFiltersOf(parsed);
  const brk = groupBreakdownFilters(parsed);
  const platforms = Array.isArray(filters?.platforms) ? filters.platforms.filter((p) => p != null) : [];
  const platformSet = platforms.length ? new Set(platforms.map((p) => String(p))) : null;
  const chips = platformSet !== null || parsed.length > 0;

  // Primary conversions: while operative, each line item's rows are also kept whole, so a group
  // can count what its filters keep inside its own dates. Under a user filter every date row is
  // judged so (`ownDates`), whether or not its container scopes. Off: the old grouping only.
  const cvCtx = facts.cvCtx || null;
  const judging = !!(cvCtx && cvCtx.operative === true);
  const ownDates = judging && chips;
  if (byLi.size === 0 && !ownDates) { byKey.set(ck, null); return null; }

  // An active Outside-splits filter suspends container scoping: the two are
  // complements, so keeping both would zero every period row. The caller's
  // liDaily already carries the outside filter, so falling back to it answers
  // the useful question — WHEN did the undeclared delivery happen. Operative,
  // a date row still gets its own dates judged, over those same rows.
  if (outside.length > 0 && !ownDates) { byKey.set(ck, null); return null; }
  const outIdx = outside.length ? outsideIndexes(outside, liPlan) : null;
  // The rows the view's filters keep (buildBreakdownFacts' predicate, less the period's container
  // filters: a card in period scope shows only the owning container, whose own filter is the
  // group's).
  const keeps = (row) => !(platformSet && !platformSet.has(String(row.platform || '')))
    && !(brk.size > 0 && !factMatchesBreakdownFilters(row, brk))
    && !(outIdx && !factMatchesOutside(row, outside, outIdx));

  const liRows = judging ? new Map() : null;
  const groups = judging ? null : new Map();   // `${liId}${SEP}${filterKey}` → rows[]
  for (const row of facts.factsDaily) {
    const id = sid(row.line_item_id);
    if (judging) {
      if (!ownDates && !byLi.has(id)) continue;
      let all = liRows.get(id);
      if (!all) { all = []; liRows.set(id, all); }
      all.push(row);
      continue;
    }
    const m = byLi.get(id);
    if (!m) continue;
    if (!keeps(row)) continue;
    for (const [k, flt] of m) {
      if (!PacingCore.factMatchesDimFilter(row, flt)) continue;
      const gk = id + SEP + k;
      let arr = groups.get(gk);
      if (!arr) { arr = []; groups.set(gk, arr); }
      arr.push(row);
    }
  }

  const members = judging ? purityIndex(facts.factsDaily) : null;

  // Which group a (line item, container, date child) reads. Off, the date child plays no part.
  // Operative under a user filter, a container with no filter of its own (none declared, or
  // Outside suspends it) is a group too, with `flt` null.
  function groupOf(liId, container, dateChild) {
    const flt = outside.length ? null : PacingCore.containerDimFilter(container);
    if (!flt && !ownDates) return null;
    const id = sid(liId);
    const fk = flt ? filterKey(flt) : '';
    const window = judging ? groupWindow(container, dateChild) : null;
    const gk = id + SEP + fk + (judging ? SEP + (window ? window.from + '|' + window.to : '') : '');
    return { id, fk, flt, window, gk };
  }

  // One group's day map. Off: today's build over the group's rows. Judging: the group's verdict
  // inside its window, counted over every row of the line item (the view's filters and the
  // group's filter decide kept), and a row test with the same filters for its conversion rows.
  // The reason names what splits it there (spec §4 "Reasons"): the view's filters when they alone
  // keep part of its delivery in the window, else the container's rule (`byFilters`).
  // One line item per plan: its own entry is all the overlay and the coef / net lookups need.
  function build(g) {
    if (!judging) return buildLiDaily(groups.get(g.id + SEP + g.fk) || [], rate, liPlan).LD;
    const counter = makeVerdictCounter(g.window);
    const byFilters = makeVerdictCounter(g.window);
    counter.expect(g.id);
    byFilters.expect(g.id);
    const rows = [];
    for (const row of liRows.get(g.id) || []) {
      const viewKeeps = keeps(row);
      const kept = viewKeeps && (!g.flt || PacingCore.factMatchesDimFilter(row, g.flt));
      counter.see(g.id, row, kept);
      byFilters.see(g.id, row, viewKeeps);
      if (kept) rows.push(row);
    }
    const scope = {
      verdicts: counter.result(), outside: null, window: g.window, windows: null,
      rowTest: conversionRowTest({ platformSet, byDim: brk, outside, outIdx, containerFilters: g.flt ? { [g.id]: g.flt } : null }),
      members, why: splitCauses(byFilters.result()),
    };
    return buildLiDaily(rows, rate, { [g.id]: liPlan[g.id] }, cvCtx, scope).LD;
  }

  const dayMaps = new Map();
  function groupMap(liId, container, dateChild) {
    const g = groupOf(liId, container, dateChild);
    if (!g) return null;
    let LD = dayMaps.get(g.gk);
    if (!LD) {
      LD = build(g);
      if (!LD[g.id]) LD[g.id] = {};
      dayMaps.set(g.gk, LD);
    }
    return LD;
  }

  const index = {
    dailyFor(liId, container, dateChild = null) {
      const LD = groupMap(liId, container, dateChild);
      return LD ? LD[sid(liId)] : null;
    },
    dayMapFor(liId, container, dateChild = null) {
      return groupMap(liId, container, dateChild);
    },
    groupKeyFor(liId, container, dateChild = null) {
      const g = groupOf(liId, container, dateChild);
      return g ? g.gk : null;
    },
  };
  byKey.set(ck, index);
  return index;
}

// facts → liPlan → periodKey → liDaily. Same WeakMap discipline as above.
const periodCache = new WeakMap();

/**
 * Period-scope delivery: each LI's facts filtered by the container that OWNS
 * the selected period (the same container `buildScopedPlanForPeriodKey` scopes
 * the plan to), so headline, chart and cards pace the container's own slice.
 *
 * Returns `facts.liDaily` BY REFERENCE when no owning container scopes — the
 * memoized selectors then see an unchanged input and stay value-identical to
 * the pre-2026-08-14 behaviour.
 */
export function buildPeriodScopedDaily(facts, liPlan, rate, periodKey) {
  const raw = facts?.liDaily;
  if (!raw || !periodKey || !liPlan || !Array.isArray(facts.factsDaily)) return raw;

  let byPlan = periodCache.get(facts);
  if (!byPlan) { byPlan = new WeakMap(); periodCache.set(facts, byPlan); }
  let byKey = byPlan.get(liPlan);
  if (!byKey) { byKey = new Map(); byPlan.set(liPlan, byKey); }
  if (byKey.has(periodKey)) return byKey.get(periodKey);

  const filterByLi = new Map();
  for (const id of Object.keys(liPlan)) {
    const owning = resolveOwningContainer(liPlan[id], periodKey);
    if (!owning) continue;
    const flt = PacingCore.containerDimFilter(owning.container);
    if (flt) filterByLi.set(sid(id), flt);
  }
  if (filterByLi.size === 0) { byKey.set(periodKey, raw); return raw; }

  // Primary conversions (spec 2026-09-13 §4): while operative, each line item an owning container
  // scopes is judged inside the period's dates. resolveOwningContainer answers only for a period
  // whose dates are the key's own, so one window serves them all. The others are not judged:
  // their conversions stay as on the unscoped dashboard.
  const cvCtx = facts.cvCtx || null;
  const judging = !!(cvCtx && cvCtx.operative === true);
  const window = judging ? windowOfPeriodKey(periodKey) : null;
  const counter = judging ? makeVerdictCounter(window) : null;
  if (judging) for (const id of filterByLi.keys()) counter.expect(id);

  const rows = [];
  for (const row of facts.factsDaily) {
    const id = sid(row.line_item_id);
    const flt = filterByLi.get(id);
    const kept = !flt || PacingCore.factMatchesDimFilter(row, flt);
    if (flt && judging) counter.see(id, row, kept);
    if (!kept) continue;
    rows.push(row);
  }
  const { LD } = judging
    ? buildLiDaily(rows, rate, liPlan, cvCtx, {
      verdicts: counter.result(), outside: null, window, windows: null,
      rowTest: conversionRowTest({ containerFilters: Object.fromEntries(filterByLi) }),
      members: purityIndex(facts.factsDaily), why: 'container',
    })
    : buildLiDaily(rows, rate, liPlan);
  // Every LI must keep an entry: an LI whose whole delivery was cut still has to
  // read as zero rather than fall through to a missing key upstream.
  for (const id of Object.keys(raw)) { if (!LD[id]) LD[id] = {}; }
  byKey.set(periodKey, LD);
  return LD;
}

// index → groupKeyFor(liId, container, dateChild) → wrapper. One wrapper per group, so the
// identity-keyed metric caches downstream (liM / campM) see the same map on every
// render, and the primary-conversions state registered on it is found by SplitRow.
const wrapperCache = new WeakMap();

/**
 * The liDaily a container's rows must be summed against: the scoped one when
 * the container covers itself, else the raw one. Shaped as `{ [liId]: days }`
 * so it drops straight into sumDateChild. `dateChild`: the date row being summed,
 * whose dates the primary-conversions state is judged in (null: the container's).
 */
export function dailyForContainer(index, liId, container, liDaily, dateChild = null) {
  if (!index) return liDaily;
  const days = index.dailyFor(liId, container, dateChild);
  if (!days) return liDaily;
  const id = sid(liId);
  const key = index.groupKeyFor(liId, container, dateChild);
  let byKey = wrapperCache.get(index);
  if (!byKey) { byKey = new Map(); wrapperCache.set(index, byKey); }
  let wrapper = byKey.get(key);
  if (!wrapper || wrapper[id] !== days) {
    wrapper = { [id]: days };
    copyCvState(index.dayMapFor(liId, container, dateChild), wrapper, [id]);
    byKey.set(key, wrapper);
  }
  return wrapper;
}
