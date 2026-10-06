import PacingCore from './pacing-core.js';
import { dI, datePrev, rangeOverlap } from './date-utils.js';

// === Memoization ===
//
// PacingCore.liExpUnits / liExpCost / liExpClicks each call parseContainers
// internally — an O(containers × children) walk that rebuilds activity tables.
// Without memoization, a single dashboard render hits these millions of
// times: 5 charts × ~365 dates × ~50 LIs × 3 fns + per-LI prorate calls.
// That was the source of the Period Scope freeze.
//
// All keys are plan-object identity. Plan objects are stable:
//   - raw liPlan[id] is replaced wholesale on store.load / saveSettings
//     (normalize/normalizePlan returns a fresh LP object)
//   - virtual scoped plans come out of buildScopedPlansForPeriod's WeakMap
//     cache — stable per (liPlan, periodKey)
// When a plan is replaced, the old object becomes unreachable and the
// WeakMap entry is GC'd.
//
// invalidatePlanCalcCache() bumps a revision and resets every cache; used
// only if a caller mutates a plan in place (we don't, but the hook stays).

let _liExpUnitsCache = new WeakMap();
let _liExpCostCache = new WeakMap();
let _liExpClicksCache = new WeakMap();
let _prorateCache = new WeakMap();
let _prorateRangeCache = new WeakMap();
let _planContainerDataCache = new WeakMap();
let _planContainerDataRev = 0;
let _clientSpendPlanCache = new WeakMap();

export function invalidatePlanCalcCache() {
  _planContainerDataRev++;
  _liExpUnitsCache = new WeakMap();
  _liExpCostCache = new WeakMap();
  _liExpClicksCache = new WeakMap();
  _prorateCache = new WeakMap();
  _prorateRangeCache = new WeakMap();
  _planContainerDataCache = new WeakMap();
  _clientSpendPlanCache = new WeakMap();
}

export function getPlanContainerData(plan) {
  if (!plan) return null;
  const cached = _planContainerDataCache.get(plan);
  if (cached && cached.rev === _planContainerDataRev) return cached.data;
  const data = PacingCore.parseContainers(plan);
  _planContainerDataCache.set(plan, { rev: _planContainerDataRev, data });
  return data;
}

function memoDate(cache, fn, plan, d) {
  if (!plan) return fn(plan, d);
  let perPlan = cache.get(plan);
  if (!perPlan) { perPlan = new Map(); cache.set(plan, perPlan); }
  if (perPlan.has(d)) return perPlan.get(d);
  const v = fn(plan, d);
  perPlan.set(d, v);
  return v;
}

export function liExpUnits(plan, d) {
  return memoDate(_liExpUnitsCache, PacingCore.liExpUnits, plan, d);
}
export const liExpImpr = liExpUnits;

export function liExpCost(plan, d) {
  return memoDate(_liExpCostCache, PacingCore.liExpCost, plan, d);
}

export function liExpClicks(plan, d) {
  return memoDate(_liExpClicksCache, PacingCore.liExpClicks, plan, d);
}

export function prorate(plan, asOf) {
  if (!plan) return { costPr: 0, tp: 0, eI: 0, fDays: 0, dP: 0, st: 'no_data' };
  let perPlan = _prorateCache.get(plan);
  if (!perPlan) { perPlan = new Map(); _prorateCache.set(plan, perPlan); }
  const key = asOf || '__null__';
  if (perPlan.has(key)) return perPlan.get(key);

  let v;
  const fd = Math.max(1, dI(plan.fs, plan.fe));
  if (!asOf) {
    // fDays is calendar-only — report it even with no facts (mirrors
    // PacingCore.prorate) so "days left" reads the flight, not 0.
    v = { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_data' };
  } else {
    if (asOf < plan.fs) {
      v = { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'not_started' };
    } else {
      const eff = asOf > plan.fe ? plan.fe : asOf;
      const dp = dI(plan.fs, eff);
      const tp = dp / fd;
      const eI = liExpUnits(plan, asOf);
      const costPr = liExpCost(plan, asOf);
      v = { costPr, tp, eI, fDays: fd, dP: dp, st: asOf > plan.fe ? 'ended' : 'active' };
    }
  }
  perPlan.set(key, v);
  return v;
}

export function cachedProrateRange(plan, range, asOf) {
  if (!plan) return { costPr: 0, tp: 0, eI: 0, fDays: 0, dP: 0, st: 'no_data' };
  if (!range) return prorate(plan, asOf);
  let perPlan = _prorateRangeCache.get(plan);
  if (!perPlan) { perPlan = new Map(); _prorateRangeCache.set(plan, perPlan); }
  const key = `${range.from}|${range.to}|${asOf || ''}`;
  if (perPlan.has(key)) return perPlan.get(key);

  const fd = Math.max(1, dI(plan.fs, plan.fe));
  const ovlp = rangeOverlap(range.from, range.to, plan.fs, plan.fe);
  let v;
  if (!ovlp) {
    v = { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_overlap' };
  } else if (!asOf) {
    // Mirrors PacingCore.prorateRange (2026-07-11 asOf clamp): expected never
    // runs ahead of the data edge. Keep the two copies in lockstep.
    v = { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_data' };
  } else if (asOf < ovlp.start) {
    v = { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'not_started' };
  } else {
    const expThrough = asOf < ovlp.end ? asOf : ovlp.end;
    const expEnd = liExpUnits(plan, expThrough);
    const expBefore = ovlp.start > plan.fs ? liExpUnits(plan, datePrev(ovlp.start)) : 0;
    const eI = expEnd - expBefore;
    const costEnd = liExpCost(plan, expThrough);
    const costBefore = ovlp.start > plan.fs ? liExpCost(plan, datePrev(ovlp.start)) : 0;
    const costPr = costEnd - costBefore;
    const dP = dI(plan.fs, expThrough);
    v = { costPr, tp: dP / fd, eI, fDays: fd, dP, st: 'active' };
  }
  perPlan.set(key, v);
  return v;
}

/**
 * The campaign's own flight (2026-09-29): from the earliest start to the latest end of
 * `plans`. `days` is its length; `passed` the days of it through the last data day, inside
 * `range` when one is given (the rule prorateRange keeps for one line); `left` the days after
 * the last data day until the latest end, whatever the range. The campaign is over only when
 * its last line is: the average of the lines' own days left read «Flight ended» on a pacing
 * whose last two of fourteen lines still had three days to go. Counted like prorate: calendar
 * days, both ends included.
 */
export function campaignSpan(plans, asOf, range = null) {
  let fs = '', fe = '';
  for (const p of plans) {
    if (!p || !p.fs || !p.fe) continue;
    if (!fs || p.fs < fs) fs = p.fs;
    if (!fe || p.fe > fe) fe = p.fe;
  }
  if (!fs) return { fs: null, fe: null, days: 0, passed: 0, left: 0 };
  const days = Math.max(1, dI(fs, fe));
  const toDate = asOf && asOf >= fs ? dI(fs, asOf < fe ? asOf : fe) : 0;
  let passed = toDate;
  if (range) {
    const ov = rangeOverlap(range.from, range.to, fs, fe);
    passed = ov && asOf && asOf >= ov.start ? dI(fs, asOf < ov.end ? asOf : ov.end) : 0;
  }
  return { fs, fe, days, passed, left: Math.max(0, days - toDate) };
}

/* ── Plan inside a narrowed window (2026-09-23) ───────────────────────────────
 * When the viewer narrows the date window, a widget's PLAN follows it the way its delivered
 * numbers already do. The plan of a window is the part of the line's plan curve that falls
 * in [range.from .. range.to], clipped to the line's flight: the SAME curve expected delivery
 * reads (liExpUnits / liExpCost: containers, date children, pauses), read to the window END.
 * Unlike cachedProrateRange's expected half it is never capped at asOf: a Custom window that
 * runs past the last data day still plans its later days.
 *
 * Consecutive windows add up to the curve's value at flight end. That is `planImpr` exactly
 * whenever the curve reaches it; it falls short of it in two cases, both of which expected
 * delivery shares: a pause (its days plan nothing), and containers that cover every day of
 * the flight while their targets add up to less than the line's plan (the remainder has no
 * uncovered day to be spread over). Flight itself keeps reading the line's own `planImpr`. */
function windowOverlap(plan, range) {
  if (!plan || !range || !range.from || !range.to || !plan.fs || !plan.fe) return null;
  return rangeOverlap(range.from, range.to, plan.fs, plan.fe);
}

/** Planned units (the line's rate-type unit) inside the window; 0 with no overlap. */
export function unitsInWindow(plan, range) {
  const o = windowOverlap(plan, range);
  if (!o) return 0;
  return liExpUnits(plan, o.end) - (o.start > plan.fs ? liExpUnits(plan, datePrev(o.start)) : 0);
}

/** Planned cost (the margin-net cost curve) inside the window; 0 with no overlap. */
export function costInWindow(plan, range) {
  const o = windowOverlap(plan, range);
  if (!o) return 0;
  return liExpCost(plan, o.end) - (o.start > plan.fs ? liExpCost(plan, datePrev(o.start)) : 0);
}

/**
 * The line with every margin set to 0 — the line, its parts and their date children. Its cost
 * curve is then the CLIENT's money curve: a part's own spend (containerSpendEff: its
 * target_spend, else its units' share of the budget), a date child's share of its part, and
 * the rest of the budget over the days no part covers. Memoised per plan object, so the curve
 * reads below share liExpCost's per-plan cache. `total` is that curve at flight end with no
 * pause taken out: whether the line has any client money on the curve at all.
 */
function clientSpendPlan(plan) {
  let v = _clientSpendPlanCache.get(plan);
  if (!v) {
    const twin = {
      ...plan,
      mTgt: 0,
      containers: Array.isArray(plan.containers) ? plan.containers.map((c) => (c && typeof c === 'object' ? {
        ...c,
        margin_percent: 0,
        date_children: Array.isArray(c.date_children)
          ? c.date_children.map((d) => (d && typeof d === 'object' ? { ...d, margin_percent: 0 } : d))
          : c.date_children,
      } : c)) : plan.containers,
    };
    v = { plan: twin, total: PacingCore.liExpCostRaw(twin, plan.fe) };
    _clientSpendPlanCache.set(plan, v);
  }
  return v;
}

/**
 * The client budget inside the window: the client's money the window plans. It is the
 * client-spend curve (clientSpendPlan) read over the window, the way unitsInWindow reads the
 * units curve — never the media COST curve. The client pays one rate every month, so a part
 * with a higher margin (less cost per impression) must not get less of the budget: shared by
 * cost, a 1.2M part at 60% margin on a 2.8M line read $9,000 where selecting it as a period
 * reads $12,857.14 (review 2026-09-23). Read this way, a part or date child whose window is
 * selected reads exactly the budget period scope gives it (buildVirtualPlanFromContainer /
 * FromDateChild), and a window's budget over its units is the line's own client rate.
 *
 * Consecutive windows add up to the curve at flight end, which is the whole budget unless the
 * units curve falls short of `planImpr` too: a pause takes its days out, and parts covering
 * every day with targets short of the plan leave the rest with no day to fall on (3 × 900k
 * of 3M reads $27,000 over the whole flight, as its units read 2.7M). Flight keeps the line's
 * own budget. A curve with no money on it at all (a malformed line whose parts cover every
 * day with no spend) takes the calendar share of the flight.
 */
export function budgetInWindow(plan, range) {
  const budget = Number(plan && plan.budget) || 0;
  if (!budget) return 0;
  const o = windowOverlap(plan, range);
  if (!o) return 0;
  const money = clientSpendPlan(plan);
  if (money.total > 0) {
    return liExpCost(money.plan, o.end) - (o.start > plan.fs ? liExpCost(money.plan, datePrev(o.start)) : 0);
  }
  return budget * dI(o.start, o.end) / Math.max(1, dI(plan.fs, plan.fe));
}

/**
 * The client's plan TO DATE (2026-09-23): budgetInWindow read from the window's first day
 * (the line's flight start with no window) to its last day or asOf, whichever comes first.
 * 0 before any data (no asOf) and for a window that starts after asOf, the rule expected
 * delivery keeps (widget-data expectedBounds, cachedProrateRange above). The same days
 * `costBud` covers, read on the client money curve instead of the cost curve.
 *
 * Read line by line, never as a cost plan over one margin. The Finance cell was
 * `costBud / (1 - mTgt / 100)` over the campaign's budget-weighted margin, which is the
 * client's money only while every line and part carries the same margin: on the plan-window
 * worked example (a 30% line with a 25% part beside a 25% line) it read +2% on Flight.
 */
export function budgetToDate(plan, range, asOf) {
  if (!plan || !asOf) return 0;
  const from = range ? range.from : plan.fs;
  const end = range ? range.to : plan.fe;
  if (!from || !end) return 0;
  const to = end < asOf ? end : asOf;
  if (from > to) return 0;
  return budgetInWindow(plan, { from, to });
}

export const liActualUnits = PacingCore.liActualUnits;

export function marginStatus(actual, target, warnThreshold) {
  return PacingCore.marginStatus(actual, target, warnThreshold);
}

export function pacingStatus(imbalance, lowThreshold, highThreshold) {
  return PacingCore.pacingStatus(imbalance, lowThreshold, highThreshold);
}
