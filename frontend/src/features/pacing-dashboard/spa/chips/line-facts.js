// workspace/src/lib/dashboard/chips/line-facts.js — one line item, one window, one record.
//
// The record is the legacy record: it is built by widget-data's own addWindowFact over the
// same day order (Object.entries of the day map), the flight clip first, then the window
// clip, into a zeroFlow() object. A chip sum and a legacy sum are therefore one float path,
// which tests/line-facts-test.mjs pins against sumLiWindow with Object.is, and the parity test
// of P1 Task 5 (tests/chip-legacy-parity-test.mjs) proves end to end.
//
// Lives in workspace/, not shared/: planSpan calls pacing-calc's memoised curves and
// gatesOf reaches metrics' isVcrEligible, and both are workspace ESM.
import {
  zeroFlow, addWindowFact, addRowSums, gatesOf, expectedDeltas, dayHasDelivery, costBudOf,
} from '../widget-data.js';
import { cvBlocksTotals } from '../primary-cv.js';
import { unitsInWindow, costInWindow, budgetInWindow, budgetToDate, cachedProrateRange, prorate } from '../pacing-calc.js';
import PacingCore from '@shared/pacing-core';

/** windowRecord(liDaily, plan, id, filter) → the ZERO_FLOW record of this line over the filter.
 *  filter: {kind:'range', from, to} | {kind:'dates', dates: Set} | {kind:'all'}. */
export function windowRecord(liDaily, plan, id, filter) {
  const dd = liDaily[id] || {};
  const t = zeroFlow();
  const g = gatesOf(plan, dd);
  const kind = filter ? filter.kind : 'all';
  for (const [d, v] of Object.entries(dd)) {
    if (plan && plan.fs && plan.fe && (d < plan.fs || d > plan.fe)) continue;
    if (kind === 'range' && (d < filter.from || d > filter.to)) continue;
    if (kind === 'dates' && !filter.dates.has(d)) continue;
    addWindowFact(t, v, g);
  }
  return t;
}

/** The six expected fields, added the way sumLiWindow's tail adds them. Mutates `record` and
 *  returns it: never hand it a cached record (add onto a fresh zeroFlow() and combine instead). */
export function withExpected(record, plan, bounds) {
  if (!bounds) return record;
  const e = expectedDeltas(plan, bounds.from, bounds.to);
  record.expIm += e.expIm; record.expCo += e.expCo; record.expCl += e.expCl; record.expVw += e.expVw;
  record.imprExpected += e.imprExpected; record.clExpected += e.clExpected;
  return record;
}

export function combine(records) {
  const t = zeroFlow();
  for (const r of records) addRowSums(t, r);
  return t;
}

export const classOf = (plan, dayMap) => gatesOf(plan, dayMap);

/** 'running' | 'paused' | 'ended' | 'notStarted' | null. `rule`: 'now' is the row badge's
 *  (PacingCore.isLiPausedNow: an open pause is paused now whatever the data date); 'dataDate'
 *  is campM's (isLiPaused). The calendar wins over a pause; no asOf means nothing has started. */
export function status(plan, asOf, rule = 'now') {
  if (!plan) return null;
  if (!asOf) return 'notStarted';
  if (plan.fs && asOf < plan.fs) return 'notStarted';
  if (plan.fe && asOf > plan.fe) return 'ended';
  const paused = rule === 'dataDate' ? PacingCore.isLiPaused(plan, asOf) : PacingCore.isLiPausedNow(plan, asOf);
  return paused ? 'paused' : 'running';
}

/** The days with data (spec §2.1): a day counts when one of the given lines delivered something
 *  inside its own flight; a conversion-only overlay day (cvOnlyDaysOf) never counts. */
export function dataDays(liDaily, ids, plans, cvOnly) {
  const set = new Set();
  for (const id of ids) {
    const p = plans[id]; if (!p) continue;
    const dd = liDaily[id] || {};
    const skip = cvOnly && cvOnly[id];
    for (const d of Object.keys(dd)) {
      if (p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (skip && skip.has(d)) continue;
      if (!dayHasDelivery(dd[d])) continue;
      set.add(d);
    }
  }
  return [...set].sort();
}

const chanOf = (p) => (p.ch || '').toLowerCase();
const rateOf = (p) => p.rateType || 'CPM';

/** The line ids of a Lines set out of `ids` (default: the cut), in the given order, plans only.
 *  Takes the ids as a list on purpose: `{ ...sources, effLIs: [id] }` would read every lazy
 *  getter on sources (widget-data.js aggregateDateRows says why). */
export function linesOf(sources, lines, asOf, ids = sources.effLIs || []) {
  const out = [];
  for (const id of ids) {
    const p = sources.liPlan[id]; if (!p) continue;
    const rt = rateOf(p); const ch = chanOf(p);
    let keep;
    switch (lines || 'all') {
      case 'all': keep = true; break;
      // CPI is ours — the reference has no such rate type, and this test is a blacklist, so an
      // install-paced line used to pass as impression-paced: its install goal and its delivered
      // IMPRESSIONS landed in a bucket meant for lines bought on impressions. `impressionPaced`
      // is also the first entry of LINES_RATE, so it is what a rate chip picks by DEFAULT — the
      // wrong answer arrived without anyone choosing it. Same fix as PacingCore.liActualUnits.
      case 'impressionPaced': keep = rt !== 'CPC' && rt !== 'CPV' && rt !== 'CPI'; break;
      case 'cpm': keep = rt === 'CPM'; break;
      case 'cpi': keep = rt === 'CPI'; break;
      case 'cpc': keep = rt === 'CPC'; break;
      case 'cpv': keep = rt === 'CPV'; break;
      case 'video': keep = ch === 'video'; break;
      case 'audio': keep = ch === 'audio'; break;
      case 'videoAndAudio': keep = ch === 'video' || ch === 'audio'; break;
      case 'vcrBasis': keep = gatesOf(p, sources.liDaily[id]).vcrElig; break;
      case 'cpvBasis': keep = gatesOf(p, sources.liDaily[id]).cpvBasis; break;
      case 'running': keep = status(p, asOf, 'now') === 'running'; break;
      case 'withConversions': keep = !cvBlocksTotals(sources.liDaily, String(id)); break;
      case 'withPlan': keep = (p.planImpr || 0) > 0; break;
      default: keep = false;
    }
    if (keep) out.push(id);
  }
  return out;
}

export const grossOf = (plan, rawPlan) => { const raw = rawPlan || plan; return raw && raw.k > 0 && raw.k < 1 ? raw.k : 1; };

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const monthStart = (d) => d.slice(0, 8) + '01';
const monthEnd = (d) => { const [y, m] = d.split('-').map(Number); return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1); };
const unitGate = (p, unit) => {
  const rt = rateOf(p);
  if (unit === 'clicks') return rt === 'CPC';
  if (unit === 'views') return rt === 'CPV';
  if (unit === 'buyUnit') return true;
  if (unit === 'installs') return rt === 'CPI';
  return rt !== 'CPC' && rt !== 'CPV' && rt !== 'CPI'; // impressions — CPI is its own unit, ours
};

/**
 * planSpan(plan, rawPlan, kind, chip, w) → { value, leaves }. One line's plan over a span.
 *   kind: 'budget' (chip.money: cost | clientNet | clientGross) | 'plannedUnits' (chip.unit)
 *   w: { range, planWindow, anchor, asOf, scope }
 * Every legacy reading is one cell of this table (spec §2.2, last column); the cells with
 * no legacy take the natural curve. `leaves` = the span's calendar sits outside w.scope.
 * `k` of 1 keeps every non-gross value bit-identical (x / 1 === x).
 */
export function planSpan(plan, rawPlan, kind, chip, w) {
  const span = chip.span || 'wholePlan';
  const money = chip.money || 'cost';
  const unit = chip.unit || 'impressions';
  const net = money === 'clientGross' ? 'clientNet' : money;
  const k = money === 'clientGross' ? grossOf(plan, rawPlan) : 1;
  const over = (range) => (kind === 'plannedUnits' ? unitsInWindow(plan, range) : net === 'cost' ? costInWindow(plan, range) : budgetInWindow(plan, range));
  const whole = () => (kind === 'plannedUnits' ? (plan.planImpr || 0) : net === 'cost' ? costBudOf(plan) : (plan.budget || 0));
  if (kind === 'plannedUnits' && !unitGate(plan, unit)) return { value: 0, leaves: false };
  let value; let leaves = false;
  switch (span) {
    case 'wholePlan': value = whole(); break;
    case 'widgetPeriod': value = w.planWindow ? over(w.planWindow) : whole(); break;
    case 'widgetToDate':
      if (kind === 'plannedUnits') value = w.range ? cachedProrateRange(plan, w.range, w.asOf).eI : prorate(plan, w.asOf).eI;
      else if (net === 'cost') value = w.range ? cachedProrateRange(plan, w.range, w.asOf).costPr : costBudOf(plan);
      else value = budgetToDate(plan, w.range, w.asOf);
      break;
    case 'toDate':
      if (kind === 'plannedUnits') value = prorate(plan, w.asOf).eI;
      else if (net === 'cost') value = prorate(plan, w.asOf).costPr;
      else value = budgetToDate(plan, null, w.asOf);
      break;
    case 'wholeMonth': case 'monthToDate': case 'previousMonth': {
      const a = w.anchor;
      if (!a) return { value: 0, leaves: false };
      const ms = monthStart(a);
      const range = span === 'wholeMonth' ? { from: ms, to: monthEnd(a) }
        : span === 'monthToDate' ? { from: ms, to: a }
          : { from: monthStart(addDays(ms, -1)), to: addDays(ms, -1) };
      leaves = !!(w.scope && (range.from < w.scope.from || range.to > w.scope.to));
      value = over(range);
      break;
    }
    default: value = whole();
  }
  return { value: value / k, leaves };
}
