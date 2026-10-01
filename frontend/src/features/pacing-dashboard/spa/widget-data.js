// workspace/src/lib/dashboard/widget-data.js
//
// Pure data pipeline for custom widgets (spec 2026-07-12 §3/§4): resolves the widget's
// effective window (§0.7 period chips) and per-axis scope (§0.8), aggregates the four
// row sources, and evaluates formulas through widget-formula.js with the exact
// field × context semantics of the §3 matrix.
//
// Context model (round 6.1, owner-approved): a FIELD always shows the number the
// dashboard itself shows in that spot; raw arithmetic (cl/im) is always literal math
// over the plain sums. Three rate bases:
//   'ts'     scope-aggregated date rows ≡ buildChartData: ctr/cpm over ALL lines,
//            vcr over the VCR-eligible basis, acr over the audio-only imA/coA basis
//            (VCR-convention parity — KpiPlanFact's ACR card, gated on imA > 0
//            ONLY, never coA > 0), cpv over the CPV∪VCR non-audio basis;
//   'entity' one LI (li / date_li rows) ≡ sumLI: every rate is the line's own plain
//            ratio (a CPC line's ctr is ITS clicks/impressions — campaign gates never
//            apply to a single row), with ONE exception: vcr runs over the gated
//            imV/coV pair, because VCR eligibility is a fact about the LINE and not a
//            campaign gate (an audio line's completes are listen-throughs), and it
//            answers NULL — an em dash, the legacy Daily Performance cell — when that
//            pair is empty. acr keeps the plain ratio, so an audio line's number is
//            under the name that means it. Date × LI rows use the date-series
//            ACR/CPV populations to agree with their date-series Totals;
//   dim buckets ≡ the Breakdown table: plain ctr/cpm over the bucket, vcr over the
//            gated imV/coV pair, acr over the gated imA/coA pair — the 'ts' basis shape;
//   'agg'    campaign totals / KPI ≡ campM/Targets: ctr over EVERY line (owner decision
//            2026-09-23: all clicks / all impressions), cpm over non-CPC/CPV lines,
//            vcr = coV/imV, acr = coA/imA (audio-only, imA-gated), cpv = cpvSp/cpvCo
//            (view basis), cpc = sp/cl.
//   expected — cumulative-to-date per day (TS) / window delta over expectedBounds
//              (AGG/entity: the calendar window, never past asOf); UNAVAILABLE in dim
//              rows (no per-dim expected exists — validation error, never a silent 0);
//              raw floats accumulate unrounded.
//   plan scalars — available in EVERY context (bare fields and formulas alike; per-LI
//              values in li/date_li rows). The plan SUMS (budget, planImpr, planClicks,
//              planViews) are the whole flight's, unless the viewer narrowed the window
//              (sources.planFollowsRange, 2026-09-23): then they are the part of the plan
//              curve inside it. Their *Total twins, costBudTotal, the rates and targets
//              (mTgt, vcrT, acrT, tgtCpm) and the day counts stay flight constants.
//              costBud and budgetToDate are the cost and client plan from the window's
//              first day to its last day or asOf, summed line by line. ctrT
//              is the one target that reads delivery (owner decision 2026-09-23): each
//              line's target weighted by its impressions in the window read, or by its
//              planned impressions before any targeted line delivered there.
// Division by zero → 0 everywhere (engine canon). No React, no DOM — host-tested by
// tests/widget-table-rows-test.mjs (run via the tests/dashboard/register.mjs loader).

import {
  parse, validate, evaluateSeries, evaluateOne,
  FIELDS_DAILY, FIELDS_EXPECTED, FIELDS_RATES, FIELDS_PLAN, FUNCTIONS,
} from './widget-formula.js';
import { evaluateHighlightOne, evaluateHighlightSeries } from './highlight-expression.js';
import { unavailableMetric } from './metric-availability.js';
import { liExpImpr, liExpCost, liExpClicks, prorate, cachedProrateRange, unitsInWindow, budgetInWindow, budgetToDate } from './pacing-calc.js';
import { isVcrEligible, viewGoalUnits, domRateType, hasCtrTarget, ctrTargetAccumulator } from './metrics.js';
import { dI, datePrev } from './date-utils.js';
import { groupValue } from './dim-groups.js';
import { aggregateDimSource, coverageSublabel, dimSourceUnitKey, discrepancyLabel, stalenessLabel,
  breakdownServable } from './dim-coverage.js';
import { parseBreakdownFilters, groupBreakdownFilters, filterAuxRows, OUTSIDE_KEY, OTHER_DIMS as CNB_POSITIONS } from './breakdown-filter.js';
import { catalogExtraMetrics, mappedExtraMetrics } from './dim-sources-norm.js';
import { collectDeclaredDimKeys, collectDimPlans, normDimValue } from './dim-scope.js';
import Currency from '@shared/currency';
import MetricRegistry from '@shared/metric-registry';
import ValueLabels from '@shared/value-labels';
// One question only: is this line paused right now (manual intervals ∪ auto out-of-schedule)?
// The legacy Daily Performance section asks the same function for the same chip.
import PacingCore from './pacing-core.js';
// Primary conversions (spec 2026-09-13 §3): per-map state the overlay registers, read here so an
// unanswerable conversion number is null in every reading and never the engine's 0.
import { CV, cvOnlyDaysOf, cvOnlyBucketDaysOf, cvStateOf, cvKeptOf, isInView, splitStateOf, cvBlocksTotals, purityIndex } from './primary-cv.js';

/** Own-key, for the reason every bucket map in this file uses `defineProperty`: a dimension
 *  value is user text, and `constructor` is one a bare lookup would answer for. */
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A refused formula as ONE sentence: what is wrong, and — when the validator worked one out
 * — what to try instead («Unknown field "spx"; did you mean sp?»).
 *
 * Written once because it was written five times, each with its own copy of the separator,
 * and the separator is the point: a SEMICOLON since 2026-08-24, never ` — `, because the
 * owner's rule is that no sentence a user meets as an error carries a long dash.
 */
const formulaSay = (v) => v.error + (v.hint ? `; ${v.hint}` : '');

/* ── date helpers ─────────────────────────────────────────────────────────── */

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function* calendarDays(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

/* ── §0.7 window resolution ───────────────────────────────────────────────── */

const RANGE_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 };

/**
 * Chip semantics (round 7): "the last N days WITHIN the current scope" — anchored at
 * min(asOf, scope end) and clamped to the scope start. The global 7d/14d presets
 * deliberately DON'T clamp (config.js: per-LI plan clipping guards the numbers), but
 * a chip axis that starts before the period adds zero-days that skew rolling()/
 * cumsum() — the clamp keeps window functions honest. bounds = the active period
 * window when period scope is on, else the flight.
 */
export function widgetWindow(activeRange, globalRange, asOf, fs, fe, bounds = null) {
  if (!activeRange) return globalRange || null;
  // Scope bounds ∩ flight (round 9): getEffRange's raw branch ends at asOf, and the
  // last delivered fact can land AFTER the planned flight end (late log deliveries) —
  // a 'Flight'/'3d' chip must never window past endDate.
  let clampTo = bounds || (fs && fe ? { from: fs, to: fe } : null);
  if (clampTo && fs && fe) {
    clampTo = {
      from: clampTo.from && clampTo.from > fs ? clampTo.from : fs,
      to: clampTo.to && clampTo.to < fe ? clampTo.to : fe,
    };
  }
  if (activeRange === 'flight') return clampTo && bounds ? { ...clampTo } : null;
  const n = RANGE_DAYS[activeRange];
  if (!n || !asOf) return globalRange || null;
  const anchor = clampTo && clampTo.to && asOf > clampTo.to ? clampTo.to : asOf;
  let from = addDays(anchor, -(n - 1));
  if (clampTo && clampTo.from && from < clampTo.from) from = clampTo.from;
  return { from, to: anchor };
}

/** The effective calendar window: explicit range, else flight-start .. min(asOf, fe). */
export function calendarBounds(sources, range) {
  if (range) return range;
  return {
    from: sources.flightStart,
    to: sources.asOf && sources.asOf < sources.flightEnd ? sources.asOf : sources.flightEnd,
  };
}

/**
 * What an EXPECTED window delta may count (2026-09-23): the calendar window, never past the
 * last data day — pacing-core prorateRange's rule, «expected never runs ahead of asOf». A
 * Custom window past today (reachable from a Timeline segment, a Journal jump or a URL) read
 * a «Needed» for days that have not happened. A window that starts after asOf answers
 * from > to, and a pacing with no data yet an empty `to`; expectedDeltas reads both as zero,
 * which is what campM's own prorate answers there.
 *
 * Only the window DELTAS read this. The chart axis and its per-day plan curve
 * (aggregateDateRows) keep calendarBounds and still draw to the window's end.
 */
export function expectedBounds(sources, range) {
  const b = calendarBounds(sources, range);
  if (!sources.asOf) return { from: b.from, to: null };
  return b.to && b.to > sources.asOf ? { from: b.from, to: sources.asOf } : b;
}

/**
 * The window the PLAN scalars follow, or null when they are the whole (scoped) flight's.
 *
 * Only a window the viewer NARROWED moves the plan — `sources.planFollowsRange`, which
 * useWidgetData sets for the FilterBar presets, a full Custom range and a widget's own
 * period switch other than Flight. It is never inferred from `range` itself: Flight is a
 * range too, and so is the active period.
 */
export function planWindowOf(sources, range) {
  return sources && sources.planFollowsRange && range && range.from && range.to ? range : null;
}

/* ── §0.8 per-axis scope override (composes with global brkf) ─────────────── */

/**
 * widgetEffFilters(widget, globalFilters) → {channels, labels, selection, brkf, platforms}
 * A pinned axis REPLACES the global filter on that axis; every unpinned axis follows
 * the global — INCLUDING the global breakdown filter (brkf), which a widget cannot
 * pin by itself but must still respect. Platform follows the global Lens; it filters
 * actual readings without inventing a platform-specific plan.
 */
export function widgetEffFilters(widget, globalFilters) {
  const g = globalFilters || {};
  const scope = widget?.scope || {};
  const pinned = (v) => Array.isArray(v) && v.length > 0;
  // A pinned dim replaces the global filter ON ITS OWN KEY ONLY (round 7: replacing
  // the whole list silently dropped the global filters of OTHER dimensions — pinning
  // geo:CA over global geo:NY + audience:Prospecting must keep the audience filter).
  let brkf = g.brkf || [];
  if (pinned(scope.dims)) {
    const pinnedKeys = new Set(scope.dims.map((d) => d.key));
    brkf = [
      ...brkf.filter((pair) => !pinnedKeys.has(String(pair).split(':')[0])),
      ...scope.dims.map((d) => `${d.key}:${d.value}`),
    ];
  }
  return {
    channels: pinned(scope.channels) ? [...scope.channels] : (g.channels || []),
    labels: g.labels || [],
    selection: pinned(scope.lis) ? scope.lis.map(String) : (g.selection || []),
    brkf,
    platforms: g.platforms || [],
  };
}

/* ── plan scalars ─────────────────────────────────────────────────────────── */

function costBudOf(p) {
  return (p.budget || 0) * (1 - (p.mTgt || 0) / 100);
}

/** Per-LI plan scalars — the `li` row context (§3). costBud follows campM's canon:
 *  full-flight cost budget with NO range, the range-prorated cost target WITH one
 *  (round 7 — metrics.js:284 `range ? m.costPr : budget*(1-mTgt)`). costBudTotal is
 *  that same budget with the range arm removed — see the field's own note below.
 *
 *  `planWindow` (planWindowOf, 2026-09-23) is the window the viewer narrowed, or null. With
 *  one, the four plan SUMS — budget, planImpr, planClicks, planViews — are the part of the
 *  line's plan curve inside it (pacing-calc unitsInWindow / budgetInWindow). Their *Total
 *  twins are the whole flight's whatever the window, by the rule costBudTotal already keeps;
 *  the rates and targets (tgtCpm, mTgt, ctrT, vcrT, acrT) and the day counts never move.
 *  One line's `ctrT` is its own stored target, and null where it has none: a stored 0, null
 *  or NaN is «no target» (owner decision 2026-09-23), never a goal of 0.00%. */
export function liPlanScalars(p, asOf, range = null, planWindow = null) {
  const rt = p.rateType || 'CPM';
  const fDays = Math.max(1, dI(p.fs, p.fe));
  let daysPassed = 0;
  if (asOf && asOf >= p.fs) {
    daysPassed = Math.min(fDays, dI(p.fs, asOf < p.fe ? asOf : p.fe));
  }
  const units = p.planImpr || 0;
  const unitsWin = planWindow ? unitsInWindow(p, planWindow) : units;
  return {
    budget: planWindow ? budgetInWindow(p, planWindow) : (p.budget || 0),
    // The whole flight's client budget and plan units, whatever the window. The Targets CPC
    // target is `costBudTotal / planClicksTotal`: over a windowed `planClicks` the flight's
    // cost budget would be divided by a week's clicks.
    budgetTotal: p.budget || 0,
    // The client's plan over the days `costBud` covers (2026-09-23): the line's client money
    // from the window's first day to its last day or asOf, 0 before any data. Not a plan SUM,
    // so a narrowed window does not move it any further than it moves `costBud`.
    budgetToDate: budgetToDate(p, range, asOf),
    planImprTotal: rt === 'CPC' || rt === 'CPV' ? 0 : units,
    planClicksTotal: rt === 'CPC' ? units : 0,
    planViewsTotal: rt === 'CPV' ? units : 0,
    costBud: range ? cachedProrateRange(p, range, asOf).costPr : costBudOf(p),
    // The WHOLE flight's cost budget, whatever window the widget is read over
    // (sections-to-widgets M3). It is the number the legacy Targets bar divides by
    // plan clicks for its CPC target (KpiPlanFact.jsx:149, off full-flight campM),
    // and `costBud` cannot stand in for it: inside a range that one is prorated to
    // date, so on a 7-day window the same expression read roughly a seventh of the
    // target. Range-independent by construction, like the *Total twins above it.
    costBudTotal: costBudOf(p),
    planImpr: rt === 'CPC' || rt === 'CPV' ? 0 : unitsWin,
    planClicks: rt === 'CPC' ? unitsWin : 0,
    planViews: rt === 'CPV' ? unitsWin : 0,
    // The line's own target CPM: what its cost budget buys per thousand planned impressions
    // (campM's `tgtCpm` over one line, metrics.js:538). NULL where the line plans no
    // impressions at all — a click-paced line has no CPM to aim at, and a 0 here would read
    // as a goal of «$0.00», which is exactly what campM's own null-not-zero rule refuses one
    // level up. A bare field reads that null as «no number»; inside arithmetic it is 0, the
    // absence-is-zero canon every operand keeps.
    tgtCpm: rt === 'CPM' && (p.planImpr || 0) > 0 ? (costBudOf(p) / p.planImpr) * 1000 : null,
    daysPassed,
    daysLeft: Math.max(0, fDays - daysPassed),
    mTgt: p.mTgt || 0,
    ctrT: hasCtrTarget(p) ? p.ctrTgt : null,
    vcrT: p.vcrTgt ?? 0,
    // acrT mirrors vcrT exactly — same raw vcrTgt passthrough, no channel gate at
    // this per-LI scalar level (an audio LI's ACR target IS its vcrTgt by
    // convention; see metrics.js isVcrEligible).
    acrT: p.vcrTgt ?? 0,
  };
}

/* ── the campaign CTR target's weights (owner decision 2026-09-23) ────────── */

/** The campaign CTR target over `ids`: each line's own target weighted by `imprOf(id)`, its
 *  delivered impressions in the window read. metrics.js `ctrTargetAccumulator` is the rule
 *  (and its plan fallback), shared with campM so the two cannot weigh it two ways. */
function weightedCtrT(liPlan, ids, imprOf) {
  const acc = ctrTargetAccumulator();
  for (const id of ids) {
    const p = liPlan[id];
    if (!hasCtrTarget(p)) continue;
    acc.add(p, imprOf ? Number(imprOf(id)) || 0 : 0);
  }
  return acc.value();
}

/**
 * `ctrT` as a memoised, enumerable getter on `target`. It is the one plan field that reads
 * facts, so it reads them only when somebody reads IT: a plan-only reading (budget, planImpr,
 * a margin target…) must never open the facts (tests/widget-data-performance-test.mjs).
 * Enumerable, so a spread, `Object.keys` and JSON see it like any other field (they read it).
 * A plain write — `scalars.ctrT = x` — replaces the getter with the written value, as it would
 * on a plain field, rather than throwing in strict mode.
 */
function defineLazyCtrT(target, compute) {
  let done = false;
  let memo = null;
  Object.defineProperty(target, 'ctrT', {
    enumerable: true, configurable: true,
    get() {
      if (!done) { memo = compute(); done = true; }
      return memo;
    },
    set(value) {
      Object.defineProperty(target, 'ctrT', { value, enumerable: true, writable: true, configurable: true });
    },
  });
  return target;
}

/** A copy of `base` whose ctrT is `compute()`, lazy like campaignScalars' own. Every other field
 *  keeps its value and its place, and `base`'s own ctrT is never read. */
function withCtrT(base, compute) {
  const out = {};
  for (const k of Object.keys(base)) {
    if (k === 'ctrT') defineLazyCtrT(out, compute);
    else out[k] = base[k];
  }
  return out;
}

const IS_DEV = !!import.meta.env?.DEV;
let warnedNoImpr = false;

/**
 * Each line's delivered impressions in one window, the CTR target's weight (owner decision
 * 2026-09-23): the line's own flight [fs, fe] cut to the window, over `sources.liDaily`. The
 * same facts and the same clip `sumLiWindow` gives the CTR itself, so period scope, dim Scope
 * and the Lens reach the weight exactly as they reach the value.
 *
 * Returned as `imprOf(id)`, and lazy: nothing is read until a ctrT is. A caller that has
 * ALREADY summed a line over this window (the li rows, the li categories, the reading
 * context) hands the figure over with `imprOf.seed(id, im)`, so the facts are walked once.
 * One map per (frozen snapshot, window): useWidgetData's snapshots are frozen, so every model
 * built on one snapshot shares it; a mutable caller gets a map of its own per call.
 *
 * The window is COPIED here: the target is read later than it is built, and a caller may
 * reuse and edit its range object in between (campaignReadingContext's own rule).
 */
const lineImprCache = new WeakMap();
const LINE_IMPR_WINDOWS = 8;
function lineImpr(sources, range) {
  const window = range ? { from: range.from, to: range.to } : null;
  let map = null;
  const mapOf = () => {
    if (map) return map;
    if (sources && Object.isFrozen(sources)) {
      const key = window ? JSON.stringify([window.from, window.to]) : '__all__';
      let byWindow = lineImprCache.get(sources);
      if (!byWindow) { byWindow = new Map(); lineImprCache.set(sources, byWindow); }
      map = byWindow.get(key) || null;
      if (!map) {
        map = new Map();
        byWindow.set(key, map);
        if (byWindow.size > LINE_IMPR_WINDOWS) byWindow.delete(byWindow.keys().next().value);
      }
    } else {
      map = new Map();
    }
    return map;
  };
  const imprOf = (id) => {
    const m = mapOf();
    const key = String(id);
    if (m.has(key)) return m.get(key);
    const p = sources?.liPlan?.[id];
    let im = 0;
    if (p) {
      for (const [d, v] of Object.entries(sources.liDaily?.[id] || {})) {
        if (p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
        if (window && (d < window.from || d > window.to)) continue;
        im += (v && v.im) || 0;
      }
    }
    m.set(key, im);
    return im;
  };
  imprOf.seed = (id, im) => {
    const m = mapOf();
    const key = String(id);
    if (!m.has(key)) m.set(key, im);
  };
  return imprOf;
}

/** Campaign-level plan scalars over an LI set (weighted like campM — NOT plain sums
 *  for mTgt/ctrT/vcrT; also the "Others" bucket basis, round-6).
 *
 *  `foldBasis` is the Others row's basis (P0.1, owner decision 2026-08-19) and
 *  ONLY that: it lifts the CPC gate on vcrT so the target weighs over the same lines the
 *  fold's values already count. Every campaign-level caller leaves it false and keeps
 *  campM's gates. (It used to lift a gate on ctrT too; ctrT has none left to lift.)
 *
 *  `planWindow` is liPlanScalars' own (planWindowOf): the plan sums follow a narrowed window,
 *  their *Total twins do not, and vcrT / acrT / mTgt keep weighting by each line's
 *  whole-flight plan — a window does not change which line's target counts for more there.
 *
 *  `imprOf(id)` is that line's (or that plan key's) delivered impressions in `range`, the
 *  weight of its CTR target (owner decision 2026-09-23; `lineImpr` above for a line, the
 *  (value, line) bucket for a dimension row). Every engine caller passes one. Without it the
 *  target is the plan-weighted fallback even on a set that has delivered, which disagrees
 *  with campM; a dev build says so on the console the first time. */
export function campaignScalars(liPlan, effLIs, asOf, flightStart, flightEnd, range = null, foldBasis = false,
  planWindow = null, imprOf = null) {
  const out = {
    budget: 0, costBud: 0, costBudTotal: 0, planImpr: 0, planClicks: 0, planViews: 0,
    budgetTotal: 0, budgetToDate: 0, planImprTotal: 0, planClicksTotal: 0, planViewsTotal: 0,
    daysPassed: 0, daysLeft: 0, mTgt: 0, ctrT: null, vcrT: null, acrT: null, tgtCpm: null,
  };
  // Weighting rules copied from campM (round 6.1 — a home-grown weighting averaged audio
  // ACRs into vcrT): vcrT over non-CPC, non-audio lines with a REAL (>0) target, weighted by
  // planUnit||budget||1; mTgt by budget. acrT mirrors vcrT's scheme exactly but AUDIO-ONLY
  // (the disjoint counterpart — an audio LI's vcrTgt is its ACR target by convention).
  // On the fold basis the CPC gate on vcrT lifts (P0.1): the Others row's values already
  // count a CPC line, so its target weighs over it too. That mixes weight UNITS — a CPC
  // line's plan-clicks against a video line's plan-impressions — as vcrT always did for CPV
  // plan-views. The has-target filter and the audio/video split are semantics, not pollution
  // guards — they hold on both bases.
  // ctrT is not in this loop's weighting: it counts every line with a target > 0, whatever
  // its rate type, weighted by delivered impressions (weightedCtrT, read lazily below).
  let mW = 0, mWt = 0, vcW = 0, vcWt = 0, acW = 0, acWt = 0;
  const ctrIds = [];
  let dpSum = 0, dlSum = 0, n = 0;
  // The target-CPM pair, campM's own (metrics.js:365/538): cost budget over plan impressions,
  // both summed over CPM-RATE lines only, both full-flight. `foldBasis` deliberately does not
  // lift this gate the way it lifts the vcrT one: a CPC line's `planImpr` holds plan
  // CLICKS, so folding it into this denominator is not a widened population, it is a unit
  // error — cost per thousand of a number that does not count impressions.
  let cpmBudSum = 0, cpmImprSum = 0;
  for (const id of effLIs) {
    const p = liPlan[id];
    if (!p) continue;
    const s = liPlanScalars(p, asOf, range, planWindow);
    out.budget += s.budget;
    out.costBud += s.costBud;
    out.costBudTotal += s.costBudTotal;
    out.planImpr += s.planImpr;
    out.planClicks += s.planClicks;
    out.planViews += s.planViews;
    out.budgetTotal += s.budgetTotal;
    // Summed per line, each at its own client money: never `costBud` over the weighted mTgt.
    out.budgetToDate += s.budgetToDate;
    out.planImprTotal += s.planImprTotal;
    out.planClicksTotal += s.planClicksTotal;
    out.planViewsTotal += s.planViewsTotal;
    const rt = p.rateType || 'CPM';
    const isCpc = rt === 'CPC';
    const isAudio = (p.ch || '').toLowerCase() === 'audio';
    const w = (Number(p.planImpr) || 0) || p.budget || 1;
    mW += (p.mTgt || 0) * (p.budget || 0); mWt += (p.budget || 0);
    const vcrRateOk = foldBasis || !isCpc;
    if (hasCtrTarget(p)) ctrIds.push(id);
    if (vcrRateOk && !isAudio && p.vcrTgt != null && Number.isFinite(p.vcrTgt) && p.vcrTgt > 0) { vcW += p.vcrTgt * w; vcWt += w; }
    if (isAudio && p.vcrTgt != null && Number.isFinite(p.vcrTgt) && p.vcrTgt > 0) { acW += p.vcrTgt * w; acWt += w; }
    if (rt === 'CPM') { cpmBudSum += costBudOf(p); cpmImprSum += (Number(p.planImpr) || 0); }
    // days: campM canon — average of per-LI prorated (fDays − dP) / dP.
    const pr = prorate(p, asOf);
    dpSum += pr.dP; dlSum += (pr.fDays - pr.dP); n++;
  }
  out.mTgt = mWt > 0 ? mW / mWt : 0;
  // NULL, not 0, when no line in the set carries the target — campM's own answer
  // and the whole point of sections-to-widgets M3. A zero here is a real goal of «0.00%»
  // to a reader: it made a KPI on `ctrT` draw a green «+0.12% vs 0.00%» on a pacing where
  // nobody had set a CTR target at all. Where a null is READ decides what it means:
  // `kpiValue` reports a bare field read as absent (no chip, no verdict), while inside
  // arithmetic `num()` keeps the absence-is-zero canon, because an operand has to be a number.
  // ctrT answers null by the same rule, and reads the window's facts only when it is read.
  defineLazyCtrT(out, () => {
    if (!imprOf && ctrIds.length && IS_DEV && !warnedNoImpr) {
      warnedNoImpr = true;
      console.warn('campaignScalars: ctrT read without imprOf, so it is plan-weighted on a set that may have '
        + 'delivered. Pass the window\'s per-line impressions (lineImpr).');
    }
    return weightedCtrT(liPlan, ctrIds, imprOf);
  });
  out.vcrT = vcWt > 0 ? vcW / vcWt : null;
  out.acrT = acWt > 0 ? acW / acWt : null;
  // Same null-not-zero rule, same reason: a pacing with no CPM line has no target CPM, and
  // «$0.00» under a real CPM would read as a goal nobody set.
  out.tgtCpm = cpmImprSum > 0 ? (cpmBudSum / cpmImprSum) * 1000 : null;
  out.daysPassed = n > 0 ? Math.max(0, Math.round(dpSum / n)) : 0;
  out.daysLeft = n > 0 ? Math.max(0, Math.round(dlSum / n)) : 0;
  return out;
}

/* ── per-LI gate classification ───────────────────────────────────────────── */

function gatesOf(p, daily) {
  const rt = p?.rateType || 'CPM';
  const isAudio = (p?.ch || '').toLowerCase() === 'audio';
  const vcrElig = isVcrEligible(p, daily);
  return {
    // campM impressions side: CPC/CPV lines are click/view-paced, so their impressions stay
    // out of the cpm basis (a CPC line's plan and its buying rate are clicks). The ctr basis
    // counts every line (owner decision 2026-09-23) and needs no gate.
    nc: rt !== 'CPC' && rt !== 'CPV',
    vcrElig,
    isAudio,
    // cost-per-view basis (campM cpvSpendV/cpvViewsV and chart aggCpv): CPV OR
    // VCR-eligible, never audio.
    cpvBasis: (rt === 'CPV' || vcrElig) && !isAudio,
    // views VOLUME basis (chart aggViews / coViews): + audio listen-throughs.
    coViews: rt === 'CPV' || vcrElig || isAudio,
  };
}

/* ── aggregation ──────────────────────────────────────────────────────────── */

// Sums carry every gated basis the canonical rates need (see file header).
const ZERO_FLOW = {
  im: 0, cl: 0, sp: 0, co: 0, coViews: 0, cv: 0, pc: 0, pv: 0, dc: 0,
  st: 0, q1: 0, q2: 0, q3: 0, rc: 0, lc: 0,   // the six added 2026-09-08 (registry ADDED_DELIVERY_KEYS)
  imV: 0, coV: 0,          // VCR-eligible basis
  imA: 0, coA: 0,          // ACR basis (audio lines only — VCR-convention parity)
  imNC: 0, spNC: 0,        // non-CPC/CPV basis (campM cpm)
  cpvSp: 0, cpvCo: 0,      // cost-per-view basis
  expIm: 0, expCo: 0, expCl: 0, expVw: 0, // window-delta expected (AGG contexts)
  // …and the impression-PACED half of expIm (section-widget parity 2026-09-04). campM's own
  // `eI` counts expected units over non-CPC/CPV lines only (metrics.js:344), because a CPC
  // line's plan is clicks and a CPV line's is views; `expIm` sums all three and therefore
  // disagrees with it on every mixed-rate pacing. Both readings are real and neither is a
  // substitute, so the gated one has a name of its own — the SAME name campM and the
  // canonical metric catalogue already use for it.
  imprExpected: 0,
};

// The literal above is what `addRowSums` walks, so the six added on 2026-09-08 had to be
// typed into it by hand rather than spread from the registry. This is the key list a test
// pins `MetricRegistry.ADDED_DELIVERY_KEYS` against, so a seventh cannot be forgotten here.
export const ZERO_FLOW_KEYS = Object.freeze(Object.keys(ZERO_FLOW));

// `rate` converts the row's client cost to USD and is passed ONLY by callers whose
// rows have not been through it yet. The two fact aggregates have: normalize.js
// runs every fact through row-utils' addFact, which applies the campaign rate as
// it builds liDaily / liSplitDaily. A dimension-source file has NOT — the builder
// copies the mart's dynamic_cost verbatim (pacing-build.js:192-205) — so a source
// bucket read the native currency while the KPI beside it read USD. Ten
// production pacings carry a non-USD rate.
//
// Calling currencyToUsd unconditionally would compute the same numbers — it
// returns its input for an absent, 1 or non-finite rate — so no test can tell the
// two apart. The branch stays for two reasons that are not test-visible: it says
// in the code which path is unconverted, and it keeps a call out of the hottest
// loop in this file, where addFact runs per line item per day.
//
// `k` (net cost mode) travels with `rate` and only with it: the unconverted callers
// are the ones whose money has been through neither, and a row that already came out
// of a fact aggregate is already net.
function addFact(t, v, g, rate, k) {
  t.im += v.im || 0; t.cl += v.cl || 0; t.sp += v.sp || 0; t.co += v.co || 0;
  t.cv += v.cv || 0; t.pc += v.pc || 0; t.pv += v.pv || 0;
  t.st += v.st || 0; t.q1 += v.q1 || 0; t.q2 += v.q2 || 0; t.q3 += v.q3 || 0; t.rc += v.rc || 0; t.lc += v.lc || 0;
  t.dc += rate === undefined ? (v.dc || 0) : PacingCore.netDc(Currency.currencyToUsd(v.dc, rate), k);
  if (g.coViews) t.coViews += v.co || 0;
  if (g.vcrElig) { t.imV += v.im || 0; t.coV += v.co || 0; }
  if (g.isAudio) { t.imA += v.im || 0; t.coA += v.co || 0; }
  if (g.nc) { t.imNC += v.im || 0; t.spNC += v.sp || 0; }
  if (g.cpvBasis) { t.cpvSp += v.sp || 0; t.cpvCo += v.co || 0; }
}

/** Re-sum rows that already carry the gated bases (totals over pre-gated rows). */
function addRowSums(t, r, customKeys = []) {
  for (const k of Object.keys(ZERO_FLOW)) t[k] += r[k] || 0;
  // Only declared additive source metrics join totals/folds. Summing every numeric
  // property would also sum rates and allow undeclared source fields to leak in.
  for (const k of customKeys) t[k] = (t[k] || 0) + (r[k] || 0);
}

/** Canonical rates per context basis (see file header): 'ts' ≡ chart rows,
 *  'entity' ≡ sumLI/Breakdown plain ratios, 'agg' ≡ campM. */
function ratesFromSums(t, basis /* 'ts' | 'entity' | 'agg' */) {
  if (basis === 'ts') {
    return {
      ctr: t.im > 0 ? (t.cl / t.im) * 100 : 0,
      vcr: t.imV > 0 && t.coV > 0 ? (t.coV / t.imV) * 100 : 0,
      // ACR (VCR-convention parity, audio lines): gated on imA > 0 ONLY, mirroring
      // KpiPlanFact's card exactly (KpiPlanFact.jsx:132) — NOT coA > 0 like vcr's
      // extra guard, so a widget's ACR number never disagrees with the KPI card.
      acr: t.imA > 0 ? (t.coA / t.imA) * 100 : 0,
      cpm: t.im > 0 ? (t.sp / t.im) * 1000 : 0,
      cpc: t.cl > 0 ? t.sp / t.cl : 0,
      cpv: t.cpvCo > 0 ? t.cpvSp / t.cpvCo : 0,
    };
  }
  if (basis === 'entity') {
    // One row = one entity: its own plain ratios (sumLI canon — a CPC line's CTR is
    // its clicks/impressions; campaign-level gates NEVER zero out a single row).
    //
    // `vcr` is the one exception, and it is not a campaign gate: `isVcrEligible` is a
    // fact about the LINE. An audio line's "completes" are listen-throughs, so its
    // completion rate is an ACR and never a VCR — which is why the legacy Daily
    // Performance section prints an em dash under VCR % there instead of a number
    // (DailyTable.jsx:461-463, measured in the sections-to-widgets M2 audit: this
    // basis answered 77.78% on an audio row and 0.00% on a display row with no
    // completes). The gated imV/coV pair carries that rule with nothing extra to
    // read — on an eligible line it IS im/co — and an empty pair answers NULL, which
    // the renderers print as an em dash: nothing to rate is not a rate of zero.
    //
    // `acr` keeps the plain ratio and no channel gate, because on an audio line that
    // ratio is exactly what the name means; the two are no longer pattern twins.
    // A FORMULA over `vcr` still reads 0, not null: an operand is a number by
    // construction (widget-formula.js `num`, the absence-is-zero canon).
    return {
      ctr: t.im > 0 ? (t.cl / t.im) * 100 : 0,
      vcr: t.imV > 0 && t.coV > 0 ? (t.coV / t.imV) * 100 : null,
      acr: t.im > 0 && t.co > 0 ? (t.co / t.im) * 100 : 0,
      cpm: t.im > 0 ? (t.sp / t.im) * 1000 : 0,
      cpc: t.cl > 0 ? t.sp / t.cl : 0,
      cpv: t.co > 0 ? t.sp / t.co : 0,
    };
  }
  return {
    // Every line (owner decision 2026-09-23): the same ratio as the 'ts' basis. cpm stays on
    // the impression-paced lines.
    ctr: t.im > 0 ? (t.cl / t.im) * 100 : 0,
    vcr: t.imV > 0 && t.coV > 0 ? (t.coV / t.imV) * 100 : 0,
    acr: t.imA > 0 ? (t.coA / t.imA) * 100 : 0,
    cpm: t.imNC > 0 ? (t.spNC / t.imNC) * 1000 : 0,
    cpc: t.cl > 0 ? t.sp / t.cl : 0,
    cpv: t.cpvCo > 0 ? t.cpvSp / t.cpvCo : 0,
  };
}

/** Expected window deltas for ONE plan over [from..to]: value at `to` minus value just
 *  before `from` (§3 AGG rule). liExp* clamp to the plan's flight internally. An empty window
 *  — `to` before `from`, which expectedBounds answers for a window that starts after asOf, or
 *  no `to` at all on a pacing with no data yet — expects nothing. */
const NO_EXPECTED = Object.freeze({ expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 });
function expectedDeltas(p, from, to) {
  if (!from || !to || from > to) return NO_EXPECTED;
  const base = from > p.fs
    ? { im: liExpImpr(p, datePrev(from)), co: liExpCost(p, datePrev(from)), cl: liExpClicks(p, datePrev(from)) }
    : { im: 0, co: 0, cl: 0 };
  // Raw floats — rounding happens at RENDER, never before summation (round 6.1:
  // three LIs at 0.4 each must total 1, not 0).
  const im = liExpImpr(p, to) - base.im;
  const rt = p.rateType || 'CPM';
  return {
    expIm: im,
    expCo: liExpCost(p, to) - base.co,
    expCl: liExpClicks(p, to) - base.cl,
    expVw: viewGoalUnits(p) > 0 ? im : 0,
    // The same gate `expVw` uses one line up, on the other side: this line's expected units
    // count only where those units ARE impressions (campM's impressions side, metrics.js:334).
    imprExpected: rt === 'CPC' || rt === 'CPV' ? 0 : im,
  };
}

/**
 * Per-LI window sums over [range] (plan-clipped) + expected window deltas.
 * The single AGG building block: li rows, KPI totals, table totals, categories.
 */
export function sumLiWindow(liDaily, p, id, range, boundsForExpected) {
  const dd = liDaily[id] || {};
  const t = { ...ZERO_FLOW };
  const g = gatesOf(p, dd);
  for (const [d, v] of Object.entries(dd)) {
    if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
    if (range && (d < range.from || d > range.to)) continue;
    addFact(t, v, g);
  }
  if (boundsForExpected) {
    const e = expectedDeltas(p, boundsForExpected.from, boundsForExpected.to);
    t.expIm += e.expIm; t.expCo += e.expCo; t.expCl += e.expCl; t.expVw += e.expVw;
    t.imprExpected += e.imprExpected;
  }
  return t;
}

/**
 * Per-date rows over the CONTINUOUS calendar axis of the window (round-6: gap days are
 * REAL rows with zero facts and the TRUE per-day expected curve — no forward-fill).
 * Row shape ≡ chart rows: flow fields + cumulative expected + TS-basis rates.
 */
/* `effLIsOverride` narrows the walk to one line item WITHOUT copying `sources`.
 * `{ ...sources, effLIs: [id] }` was the old spelling, and a spread READS every
 * enumerable own property — including `sources.liSplitDaily`, which is a getter
 * over the store's lazily-built per-dimension aggregate (dashboardStore.js). So
 * the dateLi loop below materialised the FULL O(rows × dims) LSD, once per line
 * item, on a widget that has nothing to do with dimensions. breakdown-filter.js
 * documents the same hazard and constructs its result explicitly for this reason. */
export function aggregateDateRows(sources, range, basis = 'ts', effLIsOverride = null) {
  const { liDaily, liPlan } = sources;
  const effLIs = effLIsOverride || sources.effLIs;
  const bounds = calendarBounds(sources, range);
  if (!bounds.from || !bounds.to || bounds.from > bounds.to) return [];

  const perLi = effLIs.map((id) => {
    const p = liPlan[id];
    if (!p) return null;
    const dd = liDaily[id] || {};
    const useBaseline = !!(range && range.from > p.fs);
    const g = gatesOf(p, dd);
    return {
      p, dd, g,
      hasViewGoal: viewGoalUnits(p) > 0,
      // `nc` is gatesOf's own impression-paced gate, read here for `imprExpected` — the same
      // predicate the per-day fact sums already use for imNC/spNC.
      imprPaced: g.nc,
      expImBase: useBaseline ? liExpImpr(p, datePrev(range.from)) : 0,
      expCoBase: useBaseline ? liExpCost(p, datePrev(range.from)) : 0,
      expClBase: useBaseline ? liExpClicks(p, datePrev(range.from)) : 0,
    };
  }).filter(Boolean);

  const rows = [];
  for (const d of calendarDays(bounds.from, bounds.to)) {
    const t = { ...ZERO_FLOW };
    let expIm = 0, expCo = 0, expCl = 0, expVw = 0, imprExpected = 0;
    for (const e of perLi) {
      const v = e.dd[d];
      if (v && !(e.p.fs && e.p.fe && (d < e.p.fs || d > e.p.fe))) addFact(t, v, e.g);
      expIm += liExpImpr(e.p, d) - e.expImBase;
      expCo += liExpCost(e.p, d) - e.expCoBase;
      expCl += liExpClicks(e.p, d) - e.expClBase;
      if (e.hasViewGoal) expVw += liExpImpr(e.p, d) - e.expImBase;
      if (e.imprPaced) imprExpected += liExpImpr(e.p, d) - e.expImBase;
    }
    rows.push({
      date: d, ...t,
      expIm, expCo, expCl, expVw, imprExpected,
      ...ratesFromSums(t, basis),
    });
  }
  return rows;
}

/* ── formula plumbing ─────────────────────────────────────────────────────── */

export const TS_FIELDS = new Set([...FIELDS_DAILY, ...FIELDS_EXPECTED, ...FIELDS_RATES, ...FIELDS_PLAN]);
export const AGG_FIELDS = TS_FIELDS;
// What EVERY dim bucket carries: delivery counts and the rates over them. A bucket of an
// undeclared dimension has no plan and no expected curve, and those fields are a validation
// ERROR there (round 6.1: they used to read as a silent, wrong 0).
export const DIM_FIELDS_SET = new Set([...FIELDS_DAILY, ...FIELDS_RATES]);

/**
 * …and what a DECLARED dimension adds (plan metrics on dim rows, 2026-09-12).
 *
 * A container's `dim_children` are a real plan for one value of one dimension —
 * `dim-scope.js` has built a leaf virtual plan out of one since dim Scope shipped, and the
 * dashboard headline paces a dim chip against exactly that. A widget cut by the same
 * dimension was still refusing the number its own headline shows.
 *
 * `daysLeft` / `daysPassed` stay out. They describe a WINDOW, and a segment's window is its
 * container's, so two rows of one table would report different day counts over the same
 * calendar — a fact nobody reading a breakdown is asking for, stated confusingly.
 */
export const DIM_PLAN_SCALARS = new Set(
  [...FIELDS_PLAN].filter((k) => k !== 'daysLeft' && k !== 'daysPassed'),
);

export const DIM_PLAN_FIELDS = new Set([...DIM_PLAN_SCALARS, ...FIELDS_EXPECTED]);

export const DIM_DECLARED_FIELDS_SET = new Set([...DIM_FIELDS_SET, ...DIM_PLAN_FIELDS]);

/** Every plan scalar spelled as an explicit NULL. A row of a declared dimension whose own
 *  value nobody declared reads its plan cells out of this, so `fieldValue` answers null — an
 *  em dash — instead of falling through to its terminal `return 0`. The zero is the bug this
 *  whole rule was written against; it must not come back through the relaxed door. */
export const DIM_PLAN_NULLS = Object.freeze(
  Object.fromEntries([...DIM_PLAN_SCALARS].map((k) => [k, null])),
);

/** …and the same for the expected curve, which needs its own object because a dim bucket
 *  already CARRIES those keys as 0 (they are part of ZERO_FLOW). `fieldValue` reads the sums
 *  before the scalars, so an undeclared row has to say null in the sums themselves. */
export const DIM_EXPECTED_NULLS = Object.freeze(
  Object.fromEntries([...FIELDS_EXPECTED].map((k) => [k, null])),
);

/** Which dim keys this pacing declares a target on, memoised per raw-plan object. */
export function declaredDimKeys(sources) {
  return collectDeclaredDimKeys((sources && (sources.rawLiPlan || sources.liPlan)) || {});
}

/**
 * May a row of THIS dimension carry a plan?
 *
 * Only a namebuilder dim that some container declares. A dimension SOURCE is its own file
 * and containers know nothing about it; `channel` is a property of the line item rather than
 * a declared target; the two aux cuts are files beside the facts. All three keep the original
 * refusal, in the original words.
 */
export function dimIsNamebuilder(dimKey) {
  if (typeof dimKey !== 'string' || !dimKey) return false;
  return dimKey !== CHANNEL_DIM && !isAuxDim(dimKey) && !dimKey.startsWith('ds:');
}

export function dimKeyPlanEligible(declaredDims, dimKey) {
  if (!dimIsNamebuilder(dimKey)) return false;
  return !!declaredDims && declaredDims.has(dimKey);
}

export function dimPlanEligible(sources, dimKey) {
  return dimKeyPlanEligible(declaredDimKeys(sources), dimKey);
}

/**
 * The fields a widget on THIS dimension may name: the shared dim set, the plan half where
 * the dimension is declared, plus the metric keys a dimension source declares for itself.
 *
 * Without it a source's own metric renders as `Unknown field "c1"` — which is
 * the good failure. The bad one is the reason this is a Set and not a relaxed
 * check: an unknown key that slips into a sum is never added by addFact and
 * prints a confident 0.
 */
export function dimFieldSetFor(sources, sourceId, dimKey = null) {
  const custom = customMetricKeys(sources, sourceId);
  // Widened for EVERY namebuilder dimension, declared or not — the PICKER is where «this
  // pacing declares no targets here» is enforced, and it is enforced before the save. What
  // the runtime must not do is answer «Unknown field "planImpr"» on a widget that was
  // authored legally and then travelled: a Library widget is validated with no pacing in
  // hand, and a pacing can lose its containers after the fact. Those cases print an em dash,
  // which says «no target» — a red column error says «this widget is broken», and it is not.
  const base = dimIsNamebuilder(dimKey) ? DIM_DECLARED_FIELDS_SET : DIM_FIELDS_SET;
  return custom.length ? new Set([...base, ...custom]) : base;
}

/** The metric keys a dimension source carries beyond the shared dim set: the custom ones a
 *  Google-Sheet source declares, the registry roles it MAPS that are not delivery fields
 *  (`vi` — otherwise the loader writes the column and nothing ever reads it), and — for a
 *  catalogued bq_mart source — the mart columns outside the delivery universe (`vi` on
 *  devices). All three are summed the same way below. A key cannot arrive twice: `m1..m4`
 *  are not registry keys, and a source is either mapped by hand or catalogued. */
function customMetricKeys(sources, sourceId) {
  const configured = Array.isArray(sources?.dimSourceConfigs) ? sources.dimSourceConfigs : [];
  const src = configured.find((x) => x && typeof x === 'object' && x.id === sourceId);
  const columns = (src?.origin || {}).columns || {};
  const keys = MetricRegistry.customMetricsOf(columns).map((m) => m.key)
    .concat(mappedExtraMetrics(src).map((m) => m.key))
    .concat(catalogExtraMetrics(src).map((m) => m.key));
  return keys.filter((k, i) => keys.indexOf(k) === i);
}

/** The first window (`tsOnly`) function an expression names, or null. Exported because the
 *  CM360 window pass (report-render.js, spec §2.9) needs the NAME: off a date axis it prints
 *  `dateAxisRefusal(fn)`, the same sentence `validate` shows while the author types. One
 *  walk, so a function that becomes window-only in FUNCTIONS becomes window-only on both
 *  paths at once. */
export function windowFnName(ast) {
  let found = null;
  (function walk(n) {
    if (found || !n) return;
    if (n.t === 'call') {
      if (FUNCTIONS[n.fn]?.tsOnly) { found = n.fn; return; }
      n.args.forEach(walk);
    } else if (n.t === 'bin' || n.t === 'cmp') { walk(n.l); walk(n.r); }
    else if (n.t === 'neg') walk(n.e);
  })(ast);
  return found;
}

function usesWindowFn(ast) { return windowFnName(ast) !== null; }

function scalarExpression(ast) {
  if (ast.t === 'id') return FIELDS_PLAN.has(ast.name);
  if (ast.t === 'call') return !FUNCTIONS[ast.fn]?.tsOnly && ast.args.every(scalarExpression);
  if (ast.t === 'bin' || ast.t === 'cmp') return scalarExpression(ast.l) && scalarExpression(ast.r);
  if (ast.t === 'neg') return scalarExpression(ast.e);
  return ast.t === 'num';
}

// A date × LI table can skip empty calendar days only when no column reads them.
// round(x, precision) also reads its precision from the FIRST calendar day, even
// without a window function; a precision based on delivery must keep that day.
function calendarExpression(ast) {
  if (ast.t === 'id') return FIELDS_EXPECTED.has(ast.name);
  if (ast.t === 'call') return !!FUNCTIONS[ast.fn]?.tsOnly
    || (ast.fn === 'round' && ast.args[1] && !scalarExpression(ast.args[1]))
    || ast.args.some(calendarExpression);
  if (ast.t === 'bin' || ast.t === 'cmp') return calendarExpression(ast.l) || calendarExpression(ast.r);
  if (ast.t === 'neg') return calendarExpression(ast.e);
  return false;
}

function factDateRows(sources, id, bounds) {
  if (!bounds.from || !bounds.to || bounds.from > bounds.to) return [];
  const p = sources.liPlan[id];
  const dd = sources.liDaily[id] || {};
  const g = gatesOf(p, dd);
  return Object.keys(dd).filter((d) => dd[d] && d >= bounds.from && d <= bounds.to
    && !(p.fs && p.fe && (d < p.fs || d > p.fe))).sort().map((date) => {
    const sums = { ...ZERO_FLOW };
    addFact(sums, dd[date], g);
    return { date, ...sums, ...ratesFromSums(sums, 'entity') };
  });
}

function expressionFieldError(ast, errors) {
  if (!ast || !errors) return null;
  if (ast.t === 'id') return errors[ast.name] || null;
  if (ast.t === 'call') return ast.args.map((a) => expressionFieldError(a, errors)).find(Boolean) || null;
  if (ast.t === 'bin' || ast.t === 'cmp') return expressionFieldError(ast.l, errors) || expressionFieldError(ast.r, errors);
  if (ast.t === 'neg') return expressionFieldError(ast.e, errors);
  return null;
}

/* ── primary conversions: readings that cannot be answered (spec 2026-09-13 §3, §4) ── */

/** The three conversion fields a line item's choice rebuilds. */
const CV_FIELDS = new Set(['cv', 'pc', 'pv']);

/** Does this AST name any field of `names`? Every branch counts, an untaken `if` branch too:
 *  a formula over an unknown operand is an unknown reading. */
function astNamesAny(ast, names) {
  let found = false;
  (function walk(n) {
    if (found || !n) return;
    if (n.t === 'id') { if (names.has(n.name)) found = true; return; }
    if (n.t === 'call') n.args.forEach(walk);
    else if (n.t === 'bin' || n.t === 'cmp') { walk(n.l); walk(n.r); }
    else if (n.t === 'neg') walk(n.e);
  })(ast);
  return found;
}

/** A compiled column that reads a conversion field, bare or inside a formula. */
function readsCvField(c) {
  if (!c) return false;
  if (c.kind === 'field') return CV_FIELDS.has(c.field);
  return c.kind === 'expr' && astNamesAny(c.ast, CV_FIELDS);
}

/** The same question about a stored expression, for the renderer's column rules. */
export function expressionReadsConversions(expr) {
  if (typeof expr !== 'string' || !expr) return false;
  const parsed = parse(expr);
  return !!(parsed.ok && parsed.ast) && astNamesAny(parsed.ast, CV_FIELDS);
}

/** Is the switch operative for the facts this widget reads? The overlay registers state only
 *  when it is, so no state is the switch-off path and every reader below returns untouched. */
export function cvOperative(sources) {
  if (!sources) return false;
  const daily = sources.liDaily;
  const campaign = sources.campaignLiDaily;
  return !!((daily && cvStateOf(daily)) || (campaign && cvStateOf(campaign)));
}

/** Operative, and some line item in view carries a stored choice. The RAW plan first: the
 *  period and dimension virtual plans drop fields they do not know. */
export function primaryCvInView(sources) {
  if (!cvOperative(sources)) return false;
  const plans = sources.rawLiPlan || sources.liPlan || {};
  return (sources.effLIs || []).some((id) => {
    const list = hasOwn(plans, id) ? plans[id].primaryCv : null;
    return Array.isArray(list) && list.length > 0;
  });
}

/** Does a plan's flight touch this window? A line item outside it adds nothing to a reading,
 *  so it cannot make the reading unknown either. */
function planReaches(p, range) {
  if (!p) return false;
  if (!range || !(p.fs && p.fe)) return true;
  return !(range.from && p.fe < range.from) && !(range.to && p.fs > range.to);
}

/** The line items of `ids` whose conversions `sources.liDaily` cannot answer inside `range`.
 *  A line item the view keeps nothing of is not in view: its conversions read 0, like its
 *  delivery, and it never nulls a total (spec §4). */
function cvOffIds(sources, ids, range) {
  const daily = sources && sources.liDaily;
  if (!daily || !cvStateOf(daily)) return [];
  return (ids || []).map(String).filter((id) => cvBlocksTotals(daily, id)
    && planReaches(sources.liPlan && sources.liPlan[id], range));
}

/** Why a total built on conversions reads «—» (spec §3 totals rule): the rate rows' own words
 *  (brick-data.js `cvUnavailableText`), so a table and a rate row never disagree. */
function cvCannotShowText(n) {
  const count = n > 0 ? n : 1;
  return `${count} line item${count === 1 ? '' : 's'} cannot show conversions here`;
}

/** Why a row that holds more than one line item reads «—» in its conversion cells. */
const CV_ROW_REASON = 'A line item in this row cannot show conversions here';

/** Why one line item's own row reads «—»: its state's reason (source, file, filter). */
function cvReasonOf(sources, id) {
  const state = sources && sources.liDaily ? cvStateOf(sources.liDaily) : null;
  const entry = state && state[String(id)];
  return (entry && entry.reason) || CV_ROW_REASON;
}

/** The line items whose conversions no longer come from the platform: a choice applied
 *  (primary) or one that cannot be (unavailable). A file keyed by a device or a creative
 *  carries platform conversions only, so it can place neither. */
function cvRebuiltIds(sources) {
  const daily = sources && sources.liDaily;
  const state = daily ? cvStateOf(daily) : null;
  if (!state) return null;
  const out = new Set();
  for (const id of sources.effLIs || []) {
    const s = state[String(id)];
    if (s && s.cv !== CV.PLATFORM) out.add(String(id));
  }
  return out;
}

/** Namebuilder dimension: unavailable line items, plus the ones the split record says cannot
 *  be placed in a bucket of THIS dimension. */
function splitCvIds(sources, dimKey) {
  if (!cvOperative(sources)) return null;
  const ids = new Set(cvOffIds(sources, sources.effLIs, null));
  const lsd = sources.liSplitDaily;
  const split = lsd ? splitStateOf(lsd) : null;
  if (split) {
    for (const id of sources.effLIs || []) {
      const entry = split[String(id)];
      if (entry && entry[dimKey] && entry[dimKey].cv === true) ids.add(String(id));
    }
  }
  return ids;
}

/** One cut's record of what its conversion cells cannot say: the line items, the bucket
 *  labels they touched, and whether the remainder and the totals include them. */
function newCvBlock(ids) {
  return ids && ids.size ? { ids, labels: new Set(), residual: false, totals: false } : null;
}

/** A day row or a source row, in the engine's short names, that carries delivery. A row with none
 *  cannot put a line item in a bucket (spec §4: the buckets its delivery touches). */
function dayHasDelivery(v) {
  return !!v && ((Number(v.im) || 0) > 0 || (Number(v.cl) || 0) > 0 || (Number(v.co) || 0) > 0
    || (Number(v.sp) || 0) > 0 || (Number(v.dc) || 0) > 0);
}

function channelCvBlock(sources, range) {
  const block = newCvBlock(new Set(cvOffIds(sources, sources.effLIs, range)));
  if (!block) return null;
  for (const id of block.ids) block.labels.add((sources.liPlan[id] && sources.liPlan[id].ch) || 'Unknown');
  block.totals = true;
  return block;
}

/** Is this row of a cut one whose conversion cells are unknown? */
function cvBlockedLabel(cut, label) {
  if (!cut || !cut.cvBlock) return false;
  return label === cut.residual ? cut.cvBlock.residual : cut.cvBlock.labels.has(label);
}

/** Per calendar row: does it include a line item whose conversions are unavailable? */
function cvDateMask(sources, rows, ids, range) {
  const off = cvOffIds(sources, ids, range);
  if (!off.length) return null;
  const plans = off.map((id) => sources.liPlan[id]);
  return rows.map((r) => plans.some((p) => !(p.fs && p.fe) || (r.date >= p.fs && r.date <= p.fe)));
}

/** A column's values with the masked cells emptied. A window function carries every earlier
 *  day into the later ones, so one unknown day empties the whole column. */
function maskCvValues(values, mask, windowed) {
  if (windowed && mask.some(Boolean)) return values.map(() => null);
  return values.map((v, i) => (mask[i] ? null : v));
}

/** The Conversion Action chip's counts for one row: line items in view that carry the action,
 *  and how many of those have it in their operative choice. Sparse: null when none chose it.
 *  A row is a DISPLAY name (spec docs/2026-09-24-display-names.md) and a choice is stored as
 *  raw actions, so `actionLis` maps each line item to the raw actions it carries under the
 *  row: a line item counts as choosing the row when its choice holds every one of them. With
 *  no names stored that set is the row's own action, which is today's test. */
function primaryMarkOf(sources, cut, label) {
  const lis = cut.leftovers.has(label) ? null : cut.actionLis.get(label);
  if (!lis || lis.size === 0) return null;
  const plans = sources.rawLiPlan || sources.liPlan || {};
  let chosen = 0;
  for (const [id, raws] of lis) {
    const p = hasOwn(plans, id) ? plans[id] : null;
    if (p && p.conversionData === true && Array.isArray(p.primaryCv)
      && [...raws].every((raw) => p.primaryCv.includes(raw))) chosen += 1;
  }
  return chosen > 0 ? { primary: { chosen, of: lis.size } } : null;
}

// Primary conversions (spec 2026-09-13 §3 "Days"): a conversion-only day row is not a fact.
// Without the skip a "spend < X" rule would paint a delivery cell on that date. Not
// operative: cvOnlyDaysOf answers null and both functions run today's test.
const isCvOnlyDay = (cvOnly, id, date) => !!(cvOnly && cvOnly[id] && cvOnly[id].has(date));
export function highlightHasFacts(sources, range, ids = sources?.effLIs || []) {
  const cvOnly = sources?.liDaily ? cvOnlyDaysOf(sources.liDaily) : null;
  return ids.some((id) => Object.entries(sources?.liDaily?.[id] || {}).some(([date, value]) => value
    && !isCvOnlyDay(cvOnly, id, date)
    && (!range || ((!range.from || date >= range.from) && (!range.to || date <= range.to)))
    && highlightDateInPlan(date, sources.liPlan?.[id])));
}
const highlightDateInPlan = (date, plan) => !!plan && !(plan.fs && plan.fe && (date < plan.fs || date > plan.fe));
function highlightDateRows(rows, sources, ids = sources.effLIs) {
  const cvOnly = sources.liDaily ? cvOnlyDaysOf(sources.liDaily) : null;
  const dates = new Set(ids.flatMap((id) => Object.entries(sources.liDaily?.[id] || {})
    .filter(([date, value]) => value && !isCvOnlyDay(cvOnly, id, date)
      && highlightDateInPlan(date, sources.liPlan?.[id])).map(([date]) => date)));
  return rows.map((row) => ({ ...row, __highlightFacts: dates.has(row.date) }));
}

const HIGHLIGHT_TARGET_FIELDS = new Set(['ctrT', 'vcrT', 'acrT', 'tgtCpm']);

function highlightFieldValue(name, sums, scalars, basis) {
  if (scalars && name in scalars) {
    const value = scalars[name];
    return HIGHLIGHT_TARGET_FIELDS.has(name) && !(value > 0) ? null : value;
  }
  if (sums?.__highlightFacts === false && (FIELDS_DAILY.has(name) || FIELDS_RATES.has(name))) return null;
  const denominators = {
    ctr: 'im', cpm: basis === 'agg' ? 'imNC' : 'im',
    vcr: 'imV', acr: basis === 'entity' ? 'im' : 'imA', cpc: 'cl',
    cpv: basis === 'entity' ? 'co' : 'cpvCo',
  };
  if (Object.hasOwn(denominators, name)) {
    if (!(sums?.[denominators[name]] > 0)) return null;
    if (name === 'vcr' && basis === 'entity' && !(sums.coV > 0)) return null;
    return ratesFromSums(sums, basis)[name];
  }
  return sums && Object.hasOwn(sums, name) ? sums[name] : null;
}

function seriesCtx(calRows, scalars, highlightBasis = null) {
  const cols = new Map();
  return {
    length: calRows.length,
    get(name) {
      if (highlightBasis) {
        if (!cols.has(name)) cols.set(name, calRows.map((r) => highlightFieldValue(name, r, scalars,
          highlightBasis === 'dateLi' && (name === 'acr' || name === 'cpv') ? 'ts' : highlightBasis === 'dateLi' ? 'entity' : highlightBasis)));
        return cols.get(name);
      }
      if (scalars && name in scalars) return scalars[name];
      if (!FIELDS_DAILY.has(name) && !FIELDS_EXPECTED.has(name) && !FIELDS_RATES.has(name)) return null;
      if (!cols.has(name)) cols.set(name, calRows.map((r) => r[name] ?? 0));
      return cols.get(name);
    },
  };
}

function aggCtx(sums, scalars, basis = 'agg', highlightSafe = false) {
  const rates = ratesFromSums(sums, basis);
  return {
    get(name) {
      if (highlightSafe) return highlightFieldValue(name, sums, scalars, basis);
      if (name in rates) return rates[name];          // rates BEFORE raw sums (gated)
      if (name in sums) return sums[name];            // incl. expected window deltas
      if (scalars && name in scalars) return scalars[name];
      return null;
    },
  };
}

/** Resolve a bare `field` cell against a context (sums+rates+scalars). null = unknown. */
function fieldValue(name, sums, scalars, fieldSet, basis = 'agg') {
  if (!fieldSet.has(name)) return null; // unknown fields must ERROR, never silent-0
  const rates = ratesFromSums(sums, basis);
  if (name in rates) return rates[name];
  if (name in sums) return sums[name];
  if (scalars && name in scalars) return scalars[name];
  return 0;
}

function compileColumns(columns, contextKind, fieldSet) {
  return (columns || []).map((c) => {
    if (c.source?.field != null) {
      // Bare field refs are validated like idents (round-6: an unknown/plan-in-dim
      // field must surface as a column error, not a silent 0).
      if (!fieldSet.has(c.source.field)) {
        return { ...c, kind: 'error', error: `Unknown field "${c.source.field}"` };
      }
      return { ...c, kind: 'field', field: c.source.field };
    }
    const src = c.source?.expr || '';
    const v = validate(src, contextKind, fieldSet);
    if (!v.ok) return { ...c, kind: 'error', error: formulaSay(v) };
    const ast = parse(src).ast;
    return { ...c, kind: 'expr', ast, windowed: usesWindowFn(ast) };
  });
}

/* ── dim buckets (shared by dim tables and dim categories) ────────────────── */

/** The unit a pacing BUYS in, by its dominant rate type. Its own copy rather than an import
 *  from auto-controls.js, which reaches metric-catalog.js and would close an import cycle
 *  back onto this module. Two lines, and the pair is pinned by a test. */
const BUY_UNIT_OF_RATE = { CPC: 'cl', CPV: 'co' };

/** The one entry in a bucket's per-line delivery map that is not a line item: the untagged
 *  remainder, which is line totals minus the tagged buckets and therefore has no line of its
 *  own. A line item id is always digits, so this can never collide with one. */
const RESIDUAL_ORIGIN = '__residual__';

// A dimension-source axis is written `ds:<sourceId>:<dimKey>` — the two colons
// are what tells it apart from a namebuilder dim, whose keys never contain one.
// Returns null for anything else, so the caller keeps its existing path.
function parseDimSourceKey(dimKey) {
  if (typeof dimKey !== 'string' || !dimKey.startsWith('ds:')) return null;
  const rest = dimKey.slice(3);
  const cut = rest.indexOf(':');
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { sourceId: rest.slice(0, cut), dim: rest.slice(cut + 1) };
}

// Buckets from a dimension source: same flight clamp, same range filter and the
// same per-line gates as the namebuilder path below. The rows carry their own
// line_item_id, so every gated basis (VCR eligibility, audio, the cost-per-view
// pair) resolves from that line's plan exactly as it does there — a device row
// on a video line counts toward the video basis and a display row does not.
// Values pass through the grouping table first, so the several spellings of one
// device are one row (spec §7).
/** The stored group list for one (source, dimension), or undefined. */
function dimSourceGroups(sources, sourceId, dim) {
  const configured = Array.isArray(sources.dimSourceConfigs) ? sources.dimSourceConfigs : [];
  const src = configured.find((s) => s && typeof s === 'object' && s.id === sourceId);
  const groups = (src || {}).groups;
  if (!groups || typeof groups !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(groups, dim) ? groups[dim] : undefined;
}

/** Raw auxiliary files bypass normalize.js. Apply its coefficient rule per row,
 * using only dimensions this source can actually identify. A DSP creative name
 * is not the namebuilder's creative dimension; only brk or an explicit source
 * mapping can supply those values. Keep ordinary client cost on the currency path. */
function coefficientFactReader(sources, sourceId, fieldErrors) {
  const indexes = new Map();
  const configured = Array.isArray(sources.dimSourceConfigs) ? sources.dimSourceConfigs : [];
  const config = configured.find((s) => s && s.id === sourceId);
  const mappings = new Map();
  for (const d of config?.origin?.columns?.dims || []) {
    if (d?.brk_dim && !mappings.has(d.brk_dim)) mappings.set(d.brk_dim, {
      key: d.key, groups: dimSourceGroups(sources, sourceId, d.key),
    });
  }
  return (fact, raw, lid, plan) => {
    // Virtual Scope plans describe targets and may be leaves. Cost attribution
    // still follows the original per-row coefficient rules, like base facts.
    plan = sources.rawLiPlan?.[lid] || plan;
    if (!plan?.coef) return fact;
    if (!indexes.has(lid)) indexes.set(lid, PacingCore.buildMarginIndex(plan));
    const idx = indexes.get(lid);
    const row = Object.assign(Object.create(null), { date: raw.date, spend: fact.sp });
    for (const e of idx.dim) {
      if (raw.date < e.fs || raw.date > e.fe || hasOwn(row, e.key)) continue;
      const mapping = mappings.get(e.key);
      if (mapping && raw.dims && hasOwn(raw.dims, mapping.key)) {
        row[e.key] = groupValue(mapping.key, raw.dims[mapping.key], mapping.groups).label;
      } else if (raw.brk && hasOwn(raw.brk, e.key)) row[e.key] = raw.brk[e.key];
      else if (e.key === 'platform' && hasOwn(raw.filter_context || {}, 'platform')) row[e.key] = raw.filter_context.platform;
      else if (hasOwn(raw.filter_context?.dims || {}, e.key)) row[e.key] = raw.filter_context.dims[e.key];
    }
    const dc = PacingCore.coefDcForRow(idx, row);
    // A mapped dictionary and a canonical breakdown can disagree. Neither is
    // evidence that the other margin is a known nonmatch. Compare the two reads
    // through the same precedence rules; unrelated labels / equal costs are safe.
    const canonical = { ...row };
    const conflicts = [];
    for (const key of Object.keys(row)) {
      if (!mappings.has(key) || !raw.brk || !hasOwn(raw.brk, key)) continue;
      if (String(row[key] ?? '').trim() === String(raw.brk[key] ?? '').trim()) continue;
      canonical[key] = raw.brk[key];
      conflicts.push(key);
    }
    if (conflicts.length && PacingCore.coefDcForRow(idx, canonical) !== dc) {
      fieldErrors.dc = `Client cost is unavailable: source and breakdown ${conflicts.join(', ')} values disagree on coefficient margins.`;
      return { ...fact, dc: 0 };
    }
    // An absent dimension may match an earlier override. If that would change
    // cost, neither this row nor a total of it has a defensible Client Cost.
    // Later rules cannot affect a known first match; equal margins and zero spend
    // remain answerable even when a dimension is absent.
    // Both interpretations must be answerable. A mapped first match must not
    // conceal an unknown later margin in the canonical interpretation.
    for (const candidate of conflicts.length ? [row, canonical] : [row]) {
      for (const e of idx.dim) {
        if (raw.date < e.fs || raw.date > e.fe) continue;
        if (hasOwn(candidate, e.key)) {
          if (candidate[e.key] != null && String(candidate[e.key]).trim() === e.val) break;
        } else if (PacingCore.coefDcForRow({ dim: [], dateCh: [], cont: [], mTgt: e.m }, candidate) !== dc) {
          fieldErrors.dc = `Client cost is unavailable: this source does not identify ${e.key} values needed for coefficient margins.`;
          return { ...fact, dc: 0 };
        }
      }
    }
    return { ...fact, dc };
  };
}

/**
 * Can this source answer the dashboard's dimension filter, and how?
 *
 * A sheet row is (date × line item × its own columns). It can be sliced by a
 * dashboard dimension only when the source itself CARRIES that dimension — a
 * library declared to answer for it (`brk_dim`), whose canonical values are
 * compared against the filter through the same dictionary the user maintains.
 *
 * The alternative — restricting rows to the line items that survive the filter —
 * is exact only while no line item is split across two values of that dimension,
 * which real pacings routinely are (measured: 3 of 4 line items in one live
 * pacing carry more than one `geo`). Guessing there would print a filtered number
 * that never was measured, so an unanswerable filter is REPORTED, never
 * approximated.
 *
 * → { matchers: [{ dimKey, groups, values }], unanswered: ['geo', …] }
 */
export function dimSourceFilterPlan(sources, sourceId, brkf, platforms = sources?.platforms) {
  const pairs = parseBreakdownFilters({ brkf });
  const out = { matchers: [], unanswered: [] };
  if (!pairs.length && !platforms?.length) return out;
  for (const pair of pairs) {
    if (pair.key === OUTSIDE_KEY && !out.unanswered.includes(pair.dim)) out.unanswered.push(pair.dim);
  }
  const configured = Array.isArray(sources?.dimSourceConfigs) ? sources.dimSourceConfigs : [];
  const src = configured.find((s) => s && typeof s === 'object' && s.id === sourceId);
  const dims = (((src || {}).origin || {}).columns || {}).dims || [];
  const cols = (((src || {}).origin || {}).columns) || {};
  const cuts = [...groupBreakdownFilters(pairs)];
  if (platforms?.length) cuts.push(['platform', new Set(platforms.map(String))]);
  for (const [brkDim, values] of cuts) {
    // An explicit claim wins. A library that says it IS the flight column was
    // set by a person looking at this source; the composed name is the general
    // fallback, and where both exist the specific statement is the truer one.
    const answering = dims.find((d) => d && d.brk_dim === brkDim);
    if (answering) {
      out.matchers.push({
        from: 'library',
        dimKey: answering.key,
        groups: dimSourceGroups(sources, sourceId, answering.key),
        values,
      });
      continue;
    }
    // Read by position out of the composed line-item name, so the values are the
    // facts' own — nothing to reconcile and no dictionary to keep in step.
    if (cols.cnb_name && CNB_POSITIONS.includes(brkDim)) {
      out.matchers.push({ from: 'name', dim: brkDim, values,
        folded: new Set([...values].map((v) => String(v).trim().toLowerCase())) });
      continue;
    }
    out.unanswered.push(brkDim);
  }
  return out;
}

// One prepared answer per source object/window. Rendering a table, its reason and
// its coverage line must not each scan the same auxiliary file.
const sourceRowsCache = new WeakMap();
export function filterSourceRows(sources, dimKey, range = null) {
  if (!sources) return { rows: [], reason: null };
  let cache = sourceRowsCache.get(sources);
  if (!cache) { cache = new Map(); sourceRowsCache.set(sources, cache); }
  const key = JSON.stringify([dimKey, range?.from, range?.to]);
  if (cache.has(key)) return cache.get(key);
  const save = (result) => {
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  };
  if (isAuxDim(dimKey)) {
    const result = filterAuxRows(
      dimKey === AUX_CREATIVE ? sources.creatives : sources.conversions,
      sources, { liIds: sources.effLIs, liPlan: sources.liPlan, range,
        outsidePlanMap: sources.rawLiPlan || sources.liPlan, containerFilters: sources.containerFilters,
        lensContext: sources.lensContext === true,
        // Conversion tags (primary conversions spec 2026-09-13 §4, §9): a conversion row's own tags
        // count against the pacing's unfiltered delivery, and a refusal says what is true for this
        // file. Creative rows carry no own tags and keep today's sentences.
        ...(dimKey === AUX_CONVERSION ? {
          tagMembers: Array.isArray(sources.cvTagFacts) ? purityIndex(sources.cvTagFacts) : null,
          tagsOn: sources.conversionTagsOn === true, fileTags: sources.conversionTags || null,
        } : null) },
    );
    const name = dimKey === AUX_CREATIVE ? 'Creative asset data' : 'Conversion action data';
    return save(result.reason ? { ...result, reason: result.reason.replace('This data', name) } : result);
  }
  const ds = parseDimSourceKey(dimKey);
  if (!ds) return save({ rows: [], reason: null });
  const plan = dimSourceFilterPlan(sources, ds.sourceId, sources.brkf);
  if (plan.unanswered.length) return save({ rows: [], reason: `This source does not follow the active ${plan.unanswered.join(', ')} filters. Clear these filters to see the breakdown.` });
  const ids = new Set((sources.effLIs || []).map(String));
  const rows = sources.dimSources?.[ds.sourceId]?.rows || [];
  const containerPlans = new Map();
  const kept = [];
  for (const r of rows) {
    if (!r || !ids.has(String(r.line_item_id))) continue;
    const p = sources.liPlan?.[r.line_item_id];
    if (p?.fs && p?.fe && (r.date < p.fs || r.date > p.fe)) continue;
    if (range && (r.date < range.from || r.date > range.to)) continue;
    let unknown = false;
    let matches = true;
    if (!containerPlans.has(r.line_item_id)) {
      const pairs = Object.entries(sources.containerFilters?.[r.line_item_id] || {})
        .flatMap(([dim, values]) => values.map((value) => `${dim}:${value}`));
      containerPlans.set(r.line_item_id, dimSourceFilterPlan(sources, ds.sourceId, pairs, []));
    }
    const containerPlan = containerPlans.get(r.line_item_id);
    if (containerPlan.unanswered.length) unknown = true;
    const matchers = plan.matchers.concat(containerPlan.matchers.map((m) => ({ ...m, includeUnnamed: true })));
    for (const m of matchers) {
      const values = m.from === 'name' ? r.brk : r.dims;
      const field = m.from === 'name' ? m.dim : m.dimKey;
      if (!hasOwn(values || {}, field)) { unknown = true; continue; }
      const own = values[field];
      if (m.includeUnnamed && (own == null || !String(own).trim() || String(own).trim() === '-')) continue;
      if (m.from === 'name'
        ? !m.folded.has(String(own ?? '').trim().toLowerCase())
        : !m.values.has(groupValue(m.dimKey, own, m.groups).label)) matches = false;
    }
    if (!matches) continue;
    if (unknown) return save({ rows: [], reason: 'This source does not follow the active filters: some rows are missing the required dimension values. Clear these filters to see the breakdown.' });
    kept.push(r);
  }
  return save({ rows: kept, reason: null });
}

export function sourceFilterReason(sources, dimKey, range = null) {
  return filterSourceRows(sources, dimKey, range).reason;
}

/** `leftovers` is the caller's Set, filled with the keys this function MINTED for rows the
 *  source could not name (the four early exits below hand back no buckets and so add none). */
function dimSourceBuckets(sources, sourceId, dim, range, leftovers, fieldErrors, cvBlock = null) {
  const map = sources.dimSources;
  if (!map || !Object.prototype.hasOwnProperty.call(map, sourceId)) return {};
  // The file is here and its rows are real, but they may not be read for THIS
  // breakdown: its column was re-pointed since the read, or it left the sheet
  // (spec §6.2). Drawing them anyway is the failure the whole revision exists to
  // prevent — the tile keeps its title and starts showing something else. Return
  // empty instead, and the canonical View names the reason.
  if (!breakdownServable(map, sourceId, dim)) return {};
  // A filter this source cannot answer must not quietly produce the UNFILTERED
  // total beside filtered delivery — the number would describe a different
  // campaign than everything around it.
  const filtered = filterSourceRows(sources, `ds:${sourceId}:${dim}`, range);
  if (filtered.reason) return {};
  const rows = filtered.rows;
  // The metric keys this source invented. Read once, outside the row loop.
  const custom = customMetricKeys(sources, sourceId);
  // This SOURCE's dictionary for this dimension. Passed rather than looked up by
  // dimension name: two sources may both carry a column called `city`, and
  // resolving by name alone would merge one's spellings into the other's.
  const stored = dimSourceGroups(sources, sourceId, dim);
  const inView = new Set((sources.effLIs || []).map(String));
  const buckets = {};
  // Gates are a property of the LINE ITEM, not of the row, so they are resolved
  // once per line and reused. Called per row instead, `isVcrEligible` walks that
  // line's whole daily map every time the line carries no VCR target — the
  // ordinary display case — which is O(rows × days): measured at 60 LIs × 90
  // days × 6 devices it cost 150 ms per rebuild against 6 ms cached, inside a
  // memo that re-fires on every filter change and column-header click. The
  // namebuilder path below hoists it for the same reason.
  const gateCache = new Map();
  const coefficientFact = coefficientFactReader(sources, sourceId, fieldErrors);
  const gatesFor = (lid, p) => {
    if (!gateCache.has(lid)) gateCache.set(lid, gatesOf(p, (sources.liDaily || {})[lid]));
    return gateCache.get(lid);
  };

  for (const r of rows) {
    if (!r) continue;
    const lid = String(r.line_item_id);
    if (!inView.has(lid)) continue;
    const p = (sources.liPlan || {})[lid];
    if (p && p.fs && p.fe && (r.date < p.fs || r.date > p.fe)) continue;
    if (range && (r.date < range.from || r.date > range.to)) continue;
    const raw = (r.dims && Object.prototype.hasOwnProperty.call(r.dims, dim)) ? r.dims[dim] : '';
    const g = groupValue(dim, raw, stored);
    // Blank and dropped values fold into one bucket rather than disappearing, so
    // the rows still add up to what the source reported. The wording matches the
    // Breakdown panel's row — two surfaces must not name the same thing twice.
    const unnamed = !!g.drop || String(raw == null ? '' : raw).trim() === '';
    const key = unnamed ? NO_VALUE_LABEL : g.label;
    // Marked where the fold DECIDES, not by reading the label back: a source whose values
    // literally include «No value» is a real segment until a blank row lands in it too.
    if (unnamed) leftovers.add(key);
    if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
      Object.defineProperty(buckets, key, {
        value: { ...ZERO_FLOW }, enumerable: true, writable: true, configurable: true,
      });
    }
    // Coefficient cost is derived from USD spend; only ordinary raw cost converts —
    // and only it takes the net ratio, for the same reason.
    const moneyPlan = sources.rawLiPlan?.[lid] || p;
    let fact = coefficientFact(r.metrics || {}, r, lid, p);
    // Primary conversions (spec §4 "Dimension sources"): a device or sheet row carries the
    // platform's conversions and names no action, so a line item whose conversions were rebuilt
    // adds none; while it is in view, the bucket it delivers into cannot say how many count, and
    // neither can the total. One the view keeps nothing of reads 0 and nulls nothing. A copy, so
    // the loaded row is never written.
    if (cvBlock && cvBlock.ids.has(lid)) {
      fact = { ...fact, cv: 0, pc: 0, pv: 0 };
      if (isInView(sources.liDaily, lid)) {
        cvBlock.totals = true;
        if (dayHasDelivery(fact)) cvBlock.labels.add(key);
      }
    }
    addFact(buckets[key], fact, gatesFor(lid, p),
      moneyPlan?.coef ? undefined : (sources.rate ?? null), moneyPlan?.k);
    // A source's OWN metrics, summed beside the canonical ones and never inside
    // them: they have no plan, no goal, no margin and no rate, so they enter no
    // basis and no derived ratio. addFact hardcodes every key it knows, which is
    // right for those — and is why a custom key summed there would have been
    // silently dropped and printed as a confident 0.
    for (const ck of custom) {
      buckets[key][ck] = (buckets[key][ck] || 0) + (Number((r.metrics || {})[ck]) || 0);
    }
  }
  return buckets;
}

/**
 * The line under a tile whose axis is a dimension source, or null for every other
 * widget.
 *
 * A device widget totals what the SOURCE reported, which is routinely a fraction
 * of what the pacing delivered — 39% on the largest pacing measured. Standing
 * beside a delivery KPI on the same dashboard, that reads as a broken tile, and
 * nothing on the widget says otherwise: coverage was stated only in the Breakdown
 * panel, which a user who builds widgets may never open.
 *
 * Measured over the widget's OWN window (`intersectWindow: false`), not over the
 * days both sides share. The tile prints every source row in the selected period,
 * lag included; a figure computed over a narrower window would describe a total
 * that is not on screen — the surfaces are allowed to answer different questions,
 * but each must answer for what it shows.
 */
export function dimSourceCoverageNote(axisKey, range, sources) {
  const ds = axisKey ? parseDimSourceKey(axisKey) : null;
  if (!ds || !sources) return null;
  const map = sources.dimSources;
  if (!map || !Object.prototype.hasOwnProperty.call(map, ds.sourceId)) return null;
  // Same gate as the buckets above: with nothing drawn there is no total to
  // state coverage of, and a coverage line under an empty tile reads as though
  // the tile were showing a measured zero.
  if (!breakdownServable(map, ds.sourceId, ds.dim)) return null;
  const entry = map[ds.sourceId];
  const { rows, reason } = filterSourceRows(sources, axisKey, range);
  if (reason || rows.length === 0) return null;

  const ids = (sources.effLIs || []).map(String);
  if (ids.length === 0) return null;
  const plans = sources.liPlan || {};
  const liDaily = sources.liDaily || {};
  const vcrEligibleIds = new Set(ids.filter((id) => isVcrEligible(plans[id], liDaily[id])));
  // Same unit the Breakdown tab measures in, so the two figures are comparable
  // even where their windows are not.
  const rt = domRateType(plans, ids);
  const unit = rt === 'CPC' ? 'cl' : rt === 'CPV' ? 'co' : 'im';
  const anchor = dimSourceUnitKey(unit, vcrEligibleIds.size > 0);
  const gated = anchor === 'coV';

  const deliveryByDate = {};
  for (const id of ids) {
    const dd = liDaily[id];
    if (!dd) continue;
    const p = plans[id];
    const eligible = !gated || vcrEligibleIds.has(id);
    for (const [d, v] of Object.entries(dd)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      deliveryByDate[d] = (deliveryByDate[d] || 0) + (gated ? (eligible ? (v.co || 0) : 0) : (v[unit] || 0));
    }
  }

  const result = aggregateDimSource(rows, {
    dimKey: ds.dim,
    groups: dimSourceGroups(sources, ds.sourceId, ds.dim),
    liIdSet: new Set(ids),
    anchor,
    deliveryByDate,
    range,
    liPlanForFlight: plans,
    vcrEligibleIds,
    intersectWindow: false,
  });
  // Nothing on either side in this window: the tile is empty and a coverage
  // sentence about nothing is worse than silence.
  if (!(result.coverage > 0) && !(result.notCovered > 0)) return null;
  // The same three statements the Breakdown line carries, in the same order:
  // what it covers, how far it disagrees, and whether these are the rows the
  // loader last read or the last it could read.
  const parts = [coverageSublabel(result)];
  const gap = discrepancyLabel(result);
  if (gap) parts.push(gap);
  const stale = stalenessLabel(entry, sources.asOf);
  if (stale) parts.push(stale);
  return parts.join(' · ');
}

/* ── the two AUX cuts (section-widget parity 2026-09-04) ──────────────────── */

/** The DSP's own creative, and the conversions mart's action. Each is a file beside the facts
 *  (`data.fetch_creatives` / `fetch_conversions`) rather than a `dim:value` split key, which is
 *  why they need a bucket source of their own — `liSplitDaily` has never carried either. The
 *  keys are the grammar's, judged there against the same closed list. */
export const AUX_CREATIVE = 'aux:creative';
export const AUX_CONVERSION = 'aux:conversion';
const isAuxDim = (key) => key === AUX_CREATIVE || key === AUX_CONVERSION;

/** An aux row in the engine's own field names. The two files carry the RAW fact spelling
 *  (`impressions`, `post_click_conversions`), the same one row-utils' addFact reads, where
 *  every aggregate this module sums is already short-named. */
function auxFact(dimKey, r) {
  if (dimKey === AUX_CONVERSION) {
    return { cv: +r.conversions || 0, pc: +r.post_click_conversions || 0, pv: +r.post_view_conversions || 0 };
  }
  return {
    im: +r.impressions || 0, cl: +r.clicks || 0, sp: +r.spend || 0, co: +r.completes || 0,
    cv: +r.conversions || 0, pc: +r.post_click_conversions || 0, pv: +r.post_view_conversions || 0,
    dc: +r.dynamic_cost || 0,
    // The six added 2026-09-08 (registry ADDED_DELIVERY_KEYS). A creatives row carries them
    // under the same column names, sparsely — absent on a display row, present on a video one.
    // Left out, a Creative-cut widget on `st`/`rc` reads a confident 0 and the «Others» row
    // takes the whole number. The conversion arm above carries none of them by design.
    st: +r.starts || 0, q1: +r.first_quartiles || 0, q2: +r.midpoints || 0, q3: +r.third_quartiles || 0,
    rc: +r.reach || 0, lc: +r.link_clicks || 0,
  };
}

/** …and what the file calls it, or '' where it names it nothing. The legacy panel's own rule:
 *  a DSP creative falls back to its id where the export carries no name (Search and DOOH rows
 *  do). The caller folds an unnamed row into the «Unclassified» bucket every other cut in this
 *  file mints — HERE, so the fold is one decision and the leftover mark follows it. */
function auxRaw(dimKey, r) {
  if (dimKey === AUX_CONVERSION) {
    return (r.conversion_action && String(r.conversion_action).trim()) || '';
  }
  return (r.creative && String(r.creative).trim()) || r.creative_id || '';
}

/** …and what it is SHOWN as: the pacing's display name for that value (spec
 *  docs/2026-09-24-display-names.md), else the value itself. The one place a Creative or
 *  Conversion Action row gets its name, so two values with one display name are one bucket,
 *  and a kept conversion row lands on its creative's renamed row (auxBuckets, below). The
 *  rows themselves stay raw: Primary conversions and CM360 matching read them. */
function auxLabel(dimKey, r, labels) {
  const raw = auxRaw(dimKey, r);
  const map = labels ? labels[dimKey === AUX_CONVERSION ? 'conversion_action' : 'creative'] : null;
  return raw && map ? ValueLabels.labelOf(map, raw) : raw;
}

/** `leftovers` is the caller's Set, as in `dimSourceBuckets`. `cvOnlyOut`, a Set the caller hands
 *  on an operative Creative cut, receives the buckets only conversion rows reached (spec §4
 *  "Conversion-only rows and days"). */
function auxBuckets(sources, dimKey, range, leftovers, fieldErrors, cvBlock = null, actionLis = null, cvOnlyOut = null) {
  const { rows, reason } = filterSourceRows(sources, dimKey, range);
  if (reason || rows.length === 0) return {};
  const inView = new Set((sources.effLIs || []).map(String));
  if (inView.size === 0) return {};
  const buckets = {};
  // Gates are a property of the LINE, not of the row — dimSourceBuckets' own cache, for its
  // own reason: `isVcrEligible` walks a line's whole daily map, and these files are per row.
  const gateCache = new Map();
  const coefficientFact = coefficientFactReader(sources, null, fieldErrors);
  const gatesFor = (lid, p) => {
    if (!gateCache.has(lid)) gateCache.set(lid, gatesOf(p, (sources.liDaily || {})[lid]));
    return gateCache.get(lid);
  };
  const ensure = (key) => {
    if (!hasOwn(buckets, key)) {
      Object.defineProperty(buckets, key, {
        value: { ...ZERO_FLOW }, enumerable: true, writable: true, configurable: true,
      });
    }
  };
  // Primary conversions on the Creative cut (spec §4 "Which rows count"): a line item whose
  // conversions were rebuilt adds none from its creative rows. A primary one in view takes the
  // chosen rows its day map holds (cvKeptOf: the rows the view's filters kept), bucketed by
  // creative below, so «Others» (line total minus buckets) never eats into another line item's
  // conversions; an unavailable one in view makes the buckets it delivers into, and the total,
  // unknown. Only when dimBuckets handed a block, which it does on an operative Creative cut.
  const dayState = cvBlock && dimKey === AUX_CREATIVE ? cvStateOf(sources.liDaily) : null;
  for (const r of rows) {
    if (!r) continue;
    const lid = String(r.line_item_id);
    if (!inView.has(lid)) continue;
    const p = (sources.liPlan || {})[lid];
    if (p && p.fs && p.fe && (r.date < p.fs || r.date > p.fe)) continue;
    if (range && (r.date < range.from || r.date > range.to)) continue;
    const named = auxLabel(dimKey, r, sources.valueLabels);
    const key = named === '' ? UNCLASSIFIED_LABEL : named;
    if (named === '') leftovers.add(key);
    // An action row records which line items carry it, and under which raw actions, for the
    // «primary» chip (Task 8; a display name can gather several raw actions).
    if (actionLis && named !== '') {
      if (!actionLis.has(key)) actionLis.set(key, new Map());
      const byLi = actionLis.get(key);
      if (!byLi.has(lid)) byLi.set(lid, new Set());
      byLi.get(lid).add(auxRaw(dimKey, r));
    }
    ensure(key);
    const fact = auxFact(dimKey, r);
    const s = dayState ? dayState[lid] : null;
    const rebuilt = !!s && s.cv !== CV.PLATFORM;
    if (rebuilt) { fact.cv = 0; fact.pc = 0; fact.pv = 0; }
    // Conversions carry no money; creative cost follows the same per-row contract
    // as facts, including coefficient margins, ordinary currency conversion and the
    // net ratio that rides behind it.
    const moneyPlan = sources.rawLiPlan?.[lid] || p;
    const summed = dimKey === AUX_CREATIVE ? coefficientFact(fact, r, lid, p) : fact;
    addFact(buckets[key], summed, gatesFor(lid, p),
      dimKey === AUX_CREATIVE && !moneyPlan?.coef ? (sources.rate ?? null) : undefined, moneyPlan?.k);
    if (rebuilt && s.cv === CV.UNAVAILABLE && s.inView !== false && dayHasDelivery(summed)) cvBlock.labels.add(key);
  }
  if (!dayState) return buckets;
  // A bucket a creative row reached is a fact. One that only the kept conversion rows below reach
  // (a creative with no row in the window, or rows naming no creative) is a conversion-only row.
  const factLabels = new Set(Object.keys(buckets));
  const kept = cvKeptOf(sources.liDaily) || {};
  for (const lid of inView) {
    const s = dayState[lid];
    if (!s || s.cv === CV.PLATFORM || s.inView === false) continue;
    if (s.cv === CV.UNAVAILABLE) { cvBlock.ids.add(lid); continue; }
    const p = (sources.liPlan || {})[lid];
    for (const e of kept[lid] || []) {
      if (p && p.fs && p.fe && (e.date < p.fs || e.date > p.fe)) continue;
      if (range && (e.date < range.from || e.date > range.to)) continue;
      const named = auxLabel(AUX_CREATIVE, e, sources.valueLabels);
      const key = named === '' ? UNCLASSIFIED_LABEL : named;
      if (named === '') leftovers.add(key);
      ensure(key);
      addFact(buckets[key], auxFact(AUX_CONVERSION, e), gatesFor(lid, p));
    }
  }
  if (cvOnlyOut) for (const key of Object.keys(buckets)) if (!factLabels.has(key)) cvOnlyOut.add(key);
  return buckets;
}

/* ── the untagged remainder (section-widget parity 2026-09-04) ─────────────── */

/** What the legacy Breakdown panel calls the remainder row. */
export const RESIDUAL_LABEL = 'Others';
/**
 * …and the two buckets a CUT mints for delivery it could not name: a split value that is
 * blank or the `-` placeholder production carries, a DSP row with no creative and no id, and
 * a dimension source's blank or dropped value.
 *
 * They are LEFTOVERS, not segments anybody chose, and the legacy panel treats all of them the
 * same way (`RESIDUAL_KEYS`, Breakdown.jsx:71): they rank below the real values, render grey
 * at 0.6 opacity and refuse a click, because there is no fact to filter by — `readDimValue`
 * reads a `-` fact as '', never as the display label, so the pair would match nothing and
 * scope the whole dashboard to zero delivery.
 *
 * They stay IN the best/worst comparison, which is the panel's own split (its :80): these two
 * are aggregated from real facts, so their rates are measured and belong on screen. Only the
 * remainder is held out of it.
 */
export const UNCLASSIFIED_LABEL = 'Unclassified';
export const NO_VALUE_LABEL = 'No value';

/**
 * Where one row sorts among the leftovers: a real value, then «Unclassified» / «No value»,
 * then the untagged remainder — the legacy panel's own three ranks (Breakdown.jsx:536).
 *
 * Exported because TWO comparators need it and only one of them can call the engine: the
 * authored sort runs here, and the VIEWER's header click re-orders the rows the renderer
 * already holds (`sortReportRows`). One function, so a header click cannot float a leftover
 * to the top of a table the engine sank it in.
 */
export const leftoverRank = (r) => (r.residual ? 2 : r.leftover ? 1 : 0);
/** The volume fields a remainder is judged MATERIAL on. A sliver is rounding, not a segment:
 *  the legacy panel uses the same 1% floor on the one unit it computes (Breakdown.jsx:523). */
const RESIDUAL_ANCHORS = ['im', 'cl', 'co', 'sp'];
/** …and while primary conversions are operative, conversions too (spec §4 "«Others» keeps
 *  conversions"): an «Others» holding conversions tagged '' is kept, not dropped with them. */
const RESIDUAL_ANCHORS_CV = [...RESIDUAL_ANCHORS, 'cv'];

/**
 * Delivery in this window that carries NO value of this dimension — the legacy panel's
 * «Others» row, and the single largest number the v2 tile used to leave out: on a Geo cut of
 * `mock-multi` it is 81% of the clicks, so every share beside it was a share of the tagged
 * fifth.
 *
 * It is the LINE totals minus the tagged buckets, over the same line set, the same range and
 * the same flight clamp, PER FIELD — so the row's own CTR, CPM and VCR are measured numbers
 * rather than the em dashes the legacy row prints (it computes one unit and dashes the rest).
 * Both sides run through `addFact` with the same gates, which is what makes the subtraction
 * exact: `imV`/`coV` come out gated on both, so the VCR beside it is the product's VCR.
 *
 * A negative field is clamped to 0 — splits that over-count a day would otherwise draw a
 * negative slice — and the row is dropped entirely unless it is at least 1% of one volume.
 */
function residualBucket(sources, range, tagged) {
  const line = { ...ZERO_FLOW };
  for (const id of sources.effLIs) {
    const p = sources.liPlan[id];
    const dd = (sources.liDaily || {})[id] || {};
    const g = gatesOf(p, dd);
    for (const [d, v] of Object.entries(dd)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      addFact(line, v, g);
    }
  }
  const rest = { ...ZERO_FLOW };
  for (const k of Object.keys(ZERO_FLOW)) {
    const diff = (line[k] || 0) - (tagged[k] || 0);
    rest[k] = diff > 0 ? diff : 0;
  }
  const anchors = cvOperative(sources) ? RESIDUAL_ANCHORS_CV : RESIDUAL_ANCHORS;
  const material = anchors.some((k) => line[k] > 0 && rest[k] / line[k] >= 0.01);
  return material ? rest : null;
}

/**
 * One cut's buckets, plus the two marks a leftover row needs.
 *
 * `leftovers` is a Set of the keys this cut minted for delivery it could not NAME, filled
 * where each fold is decided rather than by reading a label back — a dimension whose values
 * literally include «No value» keeps an ordinary row until a blank one lands in it. The
 * remainder carries its own `residual` key beside it, because it is the further of the two
 * from being a value and the surfaces rank and paint them one step apart.
 */
function dimBuckets(sources, dimKey, range, wantResidual = false) {
  const ds = parseDimSourceKey(dimKey);
  const leftovers = new Set();
  const fieldErrors = {};
  // label → { value: the RAW dim value (null for a fold), byLi: id → delivered volume }.
  // Empty on every cut that cannot carry a declared plan; see the namebuilder branch below.
  const origins = new Map();
  // Before the residual calculation too: an unanswered cut must not turn into
  // one large Others row containing the delivery the source could not filter.
  if (sourceFilterReason(sources, dimKey, range)) return { buckets: {}, residual: null, leftovers, origins };
  // A dimension SOURCE states its own coverage (`dimSourceCoverageNote`), which is the same
  // fact a remainder row would be — measured over the days both sides share. Two answers to
  // one question is what the legacy panel refuses here too (Breakdown.jsx:518).
  if (ds) {
    const cvBlock = newCvBlock(cvRebuiltIds(sources));
    const buckets = dimSourceBuckets(sources, ds.sourceId, ds.dim, range, leftovers, fieldErrors, cvBlock);
    return { buckets, residual: null, leftovers, fieldErrors, origins, cvBlock };
  }
  // Channel is a property of the LINE ITEM, not a split of the facts. Every
  // other dim here is a `dim:value` key in liSplitDaily; `ch` lives on the plan
  // (normalize.js:97) and has therefore never been chartable or groupable
  // anywhere, though the line-item search has always matched on it.
  // Every line has one, so its buckets partition the delivery and a remainder is always 0.
  if (dimKey === CHANNEL_DIM) {
    return { buckets: channelBuckets(sources, range), residual: null, leftovers, origins, cvBlock: channelCvBlock(sources, range) };
  }
  let buckets;
  let cvBlock = null;
  let cvOnly = null;   // labels of conversion-only rows (namebuilder and Creative cuts, operative only)
  let quiet = null;    // labels with no day in the window at all (namebuilder cut, operative only)
  if (isAuxDim(dimKey)) {
    // An empty block that auxBuckets fills: a Creative cut whose chosen line items were all
    // answered keeps its numbers and its total (the post-branch rule below reads it unchanged).
    cvBlock = dimKey === AUX_CREATIVE && cvOperative(sources)
      ? { ids: new Set(), labels: new Set(), residual: false, totals: false }
      : null;
    const actionLis = dimKey === AUX_CONVERSION && cvOperative(sources) ? new Map() : null;
    // …and the Creative buckets only conversion rows reached: conversion-only rows (spec §4).
    const creativeCvOnly = cvBlock ? new Set() : null;
    buckets = auxBuckets(sources, dimKey, range, leftovers, fieldErrors, cvBlock, actionLis, creativeCvOnly);
    if (creativeCvOnly && creativeCvOnly.size) cvOnly = creativeCvOnly;
    // Conversions do not sum to a delivery total — the mart counts actions, not impressions —
    // so there is nothing for a remainder to be the rest OF. The legacy panel skips it there
    // for the same reason and computes one for the DSP creatives beside it.
    if (dimKey === AUX_CONVERSION) return { buckets, residual: null, leftovers, origins, actionLis };
  } else {
    const prefix = dimKey + ':';
    buckets = {};
    cvBlock = newCvBlock(splitCvIds(sources, dimKey));
    // Bucket-days the per-dimension overlay made from a conversion alone (spec §4 "Conversion-only
    // rows and days"). A conversion-only row has conversions and no delivery in the window: a
    // bucket with no day in the window from delivery, and one there from a conversion, or one
    // made by conversions alone. A value delivered only outside the window, with no conversion
    // in it, stays today's zero row.
    const cvOnlyDays = cvOperative(sources) ? cvOnlyBucketDaysOf(sources.liSplitDaily) : null;
    const factLabels = cvOnlyDays ? new Set() : null;   // a delivery day in the window
    const cvLabels = cvOnlyDays ? new Set() : null;     // a conversion-only day in the window
    const deliveredLabels = cvOnlyDays ? new Set() : null;   // a delivery day on any date
    // Who delivered into each bucket, and how much. Only the namebuilder cut can carry a
    // declared plan, so only it records this — the answer to «does this row's plan cover
    // the delivery standing beside it» (plan metrics on dim rows, 2026-09-12). The unit is
    // the pacing's dominant buy unit, the one the Breakdown panel already measures in.
    const anchor = BUY_UNIT_OF_RATE[domRateType(sources.liPlan || {}, sources.effLIs || [])] || 'im';
    for (const id of sources.effLIs) {
      const p = sources.liPlan[id];
      const sd = (sources.liSplitDaily || {})[id] || {};
      const g = gatesOf(p, (sources.liDaily || {})[id]);
      // This line item's conversions cannot be placed in a bucket of this dimension (spec §4).
      const blocks = !!cvBlock && cvBlock.ids.has(String(id));
      for (const [sk, dd] of Object.entries(sd)) {
        if (!sk.startsWith(prefix)) continue;
        const rawVal = sk.slice(prefix.length).trim();
        // The `-` placeholder is what production writes for a split with no value
        // (metric-catalog.js:802), and a blank is the other spelling of it.
        const unnamed = !rawVal || rawVal === '-';
        const key = unnamed ? UNCLASSIFIED_LABEL : rawVal;
        if (unnamed) leftovers.add(key);
        if (!buckets[key]) buckets[key] = { ...ZERO_FLOW };
        // Keyed by the label, but carrying the RAW value: a plan is matched on what the
        // configuration declared, never on what the table prints. A dimension whose values
        // literally include «Others» would otherwise hand its plan to the remainder row.
        if (!origins.has(key)) origins.set(key, { value: unnamed ? null : rawVal, byLi: new Map() });
        const org = origins.get(key);
        const cvOnlyHere = cvOnlyDays && cvOnlyDays[id] ? cvOnlyDays[id][sk] : null;
        if (deliveredLabels && !deliveredLabels.has(key)
          && (!cvOnlyHere || Object.keys(dd).some((d) => !cvOnlyHere.has(d)))) deliveredLabels.add(key);
        for (const [d, v] of Object.entries(dd)) {
          if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
          if (range && (d < range.from || d > range.to)) continue;
          addFact(buckets[key], v, g);
          // A blocked line item makes a bucket unknown only on a day it delivers there (spec §4).
          if (blocks && dayHasDelivery(v)) cvBlock.labels.add(key);
          if (factLabels) (cvOnlyHere && cvOnlyHere.has(d) ? cvLabels : factLabels).add(key);
          // `im`: the line's impressions INSIDE this value, the weight of its CTR target on
          // this row (owner decision 2026-09-23) — the same facts the row's CTR counts.
          const prev = org.byLi.get(id) || { u: 0, sp: 0, im: 0 };
          prev.u += Number(v[anchor]) || 0;
          prev.sp += Number(v.sp) || 0;
          prev.im += Number(v.im) || 0;
          org.byLi.set(id, prev);
        }
      }
    }
    if (factLabels) {
      const only = [];
      const none = [];
      for (const label of Object.keys(buckets)) {
        if (factLabels.has(label)) continue;
        if (cvLabels.has(label) || !deliveredLabels.has(label)) only.push(label);
        if (!cvLabels.has(label)) none.push(label);
      }
      if (only.length) cvOnly = new Set(only);
      if (none.length) quiet = new Set(none);
    }
  }
  // The remainder is line totals minus the buckets, so a line item that cannot be placed
  // reaches it (and the totals) whenever its flight reaches the window.
  if (cvBlock) {
    cvBlock.residual = [...cvBlock.ids].some((id) => planReaches(sources.liPlan && sources.liPlan[id], range));
    cvBlock.totals = cvBlock.residual || cvBlock.labels.size > 0;
  }
  if (!wantResidual) return { buckets, residual: null, leftovers, fieldErrors, origins, cvBlock, cvOnly, quiet };
  const tagged = Object.values(buckets).reduce((t, b) => (addRowSums(t, b), t), { ...ZERO_FLOW });
  const rest = residualBucket(sources, range, tagged);
  if (!rest) return { buckets, residual: null, leftovers, fieldErrors, origins, cvBlock, cvOnly, quiet };
  // A dimension whose values literally include «Others» would otherwise absorb the remainder
  // into a real segment. The suffix loop terminates on the first free name and is the only
  // place this label is decided, so the model's «which row is the remainder» stays an identity
  // check rather than a guess.
  let key = RESIDUAL_LABEL;
  while (hasOwn(buckets, key)) key += ' (untagged)';
  Object.defineProperty(buckets, key, {
    value: rest, enumerable: true, writable: true, configurable: true,
  });
  // The remainder counts as DELIVERY the plan does not cover, which is what makes the Totals
  // mark honest: the facts total includes it, so the plan standing under them is short by it
  // too. It is line totals minus the tagged buckets, so it has no per-line attribution —
  // hence the one synthetic entry under a key no line item can have. `value: null` keeps it
  // out of every declaration match, so it can only ever land in the denominator.
  if (origins.size > 0) {
    const anchor = BUY_UNIT_OF_RATE[domRateType(sources.liPlan || {}, sources.effLIs || [])] || 'im';
    origins.set(key, {
      value: null,
      byLi: new Map([[RESIDUAL_ORIGIN, { u: Number(rest[anchor]) || 0, sp: Number(rest.sp) || 0, im: Number(rest.im) || 0 }]]),
    });
  }
  return { buckets, residual: key, leftovers, fieldErrors, origins, cvBlock, cvOnly, quiet };
}

/* ── the per-row plan of a declared dimension (2026-09-12) ────────────────── */

/** What a row of a declared dimension reads when its own value was never declared: every
 *  plan key present and null, so a cell prints an em dash rather than a confident 0. */
const NO_ROW_PLAN = Object.freeze({ scalars: DIM_PLAN_NULLS, exp: DIM_EXPECTED_NULLS, partial: null });

/**
 * What a row that declared NOTHING publishes to the second pass (CM360 in formulas,
 * 2026-09-16 §2.4), and what every row of a cut with no plan at all publishes.
 *
 * One frozen object, shared and exported: `report-render.js`'s `cmRowPlanOf` returns it per
 * row per fed column, and its callers read `.scalars` and `.unplanned` off it — never an
 * identity check — so a fresh `{ scalars, unplanned }` per read would just be an allocation on
 * every cell of every render, with nothing to buy it. Its scalars are the same explicit nulls
 * the plan CELLS read, so «unplanned» and «no target» can never be two different answers here.
 */
export const ABSENT_ROW_PLAN = Object.freeze({ scalars: DIM_PLAN_NULLS, unplanned: true });

/** One row's plan as the second pass reads it: the scalars `dimRowPlans` already built — the
 *  same object the plan cells were computed from, never a second weighting of the same leaf
 *  plans — plus whether the row declared anything at all. */
const publishedRowPlan = (rp) => (rp && rp.keys && rp.keys.length
  ? { scalars: rp.scalars, unplanned: false }
  : ABSENT_ROW_PLAN);

/**
 * One answer per key SET, by the set's own identity.
 *
 * A narrowed table's Totals row and a cm-bearing formula standing in it ask for the same
 * subset one line apart — `report-render.js`'s `retotal` runs the engine's own re-total and
 * then `cmPlan.subset` on the same `keys` — and re-weighting a dimension cut's leaf plans is
 * the one expensive thing on that path (§2.4: ONE `campaignScalars` per call). Keyed by
 * identity rather than by contents because the renderer builds the Set once per call
 * (`ReportTable.jsx`: `model.retotal(new Set(...))`) and never mutates it afterwards.
 *
 * «Nothing cached yet» is a private Symbol rather than null, because null is a legal thing to
 * be called with — and a null marker would hand that first caller an empty cache instead of
 * an answer.
 */
const MEMO_UNSET = Symbol('onceForKeys.unset');
function onceForKeys(fn) {
  let lastKeys = MEMO_UNSET;
  let last = null;
  return (keys) => {
    if (lastKeys !== keys) { lastKeys = keys; last = fn(keys); }
    return last;
  };
}

/**
 * Does this row's plan cover the delivery standing in it?
 *
 * The row aggregates every line item that delivered a value of the dimension; the plan
 * exists only on the lines that declared it. On a pacing where one line of three carries the
 * containers — the case this feature was built for — an unmarked row invites the reader to
 * compare three lines of fact against one line of plan.
 *
 * Measured in the pacing's dominant buy unit, falling back to spend where the row bought
 * nothing in that unit. It counts LINES, not dates: a container narrower than its line's
 * flight also covers part of the row, and that second axis is deliberately not folded in
 * here — the mark says «lines» and means it.
 */
function planCoverageOf(org, declaredIds, sources) {
  let total = 0, covered = 0, totalSp = 0, coveredSp = 0;
  let delivering = 0, declaredDelivering = 0;
  const missing = [];
  for (const [id, v] of org.byLi) {
    if (!(v.u > 0 || v.sp > 0)) continue;
    delivering++;
    total += v.u; totalSp += v.sp;
    if (declaredIds.has(String(id))) {
      declaredDelivering++;
      covered += v.u; coveredSp += v.sp;
    } else {
      missing.push(sources.liNames?.[id] || `LI ${id}`);
    }
  }
  // The trigger is the LINES, not the ratio. A row is short exactly when something delivered
  // into it from a line that declared nothing, and that is true whatever unit the two sides
  // happen to buy in. Measuring it by volume instead missed two real cases: a declaring CPM
  // line beside a CPC line on a click-dominant pacing (the declaring side contributes 0
  // clicks, so the covered volume is 0), and a declaring line that delivered nothing at all
  // in this window. Both print a plan the delivery beside it does not answer to.
  //
  // Called only where the row HAS a plan — the caller returns early otherwise — so a row with
  // no declaration at all still carries no mark. Its em dash already says there is no target.
  if (delivering === 0 || missing.length === 0) return null;
  const basis = total > 0 ? total : totalSp;
  const hit = total > 0 ? covered : coveredSp;
  // …and the RATIO is the size of the gap, which needs a unit both sides share. Where they
  // do not, the mark still stands and says only what it can count: the lines.
  const ratio = basis > 0 ? hit / basis : null;
  // A hair under 1 is float noise on summed daily figures, not a gap worth a warning.
  if (ratio != null && ratio >= 0.9995) return null;
  return { ratio, lines: declaredDelivering, ofLines: delivering, missing };
}

/**
 * The plan behind every row of one dimension cut, or null where the dimension declares
 * nothing. Built ONCE per cut: `collectDimPlans` walks the containers a single time and this
 * loop is a lookup per row, which is what keeps it out of dimBuckets' hot path.
 */
function dimRowPlans(sources, dimKey, cut, range, bounds) {
  // Not a namebuilder dimension → no plan exists and none is named: `null` leaves the rows
  // exactly as they were before this feature, scalars and all.
  if (!dimIsNamebuilder(dimKey)) return null;
  const decl = dimPlanEligible(sources, dimKey)
    ? collectDimPlans(sources.rawLiPlan || sources.liPlan, dimKey, sources.periodKey || null)
    : new Map();
  const inView = new Set((sources.effLIs || []).map(String));
  const out = new Map();
  // Every leaf plan the cut actually stands on, keyed «value|line» — one campaignScalars
  // call over the lot is the totals row. A plain sum of the row scalars would average the
  // rate targets instead of weighting them.
  const allPlans = {};
  const allKeys = [];
  // …and each key's delivered impressions inside its value: the weight of that leaf plan's
  // CTR target wherever the key is weighed — its row, the Totals, a kept subset, a fold.
  const imByKey = new Map();
  const allExp = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
  let totalVol = 0, coveredVol = 0, totalSpend = 0, coveredSpend = 0;
  for (const [label, org] of cut.origins) {
    // A fold («Unclassified», «No value») and the untagged remainder are not values anything
    // declared. Their plan cells stay em dashes, and they carry no mark — they are already
    // grey for a reason of their own, and a second grey meaning would read as a third.
    const entry = org.value == null ? null : decl.get(normDimValue(org.value));
    const ids = entry ? entry.liIds.filter((id) => inView.has(String(id))) : [];
    const declaredIds = new Set(ids.map(String));
    for (const [id, v] of org.byLi) {
      totalVol += v.u; totalSpend += v.sp;
      if (declaredIds.has(String(id))) { coveredVol += v.u; coveredSpend += v.sp; }
    }
    if (ids.length === 0) { out.set(label, NO_ROW_PLAN); continue; }
    const planMap = {};
    entry.liIds.forEach((id, i) => { if (inView.has(String(id))) planMap[id] = entry.plans[i]; });
    // A line's delivery INSIDE this value (dimBuckets' `byLi`), by the line id as a string —
    // the declaration and the facts may spell one id as a number and a string.
    const imInValue = new Map([...org.byLi].map(([id, v]) => [String(id), Number(v.im) || 0]));
    const imOf = (id) => imInValue.get(String(id)) || 0;
    // campaignScalars, not a hand-rolled sum: margin weights by budget, the rate targets by
    // plan unit (ctrT by this value's delivery), a CPC line's units go to planClicks, and a
    // target nobody set answers null rather than 0. Every one of those laws already lives
    // there, and a per-dim copy of them would disagree with the line-item rows in the widget.
    const scalars = {
      ...campaignScalars(planMap, ids, sources.asOf, sources.flightStart, sources.flightEnd, range,
        false, planWindowOf(sources, range), imOf),
    };
    const exp = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
    if (bounds.from && bounds.to && bounds.from <= bounds.to) {
      for (const id of ids) {
        const e = expectedDeltas(planMap[id], bounds.from, bounds.to);
        exp.expIm += e.expIm; exp.expCo += e.expCo; exp.expCl += e.expCl;
        exp.expVw += e.expVw; exp.imprExpected += e.imprExpected;
      }
    }
    for (const k of Object.keys(allExp)) allExp[k] += exp[k];
    const keys = [];
    for (const id of ids) {
      // A synthetic address, because campaignScalars reads its plans BY KEY and one line can
      // declare several values, so the line id alone is not unique. An ordinal rather than
      // «value + separator + line»: a dimension value is arbitrary text and could carry any
      // separator this file might pick.
      const key = `${allKeys.length}:${id}`;
      allPlans[key] = planMap[id];
      imByKey.set(key, imOf(id));
      allKeys.push(key);
      keys.push(key);
    }
    out.set(label, { scalars, partial: planCoverageOf(org, declaredIds, sources), keys, exp });
  }

  // The Totals row. Its facts are the whole pacing including the untagged remainder
  // (the canon a few lines down), so its plan is short whenever anything delivered outside
  // a declaration — and it says so with the same mark the rows use, one level up, where
  // there is no row left to carry the warning.
  const basis = totalVol > 0 ? totalVol : totalSpend;
  const hit = totalVol > 0 ? coveredVol : coveredSpend;
  const ratio = basis > 0 ? hit / basis : 1;
  const totals = allKeys.length === 0 ? NO_ROW_PLAN : {
    scalars: campaignScalars(allPlans, allKeys, sources.asOf, sources.flightStart, sources.flightEnd, range,
      false, planWindowOf(sources, range), keyImprOf(imByKey)),
    exp: allExp,
    // Symmetrical with a row, so the Totals cell can be silenced by the same test: nothing
    // declared anywhere means an em dash there too, not the 0 a formula would otherwise print
    // under a column of em dashes.
    keys: allKeys,
    // RATIO only. There is no single row to count lines over here — the shortfall is spread
    // across every value nobody declared and every line that declared none — so the totals
    // mark says how much of the delivery below it the plan covers, and nothing it cannot know.
    partial: ratio >= 0.9995 ? null : { ratio },
  };
  return { byLabel: out, totals, plans: allPlans, imByKey };
}

/** A plan key's delivered impressions inside its value (dimRowPlans' `imByKey`), as the
 *  `imprOf` campaignScalars weighs ctrT by. */
const keyImprOf = (imByKey) => (key) => (imByKey && imByKey.get(key)) || 0;

/** A dim bucket already carries the expected keys as 0 (ZERO_FLOW), and `fieldValue` reads the
 *  sums before the scalars — so the row's own expected curve, or its absence, has to be
 *  written into a COPY of the bucket. The original is what the totals re-sum, untouched. */
const withRowExpected = (sums, rp) => (rp ? { ...sums, ...rp.exp } : sums);

/**
 * Does this column's number come from the plan?
 *
 * Not only a bare `planImpr`: the cell a partial plan distorts WORST is an expression that
 * divides delivery by it — `im / expIm` over three line items of fact and one line item of
 * expected prints 300%. So the AST is walked, not just the field name.
 */
function readsPlanField(c) { return columnReads(c, DIM_PLAN_FIELDS); }

/** Does this column read any of `fields` — as its bare field, or anywhere inside its AST? */
function columnReads(c, fields) {
  if (!c) return false;
  if (c.kind === 'field') return fields.has(c.field);
  if (c.kind !== 'expr') return false;
  let found = false;
  (function walk(n) {
    if (found || !n) return;
    if (n.t === 'id') { if (fields.has(n.name)) found = true; return; }
    if (n.t === 'call') n.args.forEach(walk);
    else if (n.t === 'bin' || n.t === 'cmp') { walk(n.l); walk(n.r); }
    else if (n.t === 'neg') walk(n.e);
  })(c.ast);
  return found;
}

/** What a subset of DATES cannot total: the window's expected is a delta over the whole
 *  window, so `retotal` answers nothing for a column that reads one of these on a date
 *  grain. A plan scalar is a constant of the window — every row prints the same budget — and
 *  passes through untouched, as the rows above the Totals do. */
const CALENDAR_EXPECTED_FIELDS = FIELDS_EXPECTED;

/** The rates whose population is EMPTY in these sums on the campaign ('agg') basis — ctr
 *  over every line's impressions, cpm over the non-click-bought lines', vcr over the eligible
 *  ones, and so on (ratesFromSums). Over the whole campaign an empty population prints 0 by
 *  that canon; over a SUBSET the search box kept it must not, because the rows above it print
 *  their own entity rates and a 0.00% standing over a 4.00% row is a number nothing adds up to.
 *  Since ctr counts every line (owner decision 2026-09-23), a subset of click-bought rows
 *  prints their CTR; only their cpm stays silent. */
function silentAggRates(sums) {
  const out = new Set();
  if (!(sums.im > 0)) out.add('ctr');
  if (!(sums.imNC > 0)) out.add('cpm');
  if (!(sums.imV > 0 && sums.coV > 0)) out.add('vcr');
  if (!(sums.imA > 0)) out.add('acr');
  if (!(sums.cl > 0)) out.add('cpc');
  if (!(sums.cpvCo > 0)) out.add('cpv');
  return out;
}

/**
 * One row's identity, on every grain: the date, the line, both, or the bucket label. The
 * renderer keys its rows by it (report-render.js imports it) and `retotal` reads the same
 * keys back, so the two can never disagree about which row is which.
 */
export function tableRowKey(r, rowType) {
  if (rowType === 'date') return String(r.date);
  if (rowType === 'li') return String(r.liId);
  if (rowType === 'dateLi') return `${r.date}|${r.liId}`;
  return String(r.label);
}

/** The plan behind a FOLD — «Other values», several dimension values in one bar. Weighted
 *  over the union of their leaf plans, never a sum of their row scalars: averaging target
 *  margins is the mistake campaignScalars exists to prevent. */
function foldPlanScalars(dimPlans, members, sources, range) {
  const keys = [];
  const exp = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
  for (const m of members) {
    if (!m || !m.keys || m.keys.length === 0) continue;
    for (const k of m.keys) keys.push(k);
    for (const k of Object.keys(exp)) exp[k] += Number(m.exp?.[k]) || 0;
  }
  if (keys.length === 0) return { scalars: DIM_PLAN_NULLS, exp: DIM_EXPECTED_NULLS };
  return {
    scalars: campaignScalars(dimPlans.plans, keys, sources.asOf, sources.flightStart, sources.flightEnd, range, true,
      planWindowOf(sources, range), keyImprOf(dimPlans.imByKey)),
    exp,
  };
}

/** The plan slot for one row, defaulting to «declared nothing» — the residual row is minted
 *  after the origins map is filled, and every non-namebuilder cut has no origins at all. */
const rowPlanOf = (rowPlans, label) => (
  rowPlans ? (rowPlans.byLabel.get(label) || NO_ROW_PLAN) : null
);

/** The pacing's own channel, as an axis. Buckets whole line items rather than
 *  splits, which is why it cannot ride the generic path above. */
export const CHANNEL_DIM = 'channel';

function channelBuckets(sources, range) {
  const buckets = {};
  for (const id of sources.effLIs) {
    const p = sources.liPlan[id];
    const key = (p && p.ch) || 'Unknown';
    if (!buckets[key]) {
      Object.defineProperty(buckets, key, {
        value: { ...ZERO_FLOW }, enumerable: true, writable: true, configurable: true,
      });
    }
    const g = gatesOf(p, (sources.liDaily || {})[id]);
    const days = (sources.liDaily || {})[id] || {};
    for (const [d, v] of Object.entries(days)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      addFact(buckets[key], v, g);
    }
  }
  return buckets;
}

/* ── table model ──────────────────────────────────────────────────────────── */

export function buildTabularModel(request, range, sources) {
  const highlightSafe = !!request?.highlightSafe;
  const evalSeries = highlightSafe ? evaluateHighlightSeries : evaluateSeries;
  const evalOne = highlightSafe ? evaluateHighlightOne : evaluateOne;
  const readField = highlightSafe ? (name, sums, scalars, fields, basis) => highlightFieldValue(name, sums, scalars, basis) : fieldValue;
  const grain = request && request.grain ? request.grain : { type: 'date' };
  const isDim = grain.type === 'dim';
  const contextKind = grain.type === 'date' || grain.type === 'dateLi' ? 'ts' : 'agg';
  const fieldSet = isDim
    ? dimFieldSetFor(sources, parseDimSourceKey(grain.key)?.sourceId, grain.key)
    : (contextKind === 'ts' ? TS_FIELDS : AGG_FIELDS);
  const cols = compileColumns(request.columns, contextKind, fieldSet).map((column) => {
    if (!highlightSafe || column.kind === 'error') return column;
    const resolved = column.kind === 'field' ? { kind: 'metric', metric: column.field }
      : { kind: 'formula', expr: column.source.expr };
    const error = unavailableMetric(resolved, sources, isDim ? grain.key : null);
    return error ? { ...column, kind: 'error', error } : column;
  });
  const colErrors = Object.fromEntries(cols.filter((c) => c.kind === 'error').map((c) => [c.id, c.error]));
  // Each line's impressions in this window, the CTR target's weight; the li rows below hand
  // theirs over as they sum them, so the facts are walked once (lineImpr).
  const impr = lineImpr(sources, range);
  const campScalars = campaignScalars(sources.liPlan, sources.effLIs, sources.asOf, sources.flightStart, sources.flightEnd, range,
    false, planWindowOf(sources, range), impr);
  // `bounds` is the calendar (the fact rows, the date axis); `expBounds` is what an expected
  // window DELTA may count — the same window, never past asOf.
  const bounds = calendarBounds(sources, range);
  const expBounds = expectedBounds(sources, range);
  // Primary conversions (spec §3): the line items in view whose conversions this reading
  // cannot answer. Empty while the switch is off, and then no cell below changes.
  const cvOff = new Set(cvOffIds(sources, sources.effLIs, range));
  let cvTotalsNull = false;
  // …and how many line items that «—» is about, for the Totals tooltip (0: no sentence).
  const cvColsAny = cols.some(readsCvField);
  let cvNoteCount = 0;
  // …and, for the Totals row a search box re-totals over the rows it keeps (`retotal`), whether
  // THOSE rows still include an unavailable line item. Set by the two grains whose row keys name
  // line items; the date and dimension grains inherit the whole cut's answer.
  let cvSubsetNull = null;

  let rows = [];
  let totalsSums = null;
  // The dim cut's plan, hoisted so the Totals row below can read the same one the rows did,
  // and the ids of the columns that read it.
  let dimPlans = null;
  let planCols = null;
  // The Totals row over a SUBSET of the rows — the ones a search box keeps (owner ruling
  // 2026-09-16: the total follows the box). Each grain keeps what it needs to re-take its
  // sums by the rows' keys, and `retotal` below runs them through the same cells the Totals
  // row takes. Null until a grain sets it.
  let subset = null;
  // …and the CALENDAR's own row keys, on the one grain that has a calendar. Published for
  // the CM360 window pass (CM360-in-formulas spec §2.9), which runs a running total down the
  // days rather than down whatever the author sorted the table into. Null until the date arm
  // sets it, so no other grain's model changes shape.
  let rowOrder = null;
  // …and the plan those rows were drawn from, published for the reader the engine cannot
  // see: a cm-bearing formula names a plan field beside the CM360 counts and must read the
  // row's OWN target (2026-09-16 §2.4). Null on every grain but `dim`, where a row has a
  // plan of its own.
  let rowScalars = null;

  if (grain.type === 'date') {
    const rawCal = aggregateDateRows(sources, range);
    const cal = highlightSafe ? highlightDateRows(rawCal, sources) : rawCal;
    const ctx = seriesCtx(cal, campScalars, highlightSafe ? 'ts' : null);
    const evaluated = {};
    for (const c of cols) {
      // Plan scalars broadcast as constants — SAME value for a bare field and for
      // the trivial formula around it (round 6.1: bare `budget` read row-0 while
      // `budget + 0` read 100).
      if (c.kind === 'field') {
        evaluated[c.id] = highlightSafe ? cal.map((r) => highlightFieldValue(c.field, r, campScalars, 'ts')) : c.field in campScalars
          ? cal.map(() => campScalars[c.field])
          : cal.map((r) => r[c.field] ?? 0);
      } else if (c.kind === 'expr') evaluated[c.id] = evalSeries(c.ast, ctx).values;
      else evaluated[c.id] = cal.map(() => null);
    }
    const cvMask = cvDateMask(sources, cal, sources.effLIs, range);
    if (cvMask) {
      for (const c of cols) {
        if (readsCvField(c)) evaluated[c.id] = maskCvValues(evaluated[c.id], cvMask, c.kind === 'expr' && c.windowed);
      }
      cvTotalsNull = cvMask.some(Boolean);
      if (cvTotalsNull && cvColsAny) cvNoteCount = cvOff.size;
    }
    rows = cal.map((r, i) => ({
      label: r.date, date: r.date,
      // …and why its conversion cells are «—» (spec §3 Display). Sparse.
      ...(cvColsAny && cvMask && cvMask[i] ? { cvReason: CV_ROW_REASON } : null),
      cells: Object.fromEntries(cols.map((c) => [c.id, evaluated[c.id][i]])),
    }));
    totalsSums = cal.reduce((t, r) => (addRowSums(t, r), t), { ...ZERO_FLOW });
    const byKey = new Map(cal.map((r) => [tableRowKey(r, 'date'), r]));
    // Taken HERE, and not after the sort below: this is the last moment the calendar is
    // still in hand. `rows` is reordered by the authored sort a screen down, and
    // report-render.js's own sortReportRows runs later still.
    rowOrder = [...byKey.keys()];
    subset = (keys) => {
      const sums = { ...ZERO_FLOW };
      for (const key of keys) { const r = byKey.get(key); if (r) addRowSums(sums, r); }
      return { sums, scalars: campScalars, unplanned: false, planNull: true };
    };
    // Totals expected = window delta, not a sum of daily cumulatives (§3) — over the calendar
    // the rows above draw, NOT expBounds: a date table's rows carry the plan curve to the
    // window's end (aggregateDateRows), and a Totals row stopped at asOf read 56,400 under a
    // last row of 141,000, and 40% under a row's 100% (review 2026-09-23). The Totals is that
    // last row's cumulative, as it was before; the rows that stop at asOf are the li, dateLi
    // and dim grains', whose Totals stop with them.
    const eTot = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
    for (const id of sources.effLIs) {
      const p = sources.liPlan[id];
      if (!p) continue;
      const e = expectedDeltas(p, bounds.from, bounds.to);
      eTot.expIm += e.expIm; eTot.expCo += e.expCo; eTot.expCl += e.expCl; eTot.expVw += e.expVw;
      eTot.imprExpected += e.imprExpected;
    }
    Object.assign(totalsSums, eTot);
  } else if (grain.type === 'dateLi') {
    const needsCalendar = cols.some((c) => c.kind === 'field' ? FIELDS_EXPECTED.has(c.field)
      : c.kind === 'expr' && calendarExpression(c.ast));
    const factByKey = new Map();
    // …and which line each row key belongs to, for a kept subset's CTR target.
    const lineByKey = new Map();
    for (const id of sources.effLIs) {
      const p = sources.liPlan[id];
      if (!p) continue;
      // One LI per row → ENTITY rates (its own plain ratios).
      const rawCal = needsCalendar ? aggregateDateRows(sources, range, 'entity', [id])
        : factDateRows(sources, id, bounds);
      const cal = highlightSafe ? highlightDateRows(rawCal, sources, [id]) : rawCal;
      // Date-series Totals count audio listens for ACR and eligible video views
      // for CPV. Use those same populations in the detail cells and formulas.
      // Keep entity CTR/CPM and the legacy VCR empty-cell behavior intact.
      for (const r of cal) {
        const { acr, cpv } = ratesFromSums(r, 'ts');
        Object.assign(r, { acr, cpv });
      }
      const liScalars = liPlanScalars(p, sources.asOf, range, planWindowOf(sources, range));
      const ctx = seriesCtx(cal, liScalars, highlightSafe ? 'dateLi' : null);
      const evaluated = {};
      for (const c of cols) {
        if (c.kind === 'field') {
          // A field the row CARRIES reads as it is, including a deliberate null (the
          // entity basis answers one for `vcr` on a line that is not VCR-eligible, and
          // `?? 0` here printed that as 0.00%); a field it does not carry is the
          // absence-is-zero canon. Unknown names never reach this — compileColumns
          // turns them into error columns above.
          evaluated[c.id] = highlightSafe ? cal.map((r) => highlightFieldValue(c.field, r, liScalars, ['acr', 'cpv'].includes(c.field) ? 'ts' : 'entity')) : c.field in liScalars
            ? cal.map(() => liScalars[c.field])
            : cal.map((r) => (c.field in r ? r[c.field] : 0));
        } else if (c.kind === 'expr') evaluated[c.id] = evalSeries(c.ast, ctx).values;
        else evaluated[c.id] = cal.map(() => null);
      }
      if (cvOff.has(String(id))) {
        for (const c of cols) if (readsCvField(c)) evaluated[c.id] = cal.map(() => null);
      }
      const label = sources.liNames?.[id] || `LI ${id}`;
      // The line's own three facts, carried once per line rather than per row: the display
      // name, the raw id and the channel are what the legacy section's «LI / Channel» column
      // draws (name in bold over «LI 900101 · Display»), and `paused` is the muted chip beside
      // it. `isLiPausedNow` is the section's own read (DailyTable.jsx:102).
      const rawId = `LI ${id}`;
      const channel = p.ch || 'Unknown';
      const paused = PacingCore.isLiPausedNow(p, sources.asOf);
      cal.forEach((r, i) => {
        // Fact days only (DailyTable granularity) — window functions above still ran
        // over the full calendar, so their values are gap-correct. And only days inside the
        // line's OWN flight: `aggregateDateRows` already refuses the fact there (a flight-date
        // edit can leave delivery outside the window), so without this clip the row survived
        // as a full row of zeros where the legacy section drops it (DailyTable.jsx:30).
        if (!(sources.liDaily[id] || {})[r.date]) return;
        if (p.fs && p.fe && (r.date < p.fs || r.date > p.fe)) return;
        const row = {
          label: r.date, date: r.date, liId: id, sub: label, subId: rawId, subNote: channel,
          cells: Object.fromEntries(cols.map((c) => [c.id, evaluated[c.id][i]])),
        };
        // Sparse, like every other «only when it is true» mark in this system: a row that
        // carries the key is a line that is paused right now.
        if (paused) row.paused = true;
        // …and one whose conversion cells are «—», with its line item's reason (spec §3 Display).
        if (cvColsAny && cvOff.has(String(id))) row.cvReason = cvReasonOf(sources, id);
        rows.push(row);
        factByKey.set(tableRowKey(row, 'dateLi'), r);
        lineByKey.set(tableRowKey(row, 'dateLi'), id);
      });
    }
    totalsSums = sources.effLIs.reduce((t, id) => {
      const p = sources.liPlan[id];
      if (p) addRowSums(t, sumLiWindow(sources.liDaily, p, id, range, expBounds));
      return t;
    }, { ...ZERO_FLOW });
    cvTotalsNull = cvOff.size > 0;
    if (cvTotalsNull && cvColsAny) cvNoteCount = cvOff.size;
    // A dateLi row key is `${date}|${liId}` (tableRowKey).
    cvSubsetNull = (keys) => [...keys].some((k) => cvOff.has(String(k).split('|')[1]));
    // A kept subset keeps the window's plan constants, as the rows above it do, with ONE
    // exception: the CTR target. Each row here prints its own line's target, and the kept rows'
    // CTR is theirs alone, so the target over them is re-weighted by the impressions THOSE rows
    // delivered (owner decision 2026-09-23) — «C's rows» read C's target, not the mixed window's.
    subset = (keys) => {
      const sums = { ...ZERO_FLOW };
      const keptIm = new Map();
      const keptIds = [];
      for (const key of keys) {
        const r = factByKey.get(key);
        if (!r) continue;
        addRowSums(sums, r);
        const id = lineByKey.get(key);
        const k = String(id);
        if (!keptIm.has(k)) { keptIm.set(k, 0); keptIds.push(id); }
        keptIm.set(k, keptIm.get(k) + (r.im || 0));
      }
      const scalars = withCtrT(campScalars,
        () => weightedCtrT(sources.liPlan, keptIds, (id) => keptIm.get(String(id)) || 0));
      return { sums, scalars, unplanned: false, planNull: true };
    };
  } else if (isDim) {
    const cut = dimBuckets(sources, grain.key, range, !!request.residual);
    const buckets = cut.buckets;
    for (const c of cols) {
      const error = c.kind === 'field' ? cut.fieldErrors?.[c.field] : expressionFieldError(c.ast, cut.fieldErrors);
      if (error) { c.kind = 'error'; c.error = error; colErrors[c.id] = error; }
    }
    // The per-row plan, where the dimension is declared: one container walk for the whole
    // cut, then a lookup per row (plan metrics on dim rows, 2026-09-12).
    dimPlans = dimRowPlans(sources, grain.key, cut, range, expBounds);
    // Which columns read the plan. Needed twice: to say so on the model, and — right here —
    // to keep a FORMULA honest on a row that declared nothing. A bare field reads the null
    // scalars and prints an em dash, but inside arithmetic an absent value is 0 (the engine's
    // absence-is-zero canon), so `im / expIm * 100` printed a confident 0% where the answer
    // is that there is no target to pace against. On this grain that is not a rounding of the
    // truth, it is the opposite of it.
    planCols = new Set(cols.filter(readsPlanField).map((c) => c.id));
    // …and which columns read a conversion field, emptied on the rows the cut could not place.
    const cvCols = new Set(cols.filter(readsCvField).map((c) => c.id));
    // Dim buckets follow the Breakdown-table canon: ctr/cpm plain over the bucket,
    // vcr over the gated imV/coV pair — exactly the 'ts' basis shape.
    rows = Object.entries(buckets).map(([label, bucket]) => {
      const rp = rowPlanOf(dimPlans, label);
      const scalars = rp ? rp.scalars : null;
      // A row made only of conversions (no delivery in the window) is not a fact (spec §4
      // "Conversion-only rows and days"): a highlight rule reads its daily and rate fields as
      // absent, and it joins no best/worst (report-render.js columnExtremes).
      const cvOnlyRow = !!(cut.cvOnly && cut.cvOnly.has(label));
      const sums = cvOnlyRow && highlightSafe
        ? { ...withRowExpected(bucket, rp), __highlightFacts: false } : withRowExpected(bucket, rp);
      const unplanned = !!rp && !(rp.keys && rp.keys.length);
      const cvBlocked = cvBlockedLabel(cut, label);
      return {
        label,
        // Sparse, like `paused` one grain over: the row that carries it is the untagged
        // remainder, which sorts last, never joins a best/worst comparison and refuses a click.
        ...(label === cut.residual ? { residual: true } : null),
        // …and the cut's other leftovers — «Unclassified», «No value». They rank between the
        // real values and the remainder, grey the same way and refuse the same click; unlike
        // the remainder they ARE measured, so they stay in the best/worst comparison
        // (Breakdown.jsx:80, the legacy panel's own split).
        ...(cut.leftovers.has(label) ? { leftover: true } : null),
        // …and a conversion-only row. Sparse.
        ...(cvOnlyRow ? { cvOnly: true } : null),
        // …and, on the same sparse rule, the row whose plan covers only part of its own
        // delivery. It is a fact about THIS row, so it rides the row and not the tile.
        ...(rp && rp.partial ? { planPartial: rp.partial } : null),
        // …and, on the Conversion Action cut of an operative pacing, how many line items in view
        // that carry this action chose it (spec §4). Sparse.
        ...(cut.actionLis ? primaryMarkOf(sources, cut, label) : null),
        // …and why its conversion cells are «—» (spec §3 Display). Sparse.
        ...(cvBlocked && cvCols.size ? { cvReason: CV_ROW_REASON } : null),
        cells: Object.fromEntries(cols.map((c) => [
          c.id,
          cvBlocked && cvCols.has(c.id) ? null
            : unplanned && planCols.has(c.id) ? null
            : c.kind === 'field' ? readField(c.field, sums, scalars, fieldSet, 'ts')
              : c.kind === 'expr' ? evalOne(c.ast, aggCtx(sums, scalars, 'ts', highlightSafe)).value
              : null,
        ])),
      };
    });
    // The remainder is IN the totals, which is what puts them back on the pacing's own
    // delivery: on a Geo cut the Total is the campaign's 16,174 clicks again, and its CTR is
    // still the ratio of the column standing above it.
    const custom = customMetricKeys(sources, parseDimSourceKey(grain.key)?.sourceId);
    totalsSums = Object.values(buckets).reduce((t, b) => (addRowSums(t, b, custom), t), { ...ZERO_FLOW });
    // A conversion-only row is no fact (spec §4), so a total whose window holds one and no row
    // with delivery there (a row with no day in the window has none) has none either.
    if (highlightSafe) {
      const labels = Object.keys(buckets);
      const delivered = labels.some((label) => !(cut.cvOnly && cut.cvOnly.has(label)) && !(cut.quiet && cut.quiet.has(label)));
      totalsSums.__highlightFacts = labels.length > 0 && (delivered || !(cut.cvOnly && cut.cvOnly.size));
    }
    cvTotalsNull = !!(cut.cvBlock && cut.cvBlock.totals);
    if (cvTotalsNull && cvColsAny) {
      cvNoteCount = [...cut.cvBlock.ids].filter((id) => planReaches(sources.liPlan && sources.liPlan[id], range)).length
        || cut.cvBlock.ids.size;
    }
    // The kept buckets re-summed, and their plan re-weighted over the union of their leaf
    // plans — the Totals row's own construction (dimRowPlans), over fewer rows. Answered
    // ONCE per key set: the cm half of the same re-total asks for it again through
    // `rowScalars.subset` below, and §2.4 buys that second read with the memo rather than
    // with a second weighting.
    subset = onceForKeys((keys) => {
      const sums = { ...ZERO_FLOW };
      const planKeys = [];
      const exp = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
      for (const key of keys) {
        if (!hasOwn(buckets, key)) continue;
        addRowSums(sums, buckets[key], custom);
        const rp = rowPlanOf(dimPlans, key);
        if (!rp || !rp.keys) continue;
        for (const k of rp.keys) planKeys.push(k);
        for (const k of Object.keys(exp)) exp[k] += Number(rp.exp?.[k]) || 0;
      }
      if (!dimPlans) return { sums, scalars: null, unplanned: false, planNull: false };
      const scalars = planKeys.length
        ? campaignScalars(dimPlans.plans, planKeys, sources.asOf, sources.flightStart, sources.flightEnd, range,
          false, planWindowOf(sources, range), keyImprOf(dimPlans.imByKey))
        : DIM_PLAN_NULLS;
      return { sums: { ...sums, ...exp }, scalars, unplanned: planKeys.length === 0, planNull: false };
    });
    // The publication itself (§2.4): the engine's own per-row plan, keyed by the row key
    // `tableRowKey` mints for this grain — which IS the bucket label, and is what
    // report-render.js joins its CM360 rows on. Nothing here is computed; every value is a
    // reference to something the rows above already stand on.
    rowScalars = {
      byKey: new Map(Object.keys(buckets).map((label) => [
        String(label), publishedRowPlan(rowPlanOf(dimPlans, label)),
      ])),
      absent: ABSENT_ROW_PLAN,
      totals: publishedRowPlan(dimPlans && dimPlans.totals),
      subset: (keys) => {
        const part = subset(keys);
        return part.scalars && !part.unplanned ? { scalars: part.scalars, unplanned: false } : ABSENT_ROW_PLAN;
      },
      // What a formula on THIS cut may name (§2.4's first gate, taken in report-render.js):
      // the widened set for a namebuilder dimension, the bare delivery set for a dimension
      // source, `channel` or an aux cut — the same set the bare-field columns are judged by.
      fieldSet,
    };
  } else {
    // rows: 'li'
    for (const id of sources.effLIs) {
      const p = sources.liPlan[id];
      if (!p) continue;
      const sums = sumLiWindow(sources.liDaily, p, id, range, expBounds);
      impr.seed(id, sums.im);
      if (highlightSafe) sums.__highlightFacts = highlightHasFacts(sources, range, [id]);
      const scalars = liPlanScalars(p, sources.asOf, range, planWindowOf(sources, range));
      const cvRowOff = cvOff.has(String(id));
      const row = {
        label: sources.liNames?.[id] || `LI ${id}`, liId: id, sub: p.ch || null,
        // …and why its conversion cells are «—»: the line item's own reason (spec §3 Display). Sparse.
        ...(cvRowOff && cvColsAny ? { cvReason: cvReasonOf(sources, id) } : null),
        cells: Object.fromEntries(cols.map((c) => [
          c.id,
          cvRowOff && readsCvField(c) ? null
            : c.kind === 'field' ? readField(c.field, sums, scalars, fieldSet, 'entity')
            : c.kind === 'expr' ? evalOne(c.ast, aggCtx(sums, scalars, 'entity', highlightSafe)).value
            : null,
        ])),
      };
      // The same fact as on a date × line row, on the grain whose label IS the line.
      if (PacingCore.isLiPausedNow(p, sources.asOf)) row.paused = true;
      rows.push(row);
    }
    totalsSums = sources.effLIs.reduce((t, id) => {
      const p = sources.liPlan[id];
      if (p) addRowSums(t, sumLiWindow(sources.liDaily, p, id, range, expBounds));
      return t;
    }, { ...ZERO_FLOW });
    cvTotalsNull = cvOff.size > 0;
    if (cvTotalsNull && cvColsAny) cvNoteCount = cvOff.size;
    // An li row key is the line item id (tableRowKey).
    cvSubsetNull = (keys) => [...keys].some((k) => cvOff.has(String(k)));
    subset = (keys) => {
      const ids = sources.effLIs.filter((id) => keys.has(String(id)) && sources.liPlan[id]);
      const sums = { ...ZERO_FLOW };
      for (const id of ids) addRowSums(sums, sumLiWindow(sources.liDaily, sources.liPlan[id], id, range, expBounds));
      const scalars = campaignScalars(sources.liPlan, ids, sources.asOf, sources.flightStart, sources.flightEnd, range,
        false, planWindowOf(sources, range), impr);
      return { sums, scalars, unplanned: false, planNull: false, silentRates: silentAggRates(sums) };
    };
  }

  // Sort + limit
  const sort = request.sort || { columnId: '__row__', dir: 'asc' };
  const dir = sort.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    // Leftovers sink below every real value, whatever the sort and whichever way it runs —
    // the legacy panel's own rank (Breakdown.jsx:536): real values, then «Unclassified» and
    // «No value», then the untagged remainder last of all. None of them is a segment anybody
    // chose, and at the top of a table any of them reads as one.
    if (leftoverRank(a) !== leftoverRank(b)) return leftoverRank(a) - leftoverRank(b);
    const av = sort.columnId === '__row__' ? a.label : a.cells[sort.columnId] ?? 0;
    const bv = sort.columnId === '__row__' ? b.label : b.cells[sort.columnId] ?? 0;
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  // What the plan half of a dimension table covers, counted BEFORE the limit cuts the list:
  // it is a statement about the pacing, and a widget showing the top 5 of 200 values must not
  // report a different coverage from the same widget showing 50.
  // `planCols.size` was a fourth conjunct here until CM360 in formulas (2026-09-16 §2.4). A
  // table whose only plan-derived column is a cm-bearing formula has no ENGINE plan column
  // at all — report-render.js adds that column to the list afterwards — and the conjunct took
  // the mark, the fade on its empty cells and the «declared for N of M» footnote away from a
  // table that has a plan to describe. Nothing else moves: the renderer draws none of the
  // three unless a DRAWN column is plan-derived (ReportTable.jsx `markColumnId`), so a table
  // with no plan column renders exactly as it did, with an empty list instead of a null one.
  const planInfo = (isDim && dimPlans && planCols) ? (() => {
    const declarable = rows.filter((r) => !r.residual && !r.leftover);
    // Nothing a value could be declared for — an empty cut, or one that is all remainder.
    // «declared for 0 of 0» is a sentence about nothing.
    if (declarable.length === 0) return null;
    return {
      planColumns: [...planCols],
      planDeclared: declarable.filter((r) => dimPlans.byLabel.get(r.label)?.keys?.length).length,
      planDeclarable: declarable.length,
    };
  })() : null;

  if (request.limit && rows.length > request.limit) rows = rows.slice(0, request.limit);

  // Totals: aggregate-then-compute; window-fn / error columns → null (renderer "—").
  //
  // The BASIS follows the rows, and since section-widget parity (2026-09-04) that includes
  // the two DATE grains. A dim bucket's rows read 'ts' (plain ratios over the bucket, the
  // Breakdown-table canon above), so its total does too — otherwise the Total is not the
  // ratio of the column standing above it: 'agg' drops a click-paced line from cpm
  // (spNC/imNC), and on a mixed CPM+CPC pacing the total then reads a number no row on the
  // table adds up to (sections-to-widgets M4, measured). A date table had exactly the same
  // problem and the M2 audit left it as the owner's question: on mock-multi the totals row
  // printed 0.13% and $2.81 over rows that re-sum to 0.76% and $3.29, which is what the
  // legacy Daily Performance section prints. That question is answered — the rows win — and
  // `li` is the one grain still on 'agg', because its rows are entities rather than a
  // time series and the campaign canon is what stands over them. Its ctr now counts every
  // line (owner decision 2026-09-23), so on ctr the li Totals is the re-sum of its rows too.
  if (highlightSafe && !isDim && totalsSums) totalsSums.__highlightFacts = highlightHasFacts(sources, range);
  let totals = null;
  let totalsPartial = null;
  let retotal = null;
  // One Totals row from one set of sums: the whole cut's below, a kept subset's in `retotal`.
  // `planNull` is the date grains' rule (CALENDAR_PLAN_FIELDS); `unplanned` the dim cut's.
  const totalsCells = ({ sums, scalars, unplanned, planNull, silentRates, cvNull }) => {
    const basis = isDim || contextKind === 'ts' ? 'ts' : 'agg';
    return Object.fromEntries(cols.map((c) => {
      if (unplanned && planCols && planCols.has(c.id)) return [c.id, null];
      if (planNull && columnReads(c, CALENDAR_EXPECTED_FIELDS)) return [c.id, null];
      if (silentRates && silentRates.size && columnReads(c, silentRates)) return [c.id, null];
      // One totals rule (spec §3): a line item that is unavailable here empties every total
      // built on conversions — the cut's when any in-view line item is, a subset's when one of
      // the kept rows is.
      if (cvNull && readsCvField(c)) return [c.id, null];
      if (c.kind === 'field') return [c.id, readField(c.field, sums, scalars, fieldSet, basis)];
      if (c.kind !== 'expr' || c.windowed) return [c.id, null];
      return [c.id, evalOne(c.ast, aggCtx(sums, scalars, basis, highlightSafe)).value];
    }));
  };
  if (request.totals) {
    // A dim table's Totals plan is the declared plans summed — never the campaign's, which
    // would stand over rows that add up to less and read as a shortfall nobody has.
    const scalars = isDim ? (dimPlans ? dimPlans.totals.scalars : null) : campScalars;
    if (isDim && dimPlans) totalsPartial = dimPlans.totals.partial;
    const sums = isDim && dimPlans ? withRowExpected(totalsSums, dimPlans.totals) : totalsSums;
    // …and the same silence the rows keep: with nothing declared anywhere on this cut, a plan
    // formula in the Totals row would print a 0 standing under a whole column of em dashes.
    const totalsUnplanned = !!(isDim && dimPlans && !(dimPlans.totals.keys || []).length);
    totals = totalsCells({ sums, scalars, unplanned: totalsUnplanned, planNull: false, cvNull: cvTotalsNull });
    if (subset) {
      retotal = (keys) => {
        const part = subset(keys);
        if (highlightSafe && totalsSums && '__highlightFacts' in totalsSums) part.sums.__highlightFacts = totalsSums.__highlightFacts;
        // A subset keyed by line item (li, dateLi) is exact again once every unavailable line
        // item is outside it; a date or dimension subset inherits the cut's answer.
        return totalsCells({ ...part, cvNull: cvSubsetNull ? cvSubsetNull(keys) : cvTotalsNull });
      };
    }
  }

  // `planInfo` was counted above, before the limit. It carries which columns are plan-derived
  // (their empty cells read as «no target», not as missing data) and how many of the rows that
  // COULD carry a plan actually do — measured over the values a plan can name, so the untagged
  // remainder and «Unclassified» are out of both halves. Sparse: absent on every other grain,
  // so no other table's model changes shape.
  return {
    rows, totals, colErrors,
    // The window's plan, computed above whatever the grain is, and published so a reader that
    // evaluates its OWN expression over the same window reads the engine's plan rather than
    // building a second one beside it (CM360 in formulas, spec
    // docs/2026-09-16-cm360-in-formulas-design.md §2.4). On the date grains this is also what
    // every row's plan cell prints, which is the agreement the second pass depends on.
    windowScalars: campScalars,
    // Sparse, like the ones under it: only a table with a Totals row can re-total a subset.
    ...(retotal ? { retotal } : null),
    // …and only a date grain has a calendar for a window function to run down (§2.9).
    ...(rowOrder ? { rowOrder } : null),
    ...(totalsPartial ? { totalsPartial } : null),
    // Sparse, like the three above it: only a dimension table has a plan per row to publish,
    // and a widget that names no cm identifier never reads this key (2026-09-16 §2.4).
    ...(rowScalars ? { rowScalars } : null),
    ...planInfo,
    // Primary conversions (spec §3 totals rule): why the conversion Totals read «—». Sparse.
    ...(totals && cvNoteCount > 0 ? { cvNote: cvCannotShowText(cvNoteCount) } : null),
  };
}

/* ── chart series / categories / KPI ──────────────────────────────────────── */

export function buildSeriesModel(expressions, range, sources, highlightSafe = false) {
  const rawCal = aggregateDateRows(sources, range);
  const cal = highlightSafe ? highlightDateRows(rawCal, sources) : rawCal;
  const scalars = campaignScalars(sources.liPlan, sources.effLIs, sources.asOf, sources.flightStart, sources.flightEnd, range,
    false, planWindowOf(sources, range), lineImpr(sources, range));
  const ctx = seriesCtx(cal, scalars, highlightSafe ? 'ts' : null);
  // Primary conversions (spec §3): which days include a line item whose conversions are
  // unavailable. Null while the switch is off.
  const cvMask = cvDateMask(sources, cal, sources.effLIs, range);
  const errors = {};
  const series = (expressions || []).map((s) => {
    const v = validate(s.expr, 'ts', TS_FIELDS);
    if (!v.ok) {
      errors[s.id] = formulaSay(v);
      return { id: s.id, label: s.label, values: cal.map(() => 0), warned: true };
    }
    const unavailable = highlightSafe && unavailableMetric({ kind: 'formula', expr: s.expr }, sources, null);
    if (unavailable) {
      errors[s.id] = unavailable;
      return { id: s.id, label: s.label, values: cal.map(() => null), warned: false };
    }
    const ast = parse(s.expr).ast;
    const r = (highlightSafe ? evaluateHighlightSeries : evaluateSeries)(ast, ctx);
    const values = cvMask && astNamesAny(ast, CV_FIELDS) ? maskCvValues(r.values, cvMask, usesWindowFn(ast)) : r.values;
    return { id: s.id, label: s.label, values, warned: r.warned };
  });
  // `scalars` for the same reason the table publishes its own (§2.4): a cm-bearing chart
  // series is evaluated in the second pass, over this very window, and its plan half may not
  // be a second reading of the same question.
  return { dates: cal.map((r) => r.date), series, errors, scalars };
}

/**
 * What the FOLD is called — the tail of the ranking, past `topN`, gathered into one bar or one
 * slice. It holds real values of the axis, which is what «Other values» says.
 *
 * It was «Others» until section-widget parity (2026-09-04), and the rename is the one thing
 * that keeps a Breakdown tile legible: the untagged remainder beside it is the legacy panel's
 * «Others» — delivery that carries NO value of this dimension — and one ring drawing two grey
 * slices under one name says nothing at all. Two different quantities may not share a word.
 */
export const OTHER_VALUES_LABEL = 'Other values';

export function buildCategoryModel(request, range, sources) {
  const highlightSafe = !!request?.highlightSafe;
  const evalOne = highlightSafe ? evaluateHighlightOne : evaluateOne;
  const grain = request && request.grain ? request.grain : { type: 'li' };
  const isDim = grain.type === 'dim';
  const fieldSet = isDim
    ? dimFieldSetFor(sources, parseDimSourceKey(grain.key)?.sourceId, grain.key) : AGG_FIELDS;
  // Every read of `bounds` here is an expected window delta, so it stops at asOf.
  const bounds = expectedBounds(sources, range);
  // This model holds no window plan of its own — a category's plan is the CUT's, not the
  // campaign's — so the window's is computed here, ONCE, with the same call every other model
  // makes (§2.4: the window's scalars are one function, on the widget's own scoped sources).
  // Each line's impressions in this window, the CTR target's weight; the li categories below
  // hand theirs over as they sum them (lineImpr).
  const impr = lineImpr(sources, range);
  const windowScalars = campaignScalars(sources.liPlan, sources.effLIs, sources.asOf,
    sources.flightStart, sources.flightEnd, range, false, planWindowOf(sources, range), impr);
  const errors = {};
  const compiled = (request.expressions || []).map((s) => {
    const v = validate(s.expr, 'agg', fieldSet);
    if (!v.ok) { errors[s.id] = formulaSay(v); return null; }
    const unavailable = highlightSafe && unavailableMetric({ kind: 'formula', expr: s.expr }, sources, isDim ? grain.key : null);
    if (unavailable) { errors[s.id] = unavailable; return null; }
    return { id: s.id, ast: parse(s.expr).ast };
  });

  // Primary conversions (spec §3): line items in view whose conversions are unavailable here.
  const cvOff = new Set(cvOffIds(sources, sources.effLIs, range));
  let entities = [];
  // The untagged remainder, held OUT of the ranking and the fold and appended last — it is
  // not one of the values being ranked, and folded into the tail it would take the whole
  // untagged part of the pacing with it under a name that means the opposite.
  let residualCat = null;
  // The dim cut's plan, hoisted so the fold below re-weights over the same leaf plans.
  let dimPlans = null;
  if (isDim) {
    const cut = dimBuckets(sources, grain.key, range, !!request.residual);
    compiled.forEach((c, i) => {
      const error = expressionFieldError(c?.ast, cut.fieldErrors);
      if (error) { errors[c.id] = error; compiled[i] = null; }
    });
    // The same per-row plan the dim TABLE builds, so a bar and a row of one dimension never
    // disagree about the target behind a value.
    dimPlans = dimRowPlans(sources, grain.key, cut, range, bounds);
    entities = Object.entries(cut.buckets)
      .map(([label, bucket]) => {
        // This bucket's plan, read ONCE: the sums, the scalars the bar is drawn from, the
        // fold's leaf plan and the published shape are four readings of one answer.
        const rp = rowPlanOf(dimPlans, label);
        return {
          label,
          // A conversion-only category is not a fact for a highlight rule (spec §4).
          sums: highlightSafe && cut.cvOnly && cut.cvOnly.has(label)
            ? { ...withRowExpected(bucket, rp), __highlightFacts: false } : withRowExpected(bucket, rp),
          scalars: (rp || {}).scalars ?? null,
          // Carried so the fold below can re-weight over the leaf plans of the values it
          // swallows rather than averaging their finished scalars. Named `leafPlan` — not
          // `plan` — because the PUBLIC category two lines down publishes a `plan` key of its
          // own, in the second pass's `{ scalars, unplanned }` shape (`e.published`); the two
          // are different shapes on different objects, and sharing a name invited confusion.
          leafPlan: rp,
          // …and the same plan in the shape the SECOND pass reads (2026-09-16 §2.4): the
          // scalars this bar was drawn from, plus whether the value declared anything at all.
          // It rides the private entity and is copied onto the public category below, so a
          // cm-bearing series and the bar beside it stand on one weighting.
          published: publishedRowPlan(rp),
          ids: null,
          highlightKey: JSON.stringify(['dim', label]),
          residual: label === cut.residual,
          // «Unclassified» / «No value». They stay in the RANKING, because the fold is decided
          // by size and holding a leftover out of it would swallow a real value into «Other
          // values» in its stead — they sink afterwards, once the fold has been taken.
          leftover: cut.leftovers.has(label),
          cvNull: cvBlockedLabel(cut, label),
        };
      });
    residualCat = entities.find((e) => e.residual) || null;
    if (residualCat) entities = entities.filter((e) => !e.residual);
  } else {
    entities = sources.effLIs.map((id) => {
      const p = sources.liPlan[id];
      if (!p) return null;
      const lineSums = sumLiWindow(sources.liDaily, p, id, range, bounds);
      impr.seed(id, lineSums.im);
      return {
        label: sources.liNames?.[id] || `LI ${id}`,
        highlightKey: JSON.stringify(['li', String(id)]),
        sums: { ...lineSums, ...(highlightSafe ? { __highlightFacts: highlightHasFacts(sources, range, [id]) } : null) },
        scalars: liPlanScalars(p, sources.asOf, range, planWindowOf(sources, range)),
        ids: [id],
        cvNull: cvOff.has(String(id)),
      };
    }).filter(Boolean);
  }

  // Per-LI categories are ENTITY rows; dim-bucket categories follow the Breakdown
  // bucket canon ('ts' basis: plain ctr/cpm, gated vcr).
  const entityBasis = isDim ? 'ts' : 'entity';
  // Which series read the plan, so a bar on a value nobody declared draws NOTHING rather than
  // a zero. A chart has no bare-field path — every series is an expression — and inside
  // arithmetic an absent value is 0, so without this the whole plan half of a dimension chart
  // read a confident 0 while the table beside it printed em dashes for the same values.
  const planSeries = isDim ? compiled.map((c) => !!c && readsPlanField({ kind: 'expr', ast: c.ast })) : null;
  const unplanned = (e) => !!e.leafPlan && !(e.leafPlan.keys && e.leafPlan.keys.length);
  // Which series read a conversion field, so an entity whose conversions are unknown draws
  // nothing there rather than the engine's absence-is-zero 0 (spec §3).
  const cvSeries = compiled.map((c) => !!c && astNamesAny(c.ast, CV_FIELDS));
  const evalEntity = (e) => compiled.map((c, i) => {
    if (!c) return highlightSafe ? null : 0;
    if (planSeries && planSeries[i] && unplanned(e)) return null;
    if (cvSeries[i] && e.cvNull) return null;
    return evalOne(c.ast, aggCtx(e.sums, e.scalars, entityBasis, highlightSafe)).value;
  });
  // Sparse, as every other mark on this path is: only a leftover carries the key.
  let cats = entities.map((e) => ({
    label: e.label, ...(request.identities ? { highlightKey: e.highlightKey } : null), values: evalEntity(e),
    // Sparse, and only where it exists: a dimension value has a declared plan of its own,
    // a line item does not — and a line-item axis has no CM360 join to read one for (§2.2).
    ...(e.published ? { plan: e.published } : null),
    ...(e.leftover ? { leftover: true } : null), _e: e,
  }));
  const rankIndex = Object.hasOwn(request, 'rankExpression') ? (request.rankExpression == null ? -1 : request.expressions.findIndex((entry) => entry.expr === request.rankExpression)) : 0;
  if (rankIndex >= 0) {
    // A Highlight may reject a legacy fallback number, but must still read the
    // categories and folded membership that the visible chart actually ranked.
    const ranking = highlightSafe && Object.hasOwn(request, 'rankExpression') ? new Map(cats.map((cat) => [cat,
      compiled[rankIndex] ? evaluateOne(compiled[rankIndex].ast, aggCtx(cat._e.sums, cat._e.scalars, entityBasis)).value : 0,
    ])) : null;
    const rank = (cat) => (ranking ? ranking.get(cat) : cat.values[rankIndex]) ?? 0;
    cats.sort((a, b) => rank(b) - rank(a));
  }

  if (request.limit && cats.length > request.limit) {
    const top = cats.slice(0, request.limit);
    const rest = cats.slice(request.limit);
    let foldHasPlan = true;
    // The fold swallows whole rows, so one unknown row makes its conversion bar unknown.
    const foldCvNull = rest.some((c) => c._e.cvNull);
    const custom = isDim ? customMetricKeys(sources, parseDimSourceKey(grain.key)?.sourceId) : [];
    const restSums = rest.reduce((t, c) => (addRowSums(t, c._e.sums, custom), t), { ...ZERO_FLOW });
    // Others scalars: WEIGHTED campaign scalars over the remainder set (round-6 —
    // summing mTgt/ctrT/daysLeft across LIs is meaningless), on the FOLD basis
    // (P0.1, owner decision 2026-08-19): the targets weight over the same lines the
    // values count. ctrT weighs the folded lines by their impressions in this window
    // (owner decision 2026-09-23), so ctr against ctrT on one Others row is like-for-like.
    // The has-target filter and the vcrT/acrT audio split stay; campaign-level scalars
    // keep campM's rate-type gates.
    if (highlightSafe && !isDim) restSums.__highlightFacts = rest.some((category) => category._e.sums.__highlightFacts !== false);
    let restScalars = null;
    if (!isDim) {
      const restIds = rest.flatMap((c) => c._e.ids || []);
      restScalars = campaignScalars(sources.liPlan, restIds, sources.asOf, sources.flightStart, sources.flightEnd, range, true,
        planWindowOf(sources, range), impr);
    } else if (dimPlans) {
      const fold = foldPlanScalars(dimPlans, rest.map((c) => c._e.leafPlan), sources, range);
      restScalars = fold.scalars;
      Object.assign(restSums, fold.exp);
      foldHasPlan = rest.some((c) => c._e.leafPlan?.keys?.length);
    }
    const others = {
      label: OTHER_VALUES_LABEL, ...(request.identities ? { highlightKey: JSON.stringify(['fold']) } : null),
      // The SAME basis as the rows it folds (P0 §5.1). On the default agg basis
      // cpm reads the non-CPC/CPV basis (spNC/imNC), so a folded CPC line would
      // contribute nothing to the bar standing beside its own siblings.
      values: compiled.map((c, i) => {
        if (!c) return highlightSafe ? null : 0;
        // The fold obeys the same rule as the rows it swallows: with no declaration among
        // them there is no plan to draw, and a zero bar would claim one.
        if (planSeries && planSeries[i] && !foldHasPlan) return null;
        if (cvSeries[i] && foldCvNull) return null;
        return evalOne(c.ast, aggCtx(restSums, restScalars, entityBasis, highlightSafe)).value;
      }),
      others: true,
      // The fold holds several dimension values at once, so it names none and the CM360 side
      // has no tuple for it (§2.2's join table: the «Others» bar reads null). §2.4's answer
      // for a category with no declaration to point at is the absent plan, on a dimension
      // axis only — the same sparse rule the rows above follow.
      ...(isDim ? { plan: ABSENT_ROW_PLAN } : null),
    };
    cats = [...top.map(({ _e, ...c }) => c), others];
  } else {
    cats = cats.map(({ _e, ...c }) => c);
  }
  // …and NOW the leftovers sink, under the fold and above the remainder — the rank the table
  // beside the ring draws (Breakdown.jsx:536). It happens after the fold rather than before it
  // for the reason the mark's own note gives: the tail is chosen by size, and a leftover held
  // out of that choice would take a real value into «Other values» in its place. Stable, so
  // two leftovers keep the order the ranking gave them.
  if (cats.some((c) => c.leftover)) {
    cats = [...cats.filter((c) => !c.leftover), ...cats.filter((c) => c.leftover)];
  }
  // …and the remainder after the fold: the fold holds real values of this dimension, and this
  // holds the delivery that carries none, so it is the furthest thing from a value here.
  if (residualCat) {
    cats = [...cats, {
      label: residualCat.label, ...(request.identities ? { highlightKey: residualCat.highlightKey } : null),
      values: evalEntity(residualCat),
      residual: true,
      // …and the remainder carries delivery this dimension never tagged, which is further
      // from a value than the fold is. No tuple, no declaration, the absent plan (§2.4).
      plan: ABSENT_ROW_PLAN,
    }];
  }
  // `fieldSet` rides out beside the window's plan because §2.4's first gate is taken one file
  // over, on the chart's own cut: a cm-bearing series that names `planImpr` on a `ds:` axis is
  // a series error there, and report-render.js has no other way to ask what this cut carries.
  return { categories: cats, errors, windowScalars, fieldSet };
}

/**
 * One aggregate reading: `{ value, warned }`, where `value` is NULL when the expression has
 * nothing to answer with (sections-to-widgets M3; widened 2026-09-04).
 *
 * Two shapes can answer nothing, and both are about the WHOLE expression rather than an
 * operand inside it:
 *
 *   · **a bare field** the context has nothing for. The only fields that can are the three
 *     weighted campaign targets: a KPI asking for `ctrT` on a pacing that set no CTR target
 *     gets no number and therefore no chip, while `ctrT * 2` — where the field is an OPERAND
 *     — keeps the absence-is-zero canon, because arithmetic has to be done on numbers.
 *   · **a RATIO whose denominator is 0** (section-widget parity, Targets). `costBudTotal /
 *     planClicks` on a campaign that plans no clicks is not a target of `$0.00`; it is the
 *     same statement the bare-field arm already makes, one shape over. The legacy Targets
 *     band says it in as many words — `planClicks > 0 ? costBudTotal / planClicks : null`
 *     (KpiPlanFact.jsx:149) — and without this the tile drew a confident red delta against a
 *     goal nobody set. The ROOT only: `cv / cl * 100` is a multiplication whose left operand
 *     happens to divide, and an operand keeps the absence-is-zero canon like any other.
 *
 *     Plan fields follow a narrowed window (2026-09-23), so a window before a line starts can
 *     now hold a plan of 0 where the flight never did. `cl / planClicks` there reads nothing;
 *     `cl / planClicks * 100` keeps this canon's 0, as it always has on a pacing that plans
 *     no clicks. Widening the rule is a separate decision, not taken here.
 *
 * Neither carries `warned`: nothing was coerced, the question simply does not apply.
 *
 * WHO THIS REACHES, stated because the first version of this note got it wrong (fix round 1,
 * 2026-09-04): `kpiValue` is read by a KPI's value AND its target, by every chart GUIDE and
 * chart target (`aggReading` → report-render.js), and by every Layout brick bind
 * (brick-data.js). All of them answer «nothing» the same way — no chip, no line, an em dash —
 * which is the point: one canon, or the same expression means two things one view apart.
 * Guides are pinned in tests/report-render-test.mjs beside the bare-field case.
 */
function aggRead(expr, ctx) {
  const ast = parse(expr).ast;
  // Primary conversions (spec §3): a reading that names a conversion field over a line item
  // whose conversions are unavailable has no number, bare or inside arithmetic. Asked only of
  // an expression that names one, so no other reading pays for it.
  if (ctx.cvUnavailable && astNamesAny(ast, CV_FIELDS) && ctx.cvUnavailable()) {
    return { value: null, warned: false };
  }
  if (ast.t === 'id' && ctx.get(ast.name) == null) return { value: null, warned: false };
  if (ast.t === 'bin' && ast.op === '/' && evaluateOne(ast.r, ctx).value === 0) {
    return { value: null, warned: false };
  }
  return evaluateOne(ast, ctx);
}

// useWidgetData supplies immutable snapshots. Keep their private aggregate alive
// across brick/value/target reads, with a bounded set of windows per snapshot.
// Plain mutable callers remain uncached; no derived object escapes this context.
const aggregateContexts = new WeakMap();
const AGGREGATE_WINDOWS = 4;

function campaignReadingContext(sources, range) {
  let cache;
  const key = range ? JSON.stringify([range.from, range.to]) : '__all__';
  if (Object.isFrozen(sources)) {
    cache = aggregateContexts.get(sources);
    if (!cache) { cache = new Map(); aggregateContexts.set(sources, cache); }
    if (cache.has(key)) return cache.get(key);
  }
  // A caller may reuse and edit its range object after this read.
  const window = range ? { from: range.from, to: range.to } : null;
  let scalars, expected, sums, rates, cvOffAny;
  // The window's delivered sums, built on first ask and kept. Each line's impressions go to
  // `impr` on the way, the CTR target's weight, so the target and the value share one walk.
  const impr = lineImpr(sources, window);
  const factSums = () => {
    if (!sums) {
      sums = sources.effLIs.reduce((t, id) => {
        const p = sources.liPlan[id];
        if (p) {
          const lineSums = sumLiWindow(sources.liDaily, p, id, window, null);
          impr.seed(id, lineSums.im);
          addRowSums(t, lineSums);
        }
        return t;
      }, { ...ZERO_FLOW });
    }
    return sums;
  };
  // The window's plan, built on first ask and kept. Both readers below go through this one
  // line, so a plan field read through `get` and the whole object handed out by `scalars()`
  // are the same instance rather than two computations of the same question. Its ctrT is the
  // one field that reads the facts, and only when it is read (campaignScalars).
  const windowPlan = () => (scalars ||= campaignScalars(sources.liPlan, sources.effLIs,
    sources.asOf, sources.flightStart, sources.flightEnd, window, false, planWindowOf(sources, window),
    (id) => { factSums(); return impr(id); }));
  // Primary conversions (spec §3): is any line item in view unavailable in this window?
  const cvUnavailable = () => {
    if (cvOffAny === undefined) cvOffAny = cvOffIds(sources, sources.effLIs, window).length > 0;
    return cvOffAny;
  };
  const ctx = {
    cvUnavailable,
    get(name) {
      if (FIELDS_PLAN.has(name)) return windowPlan()[name];
      if (FIELDS_EXPECTED.has(name)) {
        if (!expected) {
          expected = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0 };
          const bounds = expectedBounds(sources, window);
          for (const id of sources.effLIs) {
            const p = sources.liPlan[id];
            if (!p) continue;
            const e = expectedDeltas(p, bounds.from, bounds.to);
            for (const field of FIELDS_EXPECTED) expected[field] += e[field] || 0;
          }
        }
        return expected[name];
      }
      if (!FIELDS_DAILY.has(name) && !FIELDS_RATES.has(name)) return null;
      if (CV_FIELDS.has(name) && cvUnavailable()) return null;
      factSums();
      if (FIELDS_RATES.has(name)) {
        rates ||= ratesFromSums(sums, 'agg');
        return rates[name];
      }
      return sums[name];
    },
    /** The window's plan scalars, forced. They are a lazy private here — built only when an
     *  expression names a plan field — and the CM360 second pass needs the SAME instance the
     *  KPI's own numbers were read from (§2.4: the window's scalars are one function, never a
     *  second computation standing beside the first). */
    scalars() {
      return windowPlan();
    },
  };
  if (cache) {
    cache.set(key, ctx);
    if (cache.size > AGGREGATE_WINDOWS) cache.delete(cache.keys().next().value);
  }
  return ctx;
}

/** The window's plan scalars for a widget's own scoped sources — the ONE function §2.4 names
 *  for a WINDOW reading, shared with `kpiValue` through the cached campaign context, so a KPI
 *  whose value is a CM360 formula (and is therefore never evaluated here) still reads the plan
 *  its neighbours read. Null with no sources: a tile with nothing to read has no plan either. */
export function campaignWindowScalars(range, sources) {
  return sources ? campaignReadingContext(sources, range).scalars() : null;
}

const highlightAggregateCache = new WeakMap();
export function kpiHighlightValue(expr, range, sources) {
  if (!sources || !sources.effLIs?.length) return { value: null, error: 'Data unavailable' };
  const validation = validate(expr, 'agg', AGG_FIELDS);
  if (!validation.ok) return { value: null, error: formulaSay(validation) };
  const unavailable = unavailableMetric({ kind: 'formula', expr }, sources, null);
  if (unavailable) return { value: null, error: unavailable };
  const cacheable = Object.isFrozen(sources);
  let windows = cacheable ? highlightAggregateCache.get(sources) : null;
  if (!windows) { windows = new Map(); if (cacheable) highlightAggregateCache.set(sources, windows); }
  const key = JSON.stringify(range || null);
  let ctx = windows.get(key);
  if (!ctx) {
    const bounds = expectedBounds(sources, range);
    const impr = lineImpr(sources, range);
    const sums = (sources.effLIs || []).reduce((total, id) => {
      const plan = sources.liPlan[id];
      if (plan) {
        const lineSums = sumLiWindow(sources.liDaily, plan, id, range, bounds);
        impr.seed(id, lineSums.im);
        addRowSums(total, lineSums);
      }
      return total;
    }, { ...ZERO_FLOW });
    const scalars = campaignScalars(sources.liPlan, sources.effLIs, sources.asOf,
      sources.flightStart, sources.flightEnd, range, false, planWindowOf(sources, range), impr);
    sums.__highlightFacts = highlightHasFacts(sources, range);
    // An explicit null is what `highlightFieldValue` and the highlight evaluator already read as
    // «no reading», so no conditional style can match an unknown conversion number.
    if (cvOffIds(sources, sources.effLIs, range).length) { sums.cv = null; sums.pc = null; sums.pv = null; }
    ctx = aggCtx(sums, scalars, 'agg', true);
    windows.set(key, ctx);
    if (windows.size > 16) windows.delete(windows.keys().next().value);
  }
  return evaluateHighlightOne(parse(expr).ast, ctx);
}

export function kpiValue(widget, range, sources) {
  const v = validate(widget.expr, 'agg', AGG_FIELDS);
  if (!v.ok) return { value: 0, warned: true, error: formulaSay(v) };
  const ctx = campaignReadingContext(sources, range);
  const r = aggRead(widget.expr, ctx);
  const out = { value: r.value, warned: r.warned };
  if (widget.target?.expr) {
    const tv = validate(widget.target.expr, 'agg', AGG_FIELDS);
    if (tv.ok) {
      const t = aggRead(widget.target.expr, ctx);
      out.target = t.value;
      // Both halves have to be numbers for a distance between them to mean anything —
      // `null - 5` is −5 in JS, which would print a confident delta against a target
      // that is not there.
      out.delta = r.value == null || t.value == null ? null : r.value - t.value;
      out.warned = out.warned || t.warned;
    } else {
      out.error = tv.error;
    }
  }
  return out;
}

/**
 * grossAgg(expr, range, sources) → number|null — the GROSS twin of a client money
 * aggregate (net cost mode, spec §7), over the SAME line items and the SAME window
 * kpiValue reads. Every `dc` in this file is already net (the per-LI ratio `k` is
 * applied at aggregation, normalize.js), so gross is net / k, summed per line.
 *
 * Only the two client-money expressions have a gross twin. Media money (`sp`) is what
 * the LI cost to buy and has none; so does every unit and rate. `null` — not 0 — is how
 * a brick learns there is no second line to draw.
 *
 * `k` comes from the RAW plan wherever `sources` carries one: the virtual plans period
 * scope and dim scope hand over enumerate their fields explicitly and DROP `k` (as they
 * drop `coef`), which would silently collapse gross back onto net. Same rule, and the
 * same reason, as metrics.js:137. The BUDGET, in contrast, is deliberately the effective
 * (scoped) one — that is the number the window is actually about.
 *
 * `budget` follows a narrowed window exactly as the `budget` field beside it does
 * (planWindowOf, 2026-09-23), or the gross twin would stand on the whole flight under a
 * windowed net figure. `budgetTotal`, the whole flight's client budget, has a gross twin of
 * its own, and it never follows the window. `budgetToDate` (2026-09-23) is client money too:
 * its twin is each line's plan to date over the same days, over that line's own `k`.
 */
export function grossAgg(expr, range, sources) {
  if (expr !== 'budget' && expr !== 'budgetTotal' && expr !== 'budgetToDate' && expr !== 'dc') return null;
  const bounds = calendarBounds(sources, range);
  const planWindow = expr === 'budget' ? planWindowOf(sources, range) : null;
  let sum = 0;
  for (const id of sources.effLIs || []) {
    const p = sources.liPlan[id];
    if (!p) continue;
    const raw = sources.rawLiPlan?.[id] || p;
    const k = (raw.k > 0 && raw.k < 1) ? raw.k : 1;
    if (expr === 'budget') sum += (planWindow ? budgetInWindow(p, planWindow) : (p.budget || 0)) / k;
    else if (expr === 'budgetTotal') sum += (p.budget || 0) / k;
    else if (expr === 'budgetToDate') sum += budgetToDate(p, range, sources.asOf) / k;
    else sum +=(sumLiWindow(sources.liDaily, p, id, range, bounds).dc || 0) / k;
  }
  return sum;
}

/**
 * chartTargetSpec(widget, range, sources) → { value, axis } | null — the reference
 * line for a custom chart (round 8). Evaluated in the SAME window/currency context
 * as the series (kpiValue over the widget's effective range). Returns null — no
 * line — when the expr is absent/invalid, non-finite, or <= 0: the div-by-zero
 * canon yields 0 for a plan-less target, and the built-ins deliberately draw no
 * line rather than a misleading floor line. The axis is
 * the FIRST series' axis — a target annotates the series it is read against; the
 * old hardcoded left pin drew right-axis targets on the wrong scale.
 */
export function chartTargetSpec(widget, range, sources) {
  if (!widget?.target?.expr) return null;
  const out = kpiValue({ kind: 'kpi', expr: widget.target.expr }, range, sources);
  if (out.error || !Number.isFinite(out.value) || out.value <= 0) return null;
  const axis = widget.series?.[0]?.axis === 'right' ? 'right' : 'left';
  return { value: out.value, axis };
}

/**
 * windowFactCount(sources, range) — number of LI-days with REAL delivered facts in
 * the window. 0 → the widget renders an honest "no data yet" state instead of a
 * zero line / a wall of $0.00 rows (round 6.1, prelaunch case).
 */
export function windowFactCount(sources, range) {
  const bounds = calendarBounds(sources, range);
  if (!bounds.from || !bounds.to) return 0;
  // A conversion-only day row (spec 2026-09-13 §3 "Days") is not a delivered fact: a window
  // holding only conversions keeps its honest "no data yet" state.
  const cvOnly = sources.liDaily ? cvOnlyDaysOf(sources.liDaily) : null;
  let n = 0;
  for (const id of sources.effLIs) {
    const p = sources.liPlan[id];
    const dd = sources.liDaily[id] || {};
    const skip = cvOnly && cvOnly[id];
    for (const d of Object.keys(dd)) {
      if (d < bounds.from || d > bounds.to) continue;
      // clip to the LI's flight exactly like every aggregation does — facts the
      // model discards must not flip the empty state (round 7)
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (skip && skip.has(d)) continue;
      n++;
    }
  }
  return n;
}

/**
 * resolveTimeScope(widget, periodState) — the round-8 time pin as a PURE function
 * (round 9: the world-switch lived inline in the React hook with zero coverage).
 * 'absolute' opts the widget out of period scope WHOLESALE — window and plans must
 * switch together, or a current window against period virtual plans (or vice
 * versa) mixes two worlds. Any other value follows the period.
 */
export function resolveTimeScope(widget, { splitScopedMode, splitScopedPlans, selectedPeriodKey }) {
  if (widget?.scope?.time === 'absolute') {
    return { periodMode: false, periodPlans: null, periodKey: null };
  }
  return {
    periodMode: splitScopedMode,
    periodPlans: splitScopedPlans,
    periodKey: selectedPeriodKey,
  };
}

/**
 * Classify the engine expressions a canonical view resolved. This neutral helper knows
 * formula fields only; it has no stored-widget kind dispatch.
 */
export function expressionFieldKinds(expressions) {
  const factFields = new Set([...FIELDS_DAILY, ...FIELDS_RATES]);
  const planFields = new Set([...FIELDS_PLAN, ...FIELDS_EXPECTED]);
  const out = { fact: false, plan: false };
  const scan = (src) => {
    if (!src) return;
    try {
      (function walk(n) {
        if (!n) return;
        if (n.t === "id") {
          if (factFields.has(n.name)) out.fact = true;
          if (planFields.has(n.name)) out.plan = true;
          return;
        }
        if (n.t === "call") n.args.forEach(walk);
        else if (n.t === "bin" || n.t === "cmp") { walk(n.l); walk(n.r); }
        else if (n.t === "neg") walk(n.e);
      })(parse(src).ast);
    } catch { out.fact = true; }
  };
  for (const expression of expressions || []) scan(expression);
  return out;
}

/** True when every resolved expression reads delivered facts and no plan field. */
export function expressionsShowEmptyWithoutFacts(expressions) {
  const kinds = expressionFieldKinds(expressions);
  return kinds.fact && !kinds.plan;
}
