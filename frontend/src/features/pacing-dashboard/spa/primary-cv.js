// workspace/src/lib/dashboard/primary-cv.js
//
// Primary conversions (spec docs/2026-09-13-primary-conversions.md §3). Pure.
//
// A pacing whose switch is operative can count, per line item, only the chosen
// conversion actions. The builders that turn raw factsDaily into day rows call
// the two overlays below on the maps they return; the overlay changes only
// cv / pc / pv and records, per map, what each line item's conversions are:
//
//   platform     today's numbers from platform_mart, never touched
//   primary      the chosen actions' rows from conversions_mart
//   unavailable  no honest number here: readers show "—" with the reason
//
// The state lives in WeakMaps keyed by the very map a reader receives, because
// readers (liM / campM, SplitRow) get a bare day map, not a facts object.
//
// Stage 2: a filtered or scoped build hands the overlays a `scope`: the filter's
// verdict on each line item's delivery, a test for single conversion rows, and the
// judging dates. A conversion row is decided by its own tags where they count, and
// by its line item's delivery where they do not (spec §4). Stage 1's rule (every
// line item with a choice unavailable under any filter) is kept only for a scope
// with no verdicts, which no Stage 2 builder passes.
import { sid } from './format.js';
import { zeroRow } from './row-utils.js';
import { primaryCvFingerprint } from './coef-rebuild.js';

// Lives in coef-rebuild.js beside the other rebuild fingerprints, which must stay
// free of @shared imports (tests/coef-rebuild-test.mjs runs under plain node).
export { primaryCvFingerprint };

export const CV = Object.freeze({ PLATFORM: 'platform', PRIMARY: 'primary', UNAVAILABLE: 'unavailable' });
export const REV = Object.freeze({ OFF: 'off', OK: 'ok', UNAVAILABLE: 'unavailable' });   // 'off' until Stage 3
export const VERDICT = Object.freeze({ ALL: 'all', NONE: 'none', SOME: 'some', NO_DELIVERY: 'noDelivery' });

// The tooltip text an unavailable group carries. Plain sentences, no trailing period.
export const CV_REASON = Object.freeze({
  NO_SOURCE: "This line item's source does not fetch conversions",
  NOT_LOADED: 'Conversion data is not loaded for this refresh',
  // Stage 1 input only (a scope with no verdicts). No Stage 2 builder passes one.
  FILTER: 'Primary conversions cannot follow this filter yet',
  // Stage 2 (spec §4 "Reasons"). Each names the delivery that makes a line item's untagged
  // conversions unplaceable, and is true wherever it shows.
  SPLIT: "This line item's delivery is split by this filter, and some of its conversions have no tag that matches its delivery",
  CONTAINER: "This line item's delivery is split by this container, and some of its conversions have no tag that matches its delivery",
  NO_DELIVERY: "This line item has no delivery here, and some of its conversions have no tag that matches its delivery",
  DIMENSION: "This line item's delivery is split on this dimension, and some of its conversions have no tag that matches its delivery",
});

export const SPLIT_REASON = CV_REASON.SPLIT;

/** What every builder needs to know, frozen. `operative` is the server's published
 *  flag (merge.mjs publicDataConfig), never recomputed here. `conversions` null means
 *  the file is absent or stale; [] means loaded with zero rows. */
export function makeCvCtx(dataConfig, conversions, asOf) {
  return Object.freeze({
    operative: !!dataConfig && dataConfig.primary_cv_operative === true,
    conversions: Array.isArray(conversions) ? conversions : null,
    asOf: typeof asOf === 'string' && asOf ? asOf : null,
  });
}

const INDEX_CACHE = new WeakMap();

/** Conversion rows grouped by line item, once per array reference.
 *  -> Map<liId, row[]>
 *  Each entry is row-shaped: the loaded row itself when its conversion_action is
 *  already trimmed and its date is a string, otherwise a shallow copy carrying the
 *  trimmed name and the string date. So every reader matches conversion_action as-is
 *  and the loaded rows are never mutated. Numbers stay as loaded; readers coerce.
 *  Rows with no line item id or no date are skipped. */
export function conversionIndex(rows) {
  if (!Array.isArray(rows)) return new Map();
  const hit = INDEX_CACHE.get(rows);
  if (hit) return hit;
  const out = new Map();
  for (const row of rows) {
    if (!row || row.line_item_id == null) continue;
    const id = sid(row.line_item_id);
    const date = row.date == null ? '' : String(row.date);
    if (!id || !date) continue;
    const action = row.conversion_action == null ? '' : String(row.conversion_action).trim();
    const entry = (row.conversion_action === action && row.date === date)
      ? row
      : { ...row, conversion_action: action, date };
    let list = out.get(id);
    if (!list) { list = []; out.set(id, list); }
    list.push(entry);
  }
  INDEX_CACHE.set(rows, out);
  return out;
}

/** A raw factsDaily row that delivered anything. Rows with no delivery never decide. */
export function hasDelivery(row) {
  if (!row) return false;
  return (Number(row.impressions) || 0) > 0
    || (Number(row.clicks) || 0) > 0
    || (Number(row.completes) || 0) > 0
    || (Number(row.spend) || 0) > 0
    || (Number(row.dynamic_cost) || 0) > 0;
}

/* ── Stage 2: the tags a conversion row carries, and the delivery they are checked against ── */

/** The ten dimensions a per-dimension day map carries and a conversion row can be tagged on:
 *  normalize.js DIM_FIELDS, same order. A copy because normalize.js imports this module; a test
 *  pins the two together. */
export const SPLIT_DIMS = Object.freeze(['audience', 'tactic', 'platform', 'comment', 'geo', 'creative', 'message', 'keyword', 'flight', 'language']);

const PURITY_CACHE = new WeakMap();
const EMPTY_ROWS = Object.freeze([]);
const EMPTY_VALUES = new Set();   // shared by NO_MEMBER and never written
const NO_MEMBER = Object.freeze({ single: false, value: '', members: 0, values: EMPTY_VALUES });

/**
 * For each line item and dimension, the values on its DELIVERY rows (hasDelivery) in the
 * breakdown's own terms: trimmed, '-' its own value, '' its own member. One member is single,
 * two or more is split (a value plus '' is split). Built on the first `of`, once per rows array.
 * Two readers: the tag rule reads it over every loaded row (spec §4 "Which tags count"), and
 * placement in a breakdown reads it over the rows a build kept (Task 16).
 *   of(liId, dim) -> { single, value, members: 0 | 1 | 2, values: Set<string> }
 */
export function purityIndex(rows) {
  const list = Array.isArray(rows) ? rows : EMPTY_ROWS;
  const hit = PURITY_CACHE.get(list);
  if (hit) return hit;
  let byLi = null;
  const build = () => {
    byLi = new Map();
    for (const f of list) {
      if (!f || !hasDelivery(f)) continue;
      const id = sid(f.line_item_id);
      let rec = byLi.get(id);
      if (!rec) { rec = {}; byLi.set(id, rec); }
      for (const dim of SPLIT_DIMS) {
        const raw = f[dim];
        (rec[dim] || (rec[dim] = new Set())).add(raw == null ? '' : String(raw).trim());
      }
    }
    for (const rec of byLi.values()) {
      for (const dim of SPLIT_DIMS) {
        const values = rec[dim];
        const single = values.size === 1;
        rec[dim] = Object.freeze({ single, value: single ? values.values().next().value : '', members: Math.min(values.size, 2), values });
      }
    }
  };
  const index = Object.freeze({
    of(liId, dim) {
      if (!byLi) build();
      const rec = byLi.get(sid(liId));
      return (rec && rec[dim]) || NO_MEMBER;
    },
  });
  PURITY_CACHE.set(list, index);
  return index;
}

const TAGS_CACHE = new WeakMap();
const NO_TAGS = Object.freeze({});

/**
 * The tags of one conversion row that COUNT (spec §4 "Which tags count"): only a row the builder
 * marked `own` (a context joined from creative rows never counts), only a key the row carries
 * (a NULL in the mart arrives absent), and only a value that is one of its line item's delivery
 * values on that dimension over every loaded row (`members`: the purityIndex of the unfiltered
 * factsDaily). So a spelling difference between the marts, or '' where the line item never
 * delivered with '', is unknown rather than a row the delivery is not in.
 * -> frozen { [dim]: value } of the dimensions that count; every other dimension is unknown.
 */
export function countedTags(row, members) {
  const ctx = row && row.filter_context;
  if (!ctx || ctx.own !== true || !members) return NO_TAGS;
  const hit = TAGS_CACHE.get(row);
  if (hit && hit.members === members) return hit.tags;
  const out = {};
  for (const dim of SPLIT_DIMS) {
    const src = dim === 'platform' ? ctx : ctx.dims;
    if (!src || !Object.prototype.hasOwnProperty.call(src, dim) || src[dim] == null) continue;
    const value = String(src[dim]).trim();
    if (members.of(row.line_item_id, dim).values.has(value)) out[dim] = value;
  }
  const tags = Object.freeze(out);
  TAGS_CACHE.set(row, { members, tags });
  return tags;
}

/**
 * Counts one builder's delivery rows seen and kept, per line item, during that builder's own
 * filter pass (spec §4 Filters). Only rows with delivery count; only rows inside `bound` (a
 * period's dates; null for every date). A line item with Scope-chip dates in `windows`
 * (Map<liId, Array<{ from, to }>>, already inside `bound`) is judged twice: inside those dates
 * (`result`) and inside `bound` but outside them (`outside`).
 *
 * `expect(liId)` registers a line item the filter applies to even when it has no rows, so it
 * comes back as NO_DELIVERY rather than missing. A line item never expected nor seen is absent
 * from both results, which the overlays read as "not judged".
 */
export function makeVerdictCounter(bound, windows = null) {
  const from = bound && bound.from ? String(bound.from) : null;
  const to = bound && bound.to ? String(bound.to) : null;
  const inside = new Map();
  const outside = new Map();
  const tally = (m, id) => {
    let t = m.get(id);
    if (!t) { t = { seen: 0, kept: 0 }; m.set(id, t); }
    return t;
  };
  const register = (liId) => {
    const id = sid(liId);
    const own = windows ? windows.get(id) || null : null;
    return { own, t: tally(inside, id), o: own ? tally(outside, id) : null };
  };
  const verdictOf = (t) => (t.seen === 0 ? VERDICT.NO_DELIVERY
    : t.kept === 0 ? VERDICT.NONE : t.kept === t.seen ? VERDICT.ALL : VERDICT.SOME);
  const collect = (m) => {
    const out = new Map();
    for (const [id, t] of m) out.set(id, verdictOf(t));
    return out;
  };
  return {
    expect(liId) { register(liId); },
    see(liId, row, kept) {
      const r = register(liId);
      if (!hasDelivery(row)) return;
      const d = String((row && row.date) || '');
      if ((from && d < from) || (to && d > to)) return;
      const t = r.own && !inWindows(d, r.own) ? r.o : r.t;
      t.seen += 1;
      if (kept) t.kept += 1;
    },
    result() { return collect(inside); },
    outside() { return collect(outside); },
  };
}

// Does a date fall in any of these windows?
function inWindows(date, windows) {
  for (const w of windows) if (date >= w.from && date <= w.to) return true;
  return false;
}

/** 'fs|fe' → { from, to }; anything else → null. */
export function windowOfPeriodKey(periodKey) {
  if (typeof periodKey !== 'string') return null;
  const at = periodKey.indexOf('|');
  if (at <= 0 || at === periodKey.length - 1) return null;
  return { from: periodKey.slice(0, at), to: periodKey.slice(at + 1) };
}

/**
 * One line item's chosen conversion rows under one build (spec §4 Filters). Both overlays call it
 * with the same inputs, so the per-line-item days and the per-dimension days hold the same rows.
 * `entries` are its chosen-action index entries.
 *   scope null (unfiltered)        → exact: every row dated on or before the cutoff
 *   scope.verdicts null (Stage 1)  → unavailable, CV_REASON.FILTER
 *   the line item is not judged    → exact: every row up to the cutoff
 *   otherwise, row by row: the row test decides a row whose tags that count answer the view's
 *   filters (or already rule it out). An unknown row follows its line item's delivery. Inside
 *   the judging dates: all kept → counted, none kept → dropped, part kept or none delivered →
 *   the line item is unavailable. Under a Scope chip, an unknown row outside the declaring
 *   dates is dropped, whatever the chip keeps of the delivery there (spec §4: "Its unknown
 *   conversion rows count only inside those dates"). Outside the period: dropped.
 * In view: some delivery row or some conversion row was kept. An unavailable one stays in view.
 * The split reason names what splits the line item (scope.why, see whyOf).
 * -> { mode: 'exact' | 'unavailable', inView: boolean, reason: string | null, kept: entry[] }
 */
function resolveLi(id, entries, scope, cutoff, members) {
  const dated = cutoff == null ? EMPTY_ROWS : entries.filter((e) => e.date <= cutoff);
  if (!scope) return { mode: 'exact', inView: true, reason: null, kept: dated };
  if (!scope.verdicts) return { mode: 'unavailable', inView: true, reason: CV_REASON.FILTER, kept: EMPTY_ROWS };
  const inside = scope.verdicts.get(id);
  if (inside === undefined) return { mode: 'exact', inView: true, reason: null, kept: dated };
  const outside = scope.outside ? scope.outside.get(id) : undefined;
  const own = scope.windows ? scope.windows.get(id) || null : null;
  const bound = scope.window || null;
  const kept = [];
  let reason = null;
  for (const e of dated) {
    const test = scope.rowTest ? scope.rowTest(id, { ...countedTags(e, members), line_item_id: id, date: e.date }) : 'unknown';
    if (test === 'keep') { kept.push(e); continue; }
    if (test === 'drop') continue;
    if (bound && (e.date < bound.from || e.date > bound.to)) continue;
    if (own && !inWindows(e.date, own)) continue;
    if (inside === VERDICT.ALL) kept.push(e);
    else if (inside === VERDICT.SOME) reason = reason || (whyOf(scope, id) === 'container' ? CV_REASON.CONTAINER : CV_REASON.SPLIT);
    else if (inside === VERDICT.NO_DELIVERY) reason = reason || CV_REASON.NO_DELIVERY;
  }
  if (reason) return { mode: 'unavailable', inView: true, reason, kept: EMPTY_ROWS };
  const delivered = inside === VERDICT.ALL || inside === VERDICT.SOME || outside === VERDICT.ALL || outside === VERDICT.SOME;
  return { mode: 'exact', inView: delivered || kept.length > 0, reason: null, kept };
}

// Which rule splits a line item's delivery in the judging dates (spec §4 "Reasons", each true
// wherever it shows): 'filter' when the view's own filters keep part of it, 'container' when
// they keep all of it and a container's (or period's) rule is what splits it. `scope.why` is one
// answer for every line item, or a Map per line item (splitCauses).
function whyOf(scope, id) {
  const why = scope.why;
  if (why instanceof Map) return why.get(id) || 'filter';
  return why === 'container' ? 'container' : 'filter';
}

/** The per-line-item `scope.why` of a build where both the view's filters and a container rule
 *  apply: `byFilters` is the verdict of the view's filters alone (a makeVerdictCounter result
 *  over the same dates). Part kept by them → 'filter'; otherwise the container split it. */
export function splitCauses(byFilters) {
  const out = new Map();
  for (const [id, v] of byFilters) out.set(id, v === VERDICT.SOME ? 'filter' : 'container');
  return out;
}

// With no file, or a source that fetches no conversions, a line item's conversion rows are
// unknown, so only its delivery takes it out of view: the filter kept none of it (under a Scope
// chip, none outside its dates either).
function deliveryInView(scope, id) {
  if (!scope || !scope.verdicts) return true;
  const inside = scope.verdicts.get(id);
  if (inside !== VERDICT.NONE) return true;
  const outside = scope.outside ? scope.outside.get(id) : undefined;
  return outside === VERDICT.ALL || outside === VERDICT.SOME;
}

const withView = (entry, inView) => (inView ? entry : { ...entry, inView: false });

// The line item's published choice as a Set of trimmed names, or null for "no choice".
function choiceOf(p) {
  if (!p || !Array.isArray(p.primaryCv)) return null;
  const set = new Set();
  for (const name of p.primaryCv) {
    if (typeof name !== 'string') continue;
    const t = name.trim();
    if (t) set.add(t);
  }
  return set.size ? set : null;
}

function zeroCv(days) {
  for (const d of Object.keys(days)) {
    const r = days[d];
    r.cv = 0; r.pc = 0; r.pv = 0;
  }
}

const CV_STATE = new WeakMap();
const CV_ONLY_DAYS = new WeakMap();
const CV_KEPT = new WeakMap();
const SPLIT_STATE = new WeakMap();
const CV_ONLY_BUCKET_DAYS = new WeakMap();

/** Per line item days. Mutates LD; registers cvStateOf(LD), cvOnlyDaysOf(LD) and cvKeptOf(LD).
 *  Not operative: returns LD untouched and registers nothing.
 *  `scope` (spec §4): null for an unfiltered build; otherwise what the build's filter kept, read
 *  row by row through resolveLi. A state entry is { cv, revenue, reason }, plus inView: false
 *  for a line item the view keeps nothing of. */
export function overlayLiDaily(LD, localAsOf, planMap, cvCtx, scope) {
  if (!LD || !cvCtx || cvCtx.operative !== true) return LD;
  const state = {};
  const created = {};
  const keptById = {};
  const asOf = cvCtx.asOf ?? localAsOf ?? null;
  const loaded = Array.isArray(cvCtx.conversions);
  const index = loaded ? conversionIndex(cvCtx.conversions) : null;
  const members = (scope && scope.members) || null;
  for (const rawId of Object.keys(planMap || {})) {
    const id = sid(rawId);
    const p = planMap[rawId];
    const choice = choiceOf(p);
    if (!choice) { state[id] = { cv: CV.PLATFORM, revenue: REV.OFF, reason: null }; continue; }
    if (LD[id]) zeroCv(LD[id]);
    if (p.conversionData !== true) {
      state[id] = withView({ cv: CV.UNAVAILABLE, revenue: REV.OFF, reason: CV_REASON.NO_SOURCE }, deliveryInView(scope, id));
      continue;
    }
    if (!loaded) {
      state[id] = withView({ cv: CV.UNAVAILABLE, revenue: REV.OFF, reason: CV_REASON.NOT_LOADED }, deliveryInView(scope, id));
      continue;
    }
    const all = index.get(id);
    const res = resolveLi(id, all ? all.filter((e) => choice.has(e.conversion_action)) : EMPTY_ROWS, scope, asOf, members);
    if (res.mode === 'unavailable') { state[id] = { cv: CV.UNAVAILABLE, revenue: REV.OFF, reason: res.reason }; continue; }
    state[id] = withView({ cv: CV.PRIMARY, revenue: REV.OFF, reason: null }, res.inView);
    if (!res.inView) continue;
    keptById[id] = res.kept;
    for (const e of res.kept) {
      let days = LD[id];
      if (!days) { days = {}; LD[id] = days; }
      let r = days[e.date];
      if (!r) {
        r = zeroRow();
        days[e.date] = r;
        if (!created[id]) created[id] = new Set();
        created[id].add(e.date);
      }
      r.cv += Number(e.conversions) || 0;
      r.pc += Number(e.post_click_conversions) || 0;
      r.pv += Number(e.post_view_conversions) || 0;
    }
  }
  CV_STATE.set(LD, state);
  CV_ONLY_DAYS.set(LD, created);
  CV_KEPT.set(LD, keptById);
  return LD;
}

const MARK = Object.freeze({ cv: true, revenue: false });
const EVERY_DIM = Object.freeze(Object.fromEntries(SPLIT_DIMS.map((dim) => [dim, MARK])));

// One kept conversion row into one bucket-day. The bucket or the day is made when this build's
// delivery has none there, and recorded as conversion-only (spec §4, like cvOnlyDaysOf).
function addToBucket(LSD, id, key, e, created) {
  const li = LSD[id] || (LSD[id] = {});
  const bucket = li[key] || (li[key] = {});
  let row = bucket[e.date];
  if (!row) {
    row = zeroRow();
    bucket[e.date] = row;
    const byKey = created[id] || (created[id] = {});
    (byKey[key] || (byKey[key] = new Set())).add(e.date);
  }
  row.cv += Number(e.conversions) || 0;
  row.pc += Number(e.post_click_conversions) || 0;
  row.pv += Number(e.post_view_conversions) || 0;
}

/**
 * Per dimension days (spec §4 "Breakdowns"). Mutates LSD; registers splitStateOf(LSD) and
 * cvOnlyBucketDaysOf(LSD). Not operative: returns LSD untouched and registers nothing.
 *
 * A line item with a choice first has cv / pc / pv zeroed in every bucket, so no platform value
 * survives where nothing is placed. Then, per dimension, each of its kept rows (resolveLi: the
 * rows its per-line-item days hold) goes
 *   - to `dim:v` when its tag there counts: '-' lands in `dim:-` («Unclassified»), and '' gets
 *     no bucket, reaching «Others» through the line total like its delivery;
 *   - where the delivery is when the tag is unknown and the delivery is single on that
 *     dimension (a single '', or no delivery rows in this build: «Others»);
 *   - nowhere when the tag is unknown and the delivery is split. Then none of its rows is placed
 *     on that dimension, which is marked { cv: true }: a partly placed line item would show
 *     short numbers that look exact.
 * An unavailable line item (no source, no file, or a filter result that reads "—") is zeroed
 * and marked on every dimension; one the view keeps nothing of is zeroed and not marked. No
 * choice: untouched and never marked (Stage 3 adds the revenue half; `revenue` stays false).
 * `purity` is purityIndex of this build's own rows (the kept rows of a filtered build); tags
 * count against `scope.members` (every loaded row), which for an unfiltered build is `purity`.
 * A placed row can open a bucket-day, or in a filtered build a bucket, that the build's delivery
 * does not have; cvOnlyBucketDaysOf records them.
 */
export function overlayLiSplitDaily(LSD, planMap, cvCtx, scope, purity, localAsOf = null) {
  if (!LSD || !cvCtx || cvCtx.operative !== true) return LSD;
  const cutoff = cvCtx.asOf ?? localAsOf ?? null;
  const loaded = Array.isArray(cvCtx.conversions);
  const index = loaded ? conversionIndex(cvCtx.conversions) : null;
  const members = (scope && scope.members) || purity || null;
  const state = {};
  const created = {};
  for (const rawId of Object.keys(planMap || {})) {
    const id = sid(rawId);
    const p = planMap[rawId];
    const choice = choiceOf(p);
    if (!choice) continue;
    if (LSD[id]) for (const key of Object.keys(LSD[id])) zeroCv(LSD[id][key]);
    if (p.conversionData !== true || !loaded) { if (deliveryInView(scope, id)) state[id] = EVERY_DIM; continue; }
    const all = index.get(id);
    const res = resolveLi(id, all ? all.filter((e) => choice.has(e.conversion_action)) : EMPTY_ROWS, scope, cutoff, members);
    if (!res.inView) continue;
    if (res.mode === 'unavailable') { state[id] = EVERY_DIM; continue; }
    const marks = {};
    for (const dim of SPLIT_DIMS) {
      const pur = purity ? purity.of(id, dim) : null;
      const places = [];
      let split = false;
      for (const e of res.kept) {
        const tags = countedTags(e, members);
        if (Object.prototype.hasOwnProperty.call(tags, dim)) { places.push(tags[dim]); continue; }
        if (!pur || pur.members > 1) { split = true; break; }
        places.push(pur.members === 1 ? pur.value : '');
      }
      if (split) { marks[dim] = MARK; continue; }
      res.kept.forEach((e, i) => { if (places[i] !== '') addToBucket(LSD, id, dim + ':' + places[i], e, created); });
    }
    if (Object.keys(marks).length) state[id] = marks;
  }
  SPLIT_STATE.set(LSD, state);
  CV_ONLY_BUCKET_DAYS.set(LSD, created);
  return LSD;
}

/** null | { [liId]: { cv: CV, revenue: REV, reason: string | null, inView?: false } }
 *  `inView: false` only for a line item the view keeps nothing of (Stage 2; read it with isInView). */
export function cvStateOf(dayMap) {
  return (dayMap && CV_STATE.get(dayMap)) || null;
}

/** null | { [liId]: { [dim]: { cv: boolean, revenue: boolean } } }   true = cannot be placed */
export function splitStateOf(liSplitDaily) {
  return (liSplitDaily && SPLIT_STATE.get(liSplitDaily)) || null;
}

/** null | { [liId]: Set<date> } — day keys the overlay created with zero delivery. */
export function cvOnlyDaysOf(dayMap) {
  return (dayMap && CV_ONLY_DAYS.get(dayMap)) || null;
}

/** null | { [liId]: { [bucketKey]: Set<date> } } — bucket-days the per-dimension overlay created
 *  with zero delivery (spec §4 "Conversion-only rows and days"). */
export function cvOnlyBucketDaysOf(liSplitDaily) {
  return (liSplitDaily && CV_ONLY_BUCKET_DAYS.get(liSplitDaily)) || null;
}

export function isCvUnavailable(dayMap, liId) {
  const s = cvStateOf(dayMap);
  const id = sid(liId);
  return !!(s && Object.prototype.hasOwnProperty.call(s, id) && s[id].cv === CV.UNAVAILABLE);
}

/** False only for a line item the view keeps nothing of (spec §4 Filters). */
export function isInView(dayMap, liId) {
  const s = cvStateOf(dayMap);
  const id = sid(liId);
  return !(s && Object.prototype.hasOwnProperty.call(s, id) && s[id].inView === false);
}

/** The totals rule (spec §3): only an unavailable line item that is in view nulls a total. */
export function cvBlocksTotals(dayMap, liId) {
  return isCvUnavailable(dayMap, liId) && isInView(dayMap, liId);
}

/** null | { [liId]: entry[] }: the chosen conversion rows each primary line item in view holds on
 *  this day map, after the view's filters (the Creative cut buckets these same rows, Task 17). */
export function cvKeptOf(dayMap) {
  return (dayMap && CV_KEPT.get(dayMap)) || null;
}

/** Register the listed line items' state of fromMap on toMap (a dailyForContainer
 *  wrapper). Nothing registered on fromMap → nothing registered on toMap. */
export function copyCvState(fromMap, toMap, liIds) {
  const s = cvStateOf(fromMap);
  if (!s || !toMap || typeof toMap !== 'object') return toMap;
  const days = cvOnlyDaysOf(fromMap) || {};
  const state = {};
  const created = {};
  for (const raw of liIds || []) {
    const id = sid(raw);
    if (Object.prototype.hasOwnProperty.call(s, id)) state[id] = s[id];
    if (Object.prototype.hasOwnProperty.call(days, id)) created[id] = days[id];
  }
  CV_STATE.set(toMap, state);
  CV_ONLY_DAYS.set(toMap, created);
  return toMap;
}
