// workspace/src/lib/dashboard/metrics.js
import PacingCore from './pacing-core.js';
import { zeroRow, addRow } from './row-utils.js';
import { prorate, cachedProrateRange, liActualUnits, liExpUnits, liExpClicks, unitsInWindow, budgetInWindow, budgetToDate } from './pacing-calc.js';
import { datePrev, dI } from './date-utils.js';
import { getEffPlan } from './config.js';
import { freezeDev } from './freeze-dev.js';
import { CV, cvOnlyDaysOf, cvStateOf, isCvUnavailable, isInView } from './primary-cv.js';

const DEFAULT_SCOPE_REF = {};
const sumLiCache = new WeakMap();
const liMetricsCache = new WeakMap();
const campMetricsCache = new WeakMap();

function getScopeRef(splitScopedMode, splitScopedPlans) {
  return splitScopedMode && splitScopedPlans ? splitScopedPlans : DEFAULT_SCOPE_REF;
}

function getScopedCache(root, liDaily, liPlan, splitScopedMode, splitScopedPlans) {
  let byDaily = root.get(liDaily);
  if (!byDaily) {
    byDaily = new WeakMap();
    root.set(liDaily, byDaily);
  }

  let byPlan = byDaily.get(liPlan);
  if (!byPlan) {
    byPlan = new WeakMap();
    byDaily.set(liPlan, byPlan);
  }

  const scopeRef = getScopeRef(splitScopedMode, splitScopedPlans);
  let scoped = byPlan.get(scopeRef);
  if (!scoped) {
    scoped = new Map();
    byPlan.set(scopeRef, scoped);
  }

  return scoped;
}

function rangeKey(range) {
  return range ? `${range.from}:${range.to}` : '__all__';
}

function metricKey(asOf, range) {
  return `${asOf || ''}|${rangeKey(range)}`;
}

export function sumLI(liId, liDaily, liPlan, range, splitScopedMode, splitScopedPlans) {
  if (!liDaily || !liPlan) return freezeDev(zeroRow());

  const scopedCache = getScopedCache(sumLiCache, liDaily, liPlan, splitScopedMode, splitScopedPlans);
  const key = rangeKey(range);
  let byRange = scopedCache.get(key);
  if (!byRange) {
    byRange = new Map();
    scopedCache.set(key, byRange);
  }

  if (byRange.has(liId)) return byRange.get(liId);

  const dd = liDaily[liId] || {};
  const p = getEffPlan(liPlan, liId, splitScopedMode, splitScopedPlans);
  const t = zeroRow();
  for (const [d, v] of Object.entries(dd)) {
    if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
    if (range && (d < range.from || d > range.to)) continue;
    addRow(t, v);
  }
  const result = freezeDev(t);
  byRange.set(liId, result);
  return result;
}

export function sumSp(liId, sk, liSplitDaily, liPlan, range) {
  const dd = (liSplitDaily[liId] || {})[sk] || {};
  const p = liPlan[liId];
  const t = zeroRow();
  for (const [d, v] of Object.entries(dd)) {
    if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
    if (range && (d < range.from || d > range.to)) continue;
    addRow(t, v);
  }
  return t;
}

export function liM(liId, liDaily, liPlan, asOf, range, splitScopedMode, splitScopedPlans) {
  if (!liDaily || !liPlan) return null;

  const scopedCache = getScopedCache(liMetricsCache, liDaily, liPlan, splitScopedMode, splitScopedPlans);
  const key = metricKey(asOf, range);
  let byMetric = scopedCache.get(key);
  if (!byMetric) {
    byMetric = new Map();
    scopedCache.set(key, byMetric);
  }

  if (byMetric.has(liId)) return byMetric.get(liId);

  const p = getEffPlan(liPlan, liId, splitScopedMode, splitScopedPlans);
  if (!p) return null;
  const t = sumLI(liId, liDaily, liPlan, range, splitScopedMode, splitScopedPlans);
  const pr = range ? cachedProrateRange(p, range, asOf) : prorate(p, asOf);

  // Expected clicks for the same window as pr.eI (range-aware).
  let eCl = 0;
  if (asOf && pr && (pr.st === 'active' || pr.st === 'ended')) {
    if (!range) {
      eCl = liExpClicks(p, asOf);
    } else {
      // pacing-calc's cachedProrateRange already clipped to overlap; replicate
      // the same logic for clicks here.
      const fs = p.fs, fe = p.fe, rf = range.from, rt = range.to;
      const ovStart = rf > fs ? rf : fs;
      // …and never past asOf: expected does not run ahead of the last data day (the rule
      // pr.eI above already obeys through prorateRange). A window running past asOf — a
      // Custom range, a Timeline segment, a Journal jump — counted clicks nobody expected yet.
      const ovEndFlight = rt < fe ? rt : fe;
      const ovEnd = asOf < ovEndFlight ? asOf : ovEndFlight;
      if (ovStart <= ovEnd) {
        const endVal = liExpClicks(p, ovEnd);
        const beforeVal = ovStart > fs ? liExpClicks(p, datePrev(ovStart)) : 0;
        eCl = endVal - beforeVal;
      }
    }
  }

  const mA = PacingCore.margin(t.dc, t.sp);
  const au = liActualUnits(p, t);
  const pI = PacingCore.pacingIndex(au, pr.eI, p.planImpr);
  const ctr = t.im > 0 ? (t.cl / t.im) * 100 : 0;
  const vcr = t.co > 0 && t.im > 0 ? (t.co / t.im) * 100 : 0;
  // Primary conversions (spec 2026-09-13 §3 "Unavailable, as a value"): a line item whose
  // conversion group cannot be answered for this day map reads null, never 0, and so does
  // every ratio built on it. The overlay already zeroed its cv/pc/pv rows, so the sums
  // above are safe numbers; only the published values change. Not operative: no state,
  // cvOff is false and every value and key position is today's.
  const cvOff = isCvUnavailable(liDaily, liId);
  const cvr = cvOff ? null : (t.cl > 0 ? (t.cv / t.cl) * 100 : 0);
  const cpm = t.im > 0 ? (t.sp / t.im) * 1000 : 0;
  // Net cost mode: t.dc is already NET (the per-LI ratio was applied at
  // aggregation), so the GROSS twin is net / k. k is read from the RAW plan, not
  // from p: the virtual plans getEffPlan returns in period/container scope
  // enumerate their fields explicitly and drop k (same as they drop coef), which
  // would collapse gross back onto net. The budget stays the effective (scoped) one.
  const rawPlan = liPlan[liId];
  const k = (rawPlan && rawPlan.k > 0 && rawPlan.k < 1) ? rawPlan.k : 1;
  // The trailing spread overwrites values in place: cv/pc/pv keep the key positions `t` gave them.
  const result = freezeDev({ ...t, ...pr, mA, pI, au, ctr, vcr, cvr, cpm, clientPr: t.dc, eCl,
    k, clientPrGross: t.dc / k, budGross: p.budget / k,
    ...(cvOff ? { cv: null, pc: null, pv: null } : null) });
  byMetric.set(liId, result);
  return result;
}

export function domRateType(liPlan, eIds) {
  const c = { CPM: 0, CPC: 0, CPV: 0, CPI: 0 };
  for (const id of eIds) { c[liPlan[id]?.rateType || 'CPM']++; }
  // CPI is asked first and on a STRICT majority, which is what keeps every pacing without an
  // install-paced line byte-identical to the three-way answer below: with `c.CPI` at 0 the
  // test is false unless every other count is 0 too, and that is the empty set the old chain
  // already answered 'CPC' for. A tie between CPI and another unit therefore goes to the
  // other one, the same way the chain below hands ties to the earlier unit.
  if (c.CPI > c.CPM && c.CPI > c.CPC && c.CPI > c.CPV) return 'CPI';
  return c.CPC >= c.CPM && c.CPC >= c.CPV ? 'CPC' : c.CPV >= c.CPM && c.CPV >= c.CPC ? 'CPV' : 'CPM';
}

export function rateLabel(rt) {
  return rt === 'CPC' ? 'Clicks' : rt === 'CPV' ? 'Views' : rt === 'CPI' ? 'Installs' : 'Impressions';
}

// LI participates in VCR aggregation if it has a VCR target OR any completed views.
// Used by campM (KPI card), buildChartData (VCR timeline), Breakdown/DailyTable
// gating — so display + video LIs don't get blended into a meaningless average.
// Audio is excluded outright: its "completes" are listen-throughs and its vcrTgt
// is an ACR target by design (KpiPlanFact ACR card computes its own numbers).
export function isVcrEligible(plan, daily) {
  if (plan && (plan.ch || '').toLowerCase() === 'audio') return false;
  if (plan && plan.vcrTgt != null && Number.isFinite(plan.vcrTgt) && plan.vcrTgt > 0) return true;
  if (!daily) return false;
  for (const v of Object.values(daily)) {
    if ((v.co || 0) > 0) return true;
  }
  return false;
}

// Views goal — STRICTLY a per-CPV-line-item concept. ONLY a CPV LI carries a view
// goal (planImpr = plan-views). Non-CPV lines — CPM/CPC, INCLUDING CPM video with a
// VCR target and CPM audio with an ACR target — never contribute a view goal. VCR/ACR
// stay as quality metrics only (isVcrEligible drives the VCR card/timeline).
export function viewGoalUnits(plan) {
  if (!plan) return 0;
  return (plan.rateType === 'CPV') ? (Number(plan.planImpr) || 0) : 0;
}
export function hasViewGoal(plan) { return viewGoalUnits(plan) > 0; }

/* ── the campaign CTR target (owner decision 2026-09-23) ─────────────────────
 * The campaign CTR counts every line: all clicks over all impressions, whatever a line is
 * bought in. Its target is the CTR the campaign would have if every line hit its own target:
 * each line's target weighted by the impressions it DELIVERED in the window the CTR is read
 * over. campM and widget-data's campaignScalars both read the three helpers below, so the
 * dashboard and the widget engine cannot weigh it two ways. They stay out of
 * shared/pacing-core.js: no server surface computes a campaign CTR. */

/** A CTR target is a goal only when it is a finite number above 0. A stored 0, null or NaN is
 *  «no target» everywhere: it neither pulls the campaign average down nor prints «0.00%». */
export function hasCtrTarget(p) {
  return !!p && Number.isFinite(p.ctrTgt) && p.ctrTgt > 0;
}

/**
 * The impressions a line PLANS, whatever it is bought in — the fallback weight before any
 * line with a target has delivered in the window. A CPM line's plan is impressions already.
 * A CPC line's plan is clicks, and its own CTR target turns them into impressions. A CPV
 * line's plan is views, and its VCR target does the same. A CPV line with no VCR target has
 * no impressions figure at all: 0, so it stays out of the plan average rather than borrow a
 * number from another unit (budget, a default VCR) and invent impressions.
 */
export function ctrPlanImpr(p) {
  if (!p) return 0;
  const units = Number(p.planImpr) || 0;
  if (!(units > 0)) return 0;
  const rt = p.rateType || 'CPM';
  if (rt === 'CPC') return hasCtrTarget(p) ? units / (p.ctrTgt / 100) : 0;
  if (rt === 'CPV') return Number.isFinite(p.vcrTgt) && p.vcrTgt > 0 ? units / (p.vcrTgt / 100) : 0;
  return units;
}

/**
 * add(plan, deliveredImpressions) per line, then value():
 *   · the lines with a target weighted by their delivered impressions, when any of them has
 *     impressions in the window;
 *   · else weighted by their planned impressions (ctrPlanImpr) over the whole scoped plan.
 *     All or nothing: actual and plan impressions are never mixed, because a line that has
 *     not started would bring its whole flight's plan against a week of another's delivery;
 *   · else, when no plan figure is usable either, the plain average of the targets;
 *   · null when no line carries a target.
 * A line with no target counts in the CTR and never here.
 */
export function ctrTargetAccumulator() {
  let byImpr = 0, imprWeight = 0, byPlan = 0, planWeight = 0, plain = 0, n = 0;
  return {
    add(p, im) {
      if (!hasCtrTarget(p)) return;
      const t = p.ctrTgt;
      const w = Number.isFinite(im) && im > 0 ? im : 0;
      byImpr += t * w; imprWeight += w;
      const q = ctrPlanImpr(p);
      byPlan += t * q; planWeight += q;
      plain += t; n++;
    },
    value() {
      if (imprWeight > 0) return byImpr / imprWeight;
      if (planWeight > 0) return byPlan / planWeight;
      return n > 0 ? plain / n : null;
    },
  };
}

/**
 * `planInRange` (2026-09-23): the viewer NARROWED the window (config.js getEffRangeInfo), so
 * the plan SUMS follow `range` the way the delivered sums already do — imprPlan / pI,
 * clicksPlan / planClicks, viewsPlan / cpvViewsPlan, their paused remainders, and the client
 * budget `bud` with its gross twin. Everything a rate or a target is made of stays as it was:
 * the per-line `planUnit` still weights vcrT and drives the daily rates, the plan RATES
 * (bidPlan* / clientPlan*, forecastDspSpend) divide by the whole-flight twins published beside
 * the sums, and ctrT's plan fallback reads the whole scoped plan. ctrT's main weights are
 * delivered impressions in `range` (owner decision 2026-09-23), so they follow the window
 * whether or not the plan does. Off (the default, and every caller whose range is the flight
 * or the period), nothing here changes.
 */
export function campM(liDaily, liPlan, asOf, effLIs, range, splitScopedMode, splitScopedPlans, planInRange = false) {
  if (!liDaily || !liPlan) return null;

  const scopedCache = getScopedCache(campMetricsCache, liDaily, liPlan, splitScopedMode, splitScopedPlans);
  // The window the plan follows, or null. It is part of the answer, so it is part of the key:
  // the same (asOf, range) read with and without it are two different metric objects.
  const win = planInRange && range && range.from && range.to ? range : null;
  const key = metricKey(asOf, range) + (win ? '|plan-in-window' : '');
  let byMetric = scopedCache.get(key);
  if (!byMetric) {
    byMetric = new Map();
    scopedCache.set(key, byMetric);
  }

  const effKey = effLIs.join(',');
  if (byMetric.has(effKey)) return byMetric.get(effKey);

  // ── Impressions-side accumulators (NON-CPC LIs only) ──────────────────
  // CPC LIs are excluded from impressions math because their planImpr is
  // the prorated-clicks technical placeholder (see PacingCore.liExpClicks
  // which returns liExpUnits for CPC). Their actual impressions are a
  // side-metric, not a delivery target — including them would produce
  // absurd percentages (e.g. "+20929.7 pp").
  let imprPlan = 0, imprActual = 0, imprExpected = 0, imprSpend = 0, imprDc = 0;
  let imprDailyRateActive = 0, imprDailyRateAvg = 0;
  let imprEndedCount = 0, imprLiCount = 0;

  // ── ALL-LINES impressions-plan accumulators (any rate type) ─────────────
  // The PLAN impressions line (expIm) sums liExpUnits(plan) over EVERY effLI,
  // so at flightEnd it reaches Σ planImpr across ALL lines — CPV/CPC view/click
  // goals included. The REFORECAST dailyImpr must pace to that SAME total (owner
  // decision), so it can sit ABOVE plan when catching up. These parallel the
  // CPM-only imprPlan/imprDailyRate* below but are UNGATED (no isCpc/isCpv).
  let allPlanImpr = 0, allImprDailyRateAvg = 0, allImprDailyRateActive = 0, allImprEndedCount = 0, allImprLiCount = 0;
  // Paused-remaining accumulators: sum of (plan − delivered) over LIs currently
  // paused at asOf. Subtracted from the canonical reforecast pace-to-goal total
  // so a paused LI's remaining plan stops demanding delivery.
  // Additive-only: stays 0 when nothing is paused, so non-paused campaigns are
  // byte-identical to before this feature.
  let allPlanImprPausedRem = 0, viewsPlanPausedRem = 0, costBudPausedRem = 0;
  // Hero "Needed/day" denominators: paused-remaining for the CPM-only impr plan
  // (imprPlan) and the CPC clicks plan (clicksPlan). Subtracted from the three
  // neededPerDay* lines so a paused LI stops demanding daily delivery. Views
  // reuse viewsPlanPausedRem above. Additive — stays 0 when nothing is paused.
  let imprPlanPausedRem = 0, clicksPlanPausedRem = 0, installsPlanPausedRem = 0;

  // ── Clicks-side accumulators ───────────────────────────────────────────
  // CPC LIs only — their plan lives in planImpr by PacingCore convention.
  let clicksPlan = 0, clicksActual = 0, clicksExpected = 0;
  let clicksDailyRateActive = 0, clicksDailyRateAvg = 0;
  let clicksEndedCount = 0, clicksLiCount = 0;
  let hasCpc = false;
  // Installs side — CPI line items only. The fourth unit a pacing can be bought on
  // (app-install buying: Apple Ads and the rest), reading the CONVERSIONS column, which is
  // where an install lands — the delivery mart carries no installs of its own, and it is the
  // same population `dynCpa` divides spend by. Everything below mirrors the clicks block
  // line for line; `planImpr` holds the install goal by the same convention.
  let installsPlan = 0, installsActual = 0, installsExpected = 0;
  let installsDailyRateActive = 0, installsDailyRateAvg = 0;
  let installsEndedCount = 0, installsLiCount = 0;
  let installsPlanFlight = 0, latestDayInstalls = 0;
  let hasCpi = false;
  // Dynamic-CPC accumulators — CPC LIs ONLY.
  let cpcDc = 0, cpcCl = 0;

  // ── Views-side accumulators ────────────────────────────────────────────
  // CPV LIs are paced on completed views (liActualUnits→t.co). Their plan
  // lives in planImpr by PacingCore convention (target_impressions = plan-
  // views, mirroring the CPC clicks placeholder). Excluded from the
  // impressions side so view-paced LIs don't distort impression delivery %.
  let viewsPlan = 0, viewsActual = 0, viewsExpected = 0, viewsSpend = 0, viewsDc = 0;
  let viewsDailyRateActive = 0, viewsDailyRateAvg = 0;
  let viewsEndedCount = 0, viewsLiCount = 0;
  // Whole-flight twins of the plan sums above. Equal to them unless the window is narrowed
  // (`win`); then they are what decides which units the campaign HAS (hasImpr / hasViews, the
  // primary unit) and what every plan RATE divides by — so a window holding none of a unit's
  // plan neither hides that unit nor moves a rate.
  let imprPlanFlight = 0, clicksPlanFlight = 0, viewsPlanFlight = 0, cpvViewsPlanFlight = 0;
  // Reforecast horizon: the latest EFFECTIVE flight-end across effLIs. Built from
  // the SAME scoped plan getEffPlan resolves (period/dim-scope aware), so the
  // pace-to-goal horizon shrinks with the scoped goal instead of staying on the
  // raw full flight. Dates are YYYY-MM-DD, so string compare orders them.
  let scopeEnd = '';
  let cpvViewsPlan = 0;
  // CPV-ONLY actual + client cost — the cost-per-view RATE basis. Views/CPV are a
  // strictly per-CPV-LI concept, so viewsActual is ALSO CPV-only now; cpvViewsActual
  // tracks the same set and drives every cost-per-view calc (dynCpv, Earned @ Plan
  // CPV) so non-CPV completes never get a CPV rate.
  let cpvViewsActual = 0, cpvViewsDc = 0;
  let hasCpv = false;
  // CPV KPI numerator/denominator over ALL video LIs (CPV-rate OR VCR-eligible),
  // to match the CPV Trend chart. Kept separate from the CPV-rate-only
  // viewsActual/viewsSpend, which still drive the views-delivery charts + pacing.
  let cpvSpendV = 0, cpvViewsV = 0;

  // ── Latest-day (= asOf) accumulators ───────────────────────────────────
  // Block-library canon (spec 2026-07-16 §3), promoted from OverviewBlock1's
  // inline loop (:252-266). Same rate-type bucket gating as the *Actual
  // accumulators above, plus that loop's own flight-window guard (a fact row
  // dated asOf only counts if asOf falls inside THIS LI's own [fs, fe] — see
  // the guard at each accumulation site below). Paused LIs are NOT excluded:
  // block1 doesn't check pause here, matching imprActual/clicksActual/
  // viewsActual, whose delivered stays visible while paused.
  let latestDayImpr = 0, latestDayClicks = 0, latestDayViews = 0;

  // ── General accumulators (across all LIs) ──────────────────────────────
  let clientPr = 0, costPr = 0, sp = 0, cl = 0, co = 0, cv = 0, imV = 0, bud = 0;
  // ── Primary conversions (spec 2026-09-13 §3, §7) ───────────────────────
  // cvUnavailableCount > 0 turns the campaign conversion group (cv, CR, CPA) into null:
  // one line item in view that cannot show conversions makes the total unanswerable.
  // cvPrimaryCount / cvDataCount feed the rate rows note "on K of N line items".
  // Not operative: cvState is null and all three stay 0.
  const cvState = cvStateOf(liDaily);
  let cvPrimaryCount = 0, cvDataCount = 0, cvUnavailableCount = 0;
  // ── Net cost mode: GROSS twins ─────────────────────────────────────────
  // One twin per client-money accumulator, summed from liM's per-LI gross
  // (net / k) so a mixed campaign adds each LI at its own ratio. Identity
  // pacings (k = 1 everywhere) keep every twin equal to its net original.
  let clientPrGross = 0, budGross = 0, imprDcGross = 0, cpcDcGross = 0, viewsDcGross = 0, cpvViewsDcGross = 0;
  let costBudTotal = 0, vcW = 0, vcWt = 0, mW = 0, mWt = 0;
  // The client's plan to date inside `range`, line by line (budPr below, 2026-09-23).
  let budToDate = 0;
  // The campaign CTR pair (owner decision 2026-09-23): impressions over EVERY line, and the
  // target weighted by each line's delivered impressions (ctrTargetAccumulator above).
  let imAll = 0;
  const ctrAcc = ctrTargetAccumulator();
  let totalDP = 0, totalFD = 0, pacW = 0, pacWt = 0, cpmBudSum = 0, cpmImprSum = 0;
  // Per-rate-type budget split — each type's bid/plan rate is derived from ITS OWN
  // budget (cost side for Bid Plan, client side for Plan rate), not the campaign total.
  let imprCostBud = 0, imprClientBud = 0;
  let cpcCostBud = 0, cpcClientBud = 0, cpcPlanClicks = 0;
  let cpvCostBud = 0, cpvClientBud = 0;
  let _hasAudio = false;
  let planForCurrentSplit = 0, daysInSplitNum = 0, daysInSplitDen = 0;
  let daysInSplitFirstDays = null, daysInSplitHomogeneous = true;

  for (const id of effLIs) {
    const p = getEffPlan(liPlan, id, splitScopedMode, splitScopedPlans);
    const m = liM(id, liDaily, liPlan, asOf, range, splitScopedMode, splitScopedPlans);
    if (!p || !m) continue;

    // A line item the view keeps nothing of is not in view (spec §4): it neither makes the total
    // unanswerable nor counts in the rate rows note.
    if (isInView(liDaily, id)) {
      if (isCvUnavailable(liDaily, id)) cvUnavailableCount++;
      else if (cvState && cvState[id] && cvState[id].cv === CV.PRIMARY) cvPrimaryCount++;
      // Read from liPlan[id], not p: getEffPlan's virtual plans drop unknown fields.
      if (liPlan[id] && liPlan[id].conversionData === true) cvDataCount++;
    }

    if (p.fe && p.fe > scopeEnd) scopeEnd = p.fe;

    const rt = p.rateType || 'CPM';
    const isCpc = rt === 'CPC';
    const isCpv = rt === 'CPV';
    const isCpi = rt === 'CPI';
    const liFDays = Math.max(1, dI(p.fs, p.fe));
    // planImpr holds the primary delivery goal in the LI's rate-type unit:
    // impressions (CPM), clicks (CPC), views (CPV) or installs (CPI).
    const planUnit = Number(p.planImpr) || 0;
    const w = planUnit || p.budget || 1;
    // The plan SUMS follow a narrowed window; `planUnit` keeps driving weights and rates.
    const planWin = win ? unitsInWindow(p, win) : planUnit;
    const budWin = win ? budgetInWindow(p, win) : p.budget;

    // General (always)
    clientPr += m.clientPr;
    costPr += m.costPr;
    sp += m.sp;
    cl += m.cl;
    // `m.im` is range-aware (liM): the flight to date with no range, the window's with one.
    imAll += m.im || 0;
    ctrAcc.add(p, m.im || 0);
    cv += m.cv || 0;
    bud += budWin;
    clientPrGross += m.clientPrGross;
    // The gross twin stands on the same budget as `bud`: m.budGross is the flight's (p.budget / k).
    budGross += win ? budWin / m.k : m.budGross;
    const liCostBud = range ? m.costPr : p.budget * (1 - p.mTgt / 100);
    costBudTotal += liCostBud;
    if (range) budToDate += budgetToDate(p, range, asOf);
    // Per-LI pause: a paused LI's REMAINING plan should not be demanded by the
    // reforecast pace-to-goal (it won't deliver until resumed). Its delivered
    // stays in the chart's actual bars — we only shrink the goal total.
    if (PacingCore.isLiPaused(p, asOf)) {
      // planUnit is in the LI's rate-type unit, so the delivered side must be too
      // — subtracting impressions from a CPC/CPV/CPI goal mixes units. isCpc/isCpv/isCpi
      // are already resolved for this LI a few lines above.
      const doneUnits = isCpc ? (m.cl || 0) : isCpv ? (m.co || 0) : isCpi ? (m.cv || 0) : (m.im || 0);
      if (planUnit > 0) allPlanImprPausedRem += Math.max(0, planUnit - doneUnits);
      costBudPausedRem += Math.max(0, liCostBud - (m.sp || 0));
    }
    totalDP += m.dP;
    totalFD += m.fDays;
    if (isVcrEligible(p, liDaily[id])) { co += m.co; imV += m.im; }
    mW += p.mTgt * p.budget;
    mWt += p.budget;
    // The Pacing reading (`pac`, «index vs plan»): each line's (actual − expected) over its
    // plan, weighted by its budget. On a narrowed window (`win`) the plan is the window's,
    // the one the Delivery reading, the unit bars and the verdict divide by, and the weight is
    // the line's budget in that window, so a line with no plan there has no pace to add
    // (review 2026-09-23: 7d at 80% of plan read −1.82 pp here against −20.0 pp beside it).
    // Off, it is the flight's per-line index and weight, byte for byte.
    const linePace = win ? PacingCore.pacingIndex(m.au, m.eI, planWin) : m.pI;
    const bw = win ? (planWin > 0 ? (budWin || 1) : 0) : (p.budget || 1);
    pacW += linePace * bw;
    pacWt += bw;
    if (!_hasAudio && (p.ch || '').toLowerCase() === 'audio') _hasAudio = true;

    // ALL-LINES impressions plan — every LI with planUnit > 0, ANY rate type.
    // Parallels the CPM-only impr daily-rate derivation but ungated, so the
    // dailyImpr reforecast paces to the same Σ planImpr the PLAN line reaches.
    if (planUnit > 0) {
      allPlanImpr += planUnit;
      allImprDailyRateAvg += planUnit / liFDays;
      allImprLiCount++;
      if (asOf && asOf >= p.fs) {
        if (asOf > p.fe) allImprEndedCount++;
        else { const prev = datePrev(asOf); allImprDailyRateActive += liExpUnits(p, asOf) - liExpUnits(p, prev); }
      }
    }

    // Impressions side — impression-paced LIs only (CPM). CPC (clicks-paced),
    // CPV (views-paced) and CPI (install-paced) LIs are excluded: their planImpr is a
    // plan-clicks / plan-views / plan-installs placeholder, so folding their actuals into
    // impression delivery would produce absurd percentages.
    if (!isCpc && !isCpv && !isCpi) {
      imprActual += m.im;
      // latest-day (= asOf) actual — window-guarded exactly like
      // OverviewBlock1.jsx:255 (`ep.fs && ep.fe && (asOf < ep.fs || asOf > ep.fe)`):
      // a fact row dated asOf still doesn't count once it falls outside this
      // LI's own flight window (e.g. late-arriving data after flight end).
      if (asOf && !(p.fs && p.fe && (asOf < p.fs || asOf > p.fe))) {
        const dayRow = liDaily[id]?.[asOf];
        if (dayRow) latestDayImpr += dayRow.im || 0;
      }
      imprExpected += m.eI;
      imprSpend += m.sp;
      imprDc += m.clientPr;
      imprDcGross += m.clientPrGross;
      if (planUnit > 0) {
        imprPlan += planWin;
        imprPlanFlight += planUnit;
        if (PacingCore.isLiPaused(p, asOf)) imprPlanPausedRem += Math.max(0, planWin - (m.im || 0));
        imprDailyRateAvg += planUnit / liFDays;
        if (asOf && asOf >= p.fs) {
          if (asOf > p.fe) imprEndedCount++;
          else {
            const prev = datePrev(asOf);
            imprDailyRateActive += liExpUnits(p, asOf) - liExpUnits(p, prev);
          }
        }
        imprLiCount++;
        imprCostBud += liCostBud;
        imprClientBud += p.budget;
      }
      // CPM weighting (CPM type only)
      if (rt === 'CPM') {
        cpmBudSum += p.budget * (1 - p.mTgt / 100);
        cpmImprSum += planUnit;
      }
    }

    // VCR target weighting — any non-CPC, non-audio LI carrying a VCR target
    // (CPM video AND CPV). Kept outside the impressions block so CPV LIs,
    // excluded above, still contribute their VCR target to the campaign-level
    // vcrT. Audio excluded: its vcrTgt is an ACR target (see isVcrEligible).
    if (!isCpc && (p.ch || '').toLowerCase() !== 'audio'
        && p.vcrTgt != null && Number.isFinite(p.vcrTgt) && p.vcrTgt > 0) {
      vcW += p.vcrTgt * w; vcWt += w;
    }

    // Clicks side — CPC LIs only (planImpr = plan_clicks convention).
    if (isCpc) {
      hasCpc = true; cpcDc += m.clientPr; cpcDcGross += m.clientPrGross; cpcCl += m.cl;
      if (planUnit > 0) { cpcCostBud += liCostBud; cpcClientBud += p.budget; cpcPlanClicks += planUnit; }
    }
    const liClicksPlan = isCpc ? planUnit : 0;
    // cpcPlanClicks above is NOT windowed: it feeds only the two CPC plan rates.
    const liClicksPlanWin = isCpc ? planWin : 0;
    if (isCpc) {
      clicksPlan += liClicksPlanWin;
      clicksPlanFlight += liClicksPlan;
      clicksActual += m.cl;
      // latest-day (= asOf) actual — same flight-window guard as the impr
      // branch above.
      if (asOf && !(p.fs && p.fe && (asOf < p.fs || asOf > p.fe))) {
        const dayRow = liDaily[id]?.[asOf];
        if (dayRow) latestDayClicks += dayRow.cl || 0;
      }
      if (PacingCore.isLiPaused(p, asOf)) clicksPlanPausedRem += Math.max(0, liClicksPlanWin - (m.cl || 0));
      clicksExpected += m.eCl || 0;
      // Daily rate for clicks side: liExpUnits already prorates planImpr
      // (which IS plan-clicks for CPC).
      if (liClicksPlan > 0) {
        clicksDailyRateAvg += liClicksPlan / liFDays;
        if (asOf && asOf >= p.fs) {
          if (asOf > p.fe) clicksEndedCount++;
          else {
            const prev = datePrev(asOf);
            clicksDailyRateActive += liExpUnits(p, asOf) - liExpUnits(p, prev);
          }
        }
        clicksLiCount++;
      }
    }

    // Views side — CPV LIs ONLY (planImpr = views). Views/CPV are a strictly
    // per-CPV-line-item concept: non-CPV lines (CPM video with a VCR target, CPM
    // audio with an ACR target, CPC) contribute NOTHING here. VCR/ACR remain quality
    // metrics only. cpvViewsPlan mirrors viewsPlan as the cost-per-view rate basis.
    if (isCpv) {
      hasCpv = true;
      viewsActual += m.co;
      // latest-day (= asOf) actual — same flight-window guard as the impr
      // branch above.
      if (asOf && !(p.fs && p.fe && (asOf < p.fs || asOf > p.fe))) {
        const dayRow = liDaily[id]?.[asOf];
        if (dayRow) latestDayViews += dayRow.co || 0;
      }
      viewsExpected += m.eI;
      viewsSpend += m.sp;
      viewsDc += m.clientPr;
      viewsDcGross += m.clientPrGross;
      // CPV-only accumulators (cost-per-view rate basis — NOT the non-CPV branch).
      cpvViewsActual += m.co;
      cpvViewsDc += m.clientPr;
      cpvViewsDcGross += m.clientPrGross;
      if (planUnit > 0) {
        viewsPlan += planWin;
        viewsPlanFlight += planUnit;
        if (PacingCore.isLiPaused(p, asOf)) viewsPlanPausedRem += Math.max(0, planWin - (m.co || 0));
        cpvViewsPlan += planWin;
        cpvViewsPlanFlight += planUnit;
        viewsDailyRateAvg += planUnit / liFDays;
        if (asOf && asOf >= p.fs) {
          if (asOf > p.fe) viewsEndedCount++;
          else { const prev = datePrev(asOf); viewsDailyRateActive += liExpUnits(p, asOf) - liExpUnits(p, prev); }
        }
        viewsLiCount++;
        cpvCostBud += liCostBud;
        cpvClientBud += p.budget;
      }
    }

    // Installs side — CPI LIs only (planImpr = plan_installs convention), the clicks block
    // above with `cv` in place of `cl`.
    if (isCpi) {
      hasCpi = true;
      installsActual += m.cv || 0;
      if (asOf && !(p.fs && p.fe && (asOf < p.fs || asOf > p.fe))) {
        const dayRow = liDaily[id]?.[asOf];
        if (dayRow) latestDayInstalls += dayRow.cv || 0;
      }
      // `m.eI` is this line's expected UNITS, which for a CPI line are installs — the same
      // reading the views branch takes for its own unit.
      installsExpected += m.eI;
      if (planUnit > 0) {
        installsPlan += planWin;
        installsPlanFlight += planUnit;
        if (PacingCore.isLiPaused(p, asOf)) installsPlanPausedRem += Math.max(0, planWin - (m.cv || 0));
        installsDailyRateAvg += planUnit / liFDays;
        if (asOf && asOf >= p.fs) {
          if (asOf > p.fe) installsEndedCount++;
          else { const prev = datePrev(asOf); installsDailyRateActive += liExpUnits(p, asOf) - liExpUnits(p, prev); }
        }
        installsLiCount++;
      }
    }

    // CPV KPI spans view-based LIs (CPV-rate OR VCR-eligible: Video, CTV, OTT,
    // YouTube, Native-video…) but NOT Audio — audio tracks listen-throughs as
    // "completes" yet must never pollute cost-per-VIEW. Matches the CPV chart.
    if ((isCpv || isVcrEligible(p, liDaily[id])) && (p.ch || '').toLowerCase() !== 'audio') {
      cpvSpendV += m.sp;
      cpvViewsV += m.co;
    }

    // Variant-D formula inputs for the Plan rate card — impressions side only,
    // since the formula visualises imprPlanDailyRate. Skip CPC and CPV LIs.
    if (!isCpc && !isCpv && !isCpi && asOf && asOf >= p.fs && asOf <= p.fe && planUnit > 0) {
      const containers = (p && p.containers) || [];
      let activeC = null;
      for (const c of containers) {
        if (c && c.fs && c.fe && Number(c.target_impressions) > 0
            && asOf >= c.fs && asOf <= c.fe) {
          if (!activeC || c.fs > activeC.fs) activeC = c;
        }
      }
      let contributed = 0;
      let cdays = 0;
      if (activeC) {
        contributed = Number(activeC.target_impressions) || 0;
        cdays = Math.max(1, dI(activeC.fs, activeC.fe));
        if (Array.isArray(activeC.date_children) && activeC.date_children.length > 0) {
          daysInSplitHomogeneous = false;
        }
      } else {
        contributed = Number(p.planImpr) || 0;
        cdays = Math.max(1, dI(p.fs, p.fe));
      }
      planForCurrentSplit += contributed;
      daysInSplitNum += cdays;
      daysInSplitDen += 1;
      if (daysInSplitFirstDays == null) daysInSplitFirstDays = cdays;
      else if (cdays !== daysInSplitFirstDays) daysInSplitHomogeneous = false;
    }
  }

  // ── UI flags ───────────────────────────────────────────────────────────
  // hasImpr: at least one non-CPC LI with planImpr > 0 contributes a real
  //          impressions plan. Drives the impressions side of UI cards.
  // hasClicks: at least one CPC LI exists. CPC LIs always trigger this even
  //          with planImpr=0; the UI shows a "plan not set" placeholder then.
  // Read off the whole-flight twins: a narrowed window holding none of the impressions plan
  // (a line that starts later) must not hide the unit. Equal to imprPlan / viewsPlan otherwise.
  const hasImpr = imprPlanFlight > 0;
  const hasClicks = hasCpc;
  // hasInstalls: at least one CPI LI exists, the same rule hasClicks carries for CPC.
  const hasInstalls = hasCpi;
  const hasViews = viewsPlanFlight > 0 || hasCpv;

  // ── Derived ratios ─────────────────────────────────────────────────────
  const mA = PacingCore.margin(clientPr, sp);
  const mT = mWt > 0 ? mW / mWt : 0;
  // CTR counts every line (owner decision 2026-09-23): all clicks over all impressions, the
  // number the CTR chart and the Daily table already print. A click-bought line's impressions
  // are real impressions, so nothing double-counts. Division by zero gives 0 (engine rule).
  const ctr = imAll > 0 ? (cl / imAll) * 100 : 0;
  const ctrT = ctrAcc.value();
  const vcr2 = imV > 0 ? (co / imV) * 100 : 0;
  const vcrT = vcWt > 0 ? vcW / vcWt : null;
  const cvOff = cvUnavailableCount > 0;
  const cvr2 = cvOff ? null : (cl > 0 ? (cv / cl) * 100 : 0);
  const cpm = imprActual > 0 ? (imprSpend / imprActual) * 1000 : 0;
  const cpv = cpvViewsV > 0 ? cpvSpendV / cpvViewsV : 0;
  // Dynamic rates: client-effective rate from dynamic_cost (dc), not media spend.
  // Each over its own rate-type LIs (CPC pair is CPC-only — see cpcDc/cpcCl).
  const dynCpm = imprActual > 0 ? (imprDc / imprActual) * 1000 : 0;
  const dynCpc = cpcCl > 0 ? cpcDc / cpcCl : 0;
  const dynCpv = cpvViewsActual > 0 ? cpvViewsDc / cpvViewsActual : 0;
  // Client cost-per-conversion (spec §4.2): full clientPr over full cv —
  // rate-type-agnostic by design (conversions span all rate types). cv basis
  // matches cvr (= cv/cl). Rebases with the coefficient because clientPr does.
  const dynCpa = cvOff ? null : (cv > 0 ? clientPr / cv : 0);
  // GROSS twins of the four dynamic rates — same denominators, gross numerators.
  const dynCpmGross = imprActual > 0 ? (imprDcGross / imprActual) * 1000 : 0;
  const dynCpcGross = cpcCl > 0 ? cpcDcGross / cpcCl : 0;
  const dynCpvGross = cpvViewsActual > 0 ? cpvViewsDcGross / cpvViewsActual : 0;
  const dynCpaGross = cvOff ? null : (cv > 0 ? clientPrGross / cv : 0);
  const iPct = imprPlan > 0 ? (imprActual / imprPlan) * 100 : 0;
  const avgTP = totalFD > 0 ? totalDP / totalFD : 0;
  // A narrowed window holding no line's plan has no pace at all: null, the em dash the
  // Delivery reading prints there, not a 0 that reads «on plan». Flight keeps its 0.
  const pac = pacWt > 0 ? pacW / pacWt : (win ? null : 0);

  const daysLeft = effLIs.length > 0
    ? Math.max(0, Math.round(effLIs.reduce((s, id) => {
        const pr = prorate(getEffPlan(liPlan, id, splitScopedMode, splitScopedPlans), asOf);
        return s + (pr.fDays - pr.dP);
      }, 0) / effLIs.length))
    : 0;

  const tgtCpm = cpmImprSum > 0 ? (cpmBudSum / cpmImprSum * 1000) : null;
  // Bid Plan (cost side) + Plan rate (client side) per type, each from ITS OWN
  // budget. bidPlanCpm previously divided the WHOLE cost budget by impr plan —
  // wrong for mixed campaigns; now per-CPM-bucket (identical for pure CPM).
  // The rates and the DSP forecast divide by the whole-flight plan (the *Flight twins), so a
  // narrowed window leaves every one of them byte-identical to what it was.
  const bidPlanCpm = imprPlanFlight > 0 ? imprCostBud / imprPlanFlight * 1000 : 0;
  const bidPlanCpc = cpcPlanClicks > 0 ? cpcCostBud / cpcPlanClicks : 0;
  const bidPlanCpv = cpvViewsPlanFlight > 0 ? cpvCostBud / cpvViewsPlanFlight : 0;
  const forecastDspSpend = imprActual > 0 ? (imprSpend / imprActual) * imprPlanFlight : 0;
  const clientPlanCpm = imprPlanFlight > 0 ? imprClientBud / imprPlanFlight * 1000 : 0;
  const clientPlanCpc = cpcPlanClicks > 0 ? cpcClientBud / cpcPlanClicks : 0;
  const clientPlanCpv = cpvViewsPlanFlight > 0 ? cpvClientBud / cpvViewsPlanFlight : 0;
  // Subtract paused-LI remaining only (no Math.max clamp) so a non-paused
  // campaign stays byte-identical — including the legacy negative value when
  // over-delivered. *PausedRem is 0 when nothing is paused.
  const neededPerDayImpr = daysLeft > 0 && imprPlan > 0
    ? Math.round(((imprPlan - imprActual) - imprPlanPausedRem) / daysLeft) : 0;
  const neededPerDayClicks = daysLeft > 0 && clicksPlan > 0
    ? Math.round(((clicksPlan - clicksActual) - clicksPlanPausedRem) / daysLeft) : 0;
  const neededPerDayInstalls = daysLeft > 0 && installsPlan > 0
    ? Math.round(((installsPlan - installsActual) - installsPlanPausedRem) / daysLeft) : 0;
  const neededPerDayViews = daysLeft > 0 && viewsPlan > 0
    ? Math.round(((viewsPlan - viewsActual) - viewsPlanPausedRem) / daysLeft) : 0;

  // Block-library canon (spec 2026-07-16 §3): per-unit to-date pacing —
  // actual vs expected-to-date, each inside its rate-type-gated bucket.
  const imprToDatePct = imprExpected > 0 ? (imprActual / imprExpected) * 100 : 0;
  const clicksToDatePct = clicksExpected > 0 ? (clicksActual / clicksExpected) * 100 : 0;
  const installsToDatePct = installsExpected > 0 ? (installsActual / installsExpected) * 100 : 0;
  const viewsToDatePct = viewsExpected > 0 ? (viewsActual / viewsExpected) * 100 : 0;
  const spendToDatePct = costPr > 0 ? (sp / costPr) * 100 : 0;

  /* Bid Fact 2d: actual buying rate (media spend) over the last 2 days with data,
     per rate type. CPM = sp/impr*1000; CPC = sp/clicks; CPV = sp/views. Each over
     its OWN rate-type LIs, with that type's own last-2-days-with-data window.
     Primary conversions (spec 2026-09-13 §3 "Days"): a day row the overlay made only
     for conversions is not a day with data. Its delivery is 0, so it would add nothing
     to s or u below, but it would still take a place in last2. Not operative: no list. */
  const cvOnlyDays = cvOnlyDaysOf(liDaily);
  function bidFact2d(typePred, unitField, perMille) {
    const allDates = new Set();
    for (const id of effLIs) {
      const pp = liPlan[id];
      if (!pp || !typePred(pp.rateType || 'CPM')) continue;
      const skip = cvOnlyDays && cvOnlyDays[id];
      for (const d in (liDaily[id] || {})) { if (!skip || !skip.has(d)) allDates.add(d); }
    }
    const last2 = [...allDates].sort().slice(-2);
    let s = 0, u = 0;
    for (const id of effLIs) {
      const pp = liPlan[id];
      if (!pp || !typePred(pp.rateType || 'CPM')) continue;
      const dd = liDaily[id] || {};
      for (const d of last2) { if (dd[d]) { s += dd[d].sp; u += dd[d][unitField]; } }
    }
    return u > 0 ? (perMille ? (s / u) * 1000 : s / u) : 0;
  }
  const bidFact2dCpm = bidFact2d((rt) => rt !== 'CPC' && rt !== 'CPV' && rt !== 'CPI', 'im', true);
  const bidFact2dCpc = bidFact2d((rt) => rt === 'CPC', 'cl', false);
  const bidFact2dCpv = bidFact2d((rt) => rt === 'CPV', 'co', false);
  const bidFact2dCpi = bidFact2d((rt) => rt === 'CPI', 'cv', false);

  // Spend/day at current buying rates to deliver the needed units — the exact
  // expression OverviewBlock1 computes ad-hoc (:286-289), promoted to canon.
  const neededSpendPerDay =
    (neededPerDayImpr * bidFact2dCpm) / 1000
    + neededPerDayClicks * bidFact2dCpc
    + neededPerDayViews * bidFact2dCpv
    + neededPerDayInstalls * bidFact2dCpi;

  // The client's plan over the days `costPr` covers: each line's client money from the range's
  // first day to asOf (widget-data's `budgetToDate`, 2026-09-23), and the budget with no range.
  // It was `costBudTotal / (1 - mT / 100)`, the cost plan over one budget-weighted margin, which
  // is that number only while every line and part carries the same margin.
  const budPr = range ? budToDate : bud;

  const imprPlanDailyEnded = imprLiCount > 0 && imprEndedCount === imprLiCount;
  const imprPlanDailyRate = Math.round(imprPlanDailyEnded ? imprDailyRateAvg : imprDailyRateActive);
  const allImprEnded = allImprLiCount > 0 && allImprEndedCount === allImprLiCount;
  // Still a documented member of campM, but the reforecast no longer reads it.
  const allPlanImprDailyRate = Math.round(allImprEnded ? allImprDailyRateAvg : allImprDailyRateActive);
  const clicksPlanDailyEnded = clicksLiCount > 0 && clicksEndedCount === clicksLiCount;
  const clicksPlanDailyRate = Math.round(clicksPlanDailyEnded ? clicksDailyRateAvg : clicksDailyRateActive);
  const installsPlanDailyEnded = installsLiCount > 0 && installsEndedCount === installsLiCount;
  const installsPlanDailyRate = Math.round(installsPlanDailyEnded ? installsDailyRateAvg : installsDailyRateActive);
  const viewsPlanDailyEnded = viewsLiCount > 0 && viewsEndedCount === viewsLiCount;
  const viewsPlanDailyRate = Math.round(viewsPlanDailyEnded ? viewsDailyRateAvg : viewsDailyRateActive);

  const result = freezeDev({
    // General (across all LIs)
    clientPr, costPr, costBudTotal, sp, cl, co, cv: cvOff ? null : cv, bud, budPr,
    // `imAll`: impressions over EVERY line, the CTR's denominator. `im` / `imprActual` below
    // stay the impression-paced lines' (CPM, delivery %, pacing).
    imAll,
    mA, mT, pac, ctr, ctrT, vcr: vcr2, vcrT, cvr: cvr2, cpm, cpv, dynCpm, dynCpc, dynCpv, dynCpa, tgtCpm,
    // Net cost mode: GROSS twins, shown beside their net originals.
    clientPrGross, budGross, dynCpmGross, dynCpcGross, dynCpvGross, dynCpaGross,
    avgTP, totalDP, totalFD, daysLeft,
    scopeEnd: scopeEnd || null,
    bidPlanCpm, bidPlanCpc, bidPlanCpv,
    bidFact2dCpm, bidFact2dCpc, bidFact2dCpv,
    forecastDspSpend, clientPlanCpm, clientPlanCpc, clientPlanCpv,

    // Explicit impressions / clicks split
    imprPlan, imprActual, imprExpected, imprSpend,
    imprPlanDailyRate, imprPlanDailyEnded, neededPerDayImpr,
    // All-lines impressions plan (any rate type) — the total expIm reaches.
    // Drives the dailyImpr reforecast so it paces to the SAME total as Plan.
    allPlanImpr, allPlanImprDailyRate,
    // Paused-remaining (plan − delivered summed over currently-paused LIs) —
    // consumed by report-calc to shrink the pace-to-goal total, and by the «Needed to be on
    // pace» notes (brick-data.js) to match the neededPerDay* headlines they explain.
    // `clicksPlanPausedRem` was computed and left off this object until 2026-09-23, so both
    // of its readers saw 0 for a paused click-paced line.
    allPlanImprPausedRem, viewsPlanPausedRem, costBudPausedRem, imprPlanPausedRem, clicksPlanPausedRem,
    installsPlanPausedRem,
    // The installs family, the clicks one's twin (CPI line items).
    installsPlan, installsActual, installsExpected, installsPlanFlight,
    installsPlanDailyRate, installsPlanDailyEnded, neededPerDayInstalls, installsToDatePct,
    latestDayInstalls, hasInstalls,
    clicksPlan, clicksActual, clicksExpected,
    clicksPlanDailyRate, clicksPlanDailyEnded, neededPerDayClicks,

    // Explicit views split (CPV)
    viewsPlan, viewsActual, viewsExpected, viewsSpend,
    cpvViewsPlan, cpvViewsActual,
    viewsPlanDailyRate, viewsPlanDailyEnded, neededPerDayViews,

    // Block-library canon (spec 2026-07-16 §3): to-date pacing + needed spend/day
    imprToDatePct, clicksToDatePct, viewsToDatePct, spendToDatePct,
    neededSpendPerDay,
    // Block-library canon (spec §3): latest-day (= asOf) actuals, promoted
    // from OverviewBlock1's inline loop. latestDayDate is asOf itself (or
    // null when there's no asOf), independent of whether any LI had data.
    latestDayImpr, latestDayClicks, latestDayViews, latestDayDate: asOf ?? null,

    // Legacy aliases (impressions side) — kept for KpiCards / AlertsBlock /
    // any consumer that reads cm.im / cm.pI / cm.eI / cm.planDailyRate.
    im: imprActual,
    pI: imprPlan,
    eI: imprExpected,
    eCl: clicksExpected,
    iPct,
    planClicks: clicksPlan,
    planDailyRate: imprPlanDailyRate,
    planDailyEnded: imprPlanDailyEnded,
    neededPerDay: neededPerDayImpr,

    // Flags
    hasImpr,
    hasClicks,
    hasViews,
    hasVideo: co > 0,
    hasAudio: _hasAudio,

    // Whole-flight plan sums (2026-09-23): equal to imprPlan / clicksPlan / viewsPlan unless
    // the window is narrowed (`planWindowed`), when those three follow it and these do not.
    // Readers that ask whether a unit HAS a plan read these; readers of a pace over the
    // window read the three above.
    imprPlanFlight, clicksPlanFlight, viewsPlanFlight,
    planWindowed: !!win,

    // Variant-D Plan rate formula (impressions side)
    planForCurrentSplit,
    daysInSplit: daysInSplitDen > 0 && daysInSplitHomogeneous
      ? Math.round(daysInSplitNum / daysInSplitDen)
      : 0,

    // Primary conversions (spec 2026-09-13 §7): line items in view that count chosen
    // actions, that have conversion data, and that cannot show conversions here.
    cvPrimaryCount, cvDataCount, cvUnavailableCount,
  });

  byMetric.set(effKey, result);
  return result;
}
