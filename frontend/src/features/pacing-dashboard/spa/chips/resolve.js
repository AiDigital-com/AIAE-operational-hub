// workspace/src/lib/dashboard/chips/resolve.js — a chip becomes a number (spec §4.2).
//
// Two paths, tried in this order:
//   1. the LEGACY FAST PATH: a chip whose settings are exactly what the grain read before
//      chips existed reads the legacy name off the legacy context (the aggregate's
//      campaignReadingContext, the row's own sums and scalars), so a migrated formula is
//      the same float path as before (tests/chip-legacy-parity-test.mjs);
//   2. the GENERIC PATH: the line records over (window, lines) combined, then the field,
//      the ratio or the plan span.
// A holder is evaluated with the strict evaluator over its chips' numbers.
import FormulaChips from '@shared/formula-chips';
import { holderInfo, CHIPS_NOT_READABLE } from './info.js';
import { compileHolder, evaluateStrict } from './strict.js';
import { resolveChipWindow, CHIP_LEAVES } from './windows.js';
import { windowRecord, withExpected, combine, dataDays, linesOf, planSpan, grossOf } from './line-facts.js';
import {
  campaignReadingContext, campaignScalars, planWindowOf, expectedBounds, zeroFlow, ratesFromSums, cvOffIds,
} from '../widget-data.js';
import { cvOnlyDaysOf } from '../primary-cv.js';

const { CATALOG, CHIP_NOT_YET, SETTING_ORDER, chipForLegacy } = FormulaChips;
export { CHIP_LEAVES };
export const CHIP_CM_NOT_YET = 'A CM360 chip is not available yet';
export const CHIP_NO_DATE_AXIS = 'rolling(), cumsum() and shift() need a date axis';

// ── the legacy fast path: chip → legacy name, per placement ─────────────────────────────────
const LEGACY_NAMES = ['im', 'cl', 'co', 'sp', 'dc', 'lc', 'rc', 'st', 'q1', 'q2', 'q3', 'imV', 'coV', 'coViews', 'cv', 'pc', 'pv',
  'ctr', 'vcr', 'acr', 'cpm', 'cpc', 'cpv', 'budget', 'budgetTotal', 'budgetToDate', 'costBud', 'costBudTotal',
  'planImpr', 'planImprTotal', 'planClicks', 'planClicksTotal', 'planViews', 'planViewsTotal', 'tgtCpm', 'mTgt', 'ctrT', 'vcrT', 'acrT',
  'expIm', 'imprExpected', 'expCo', 'expCl', 'clExpected', 'expVw', 'daysLeft', 'daysPassed'];
// A chip with its defaults dropped, in the stored key order, so two spellings of one reading
// are one lookup key (chipForLegacy writes literal objects in its own key order).
function canonical(chip) {
  const out = { base: chip.base };
  const settings = CATALOG[chip.base] ? CATALOG[chip.base].settings : {};
  for (const k of SETTING_ORDER) {
    if (k === 'base' || chip[k] === undefined) continue;
    const st = settings[k];
    if (k === 'period') { if (chip.period && chip.period.kind !== 'widget') out.period = chip.period; continue; }
    if (st && st.options && chip[k] === st.def) continue;
    out[k] = chip[k];
  }
  return JSON.stringify(out);
}
const reverse = new Map();
function legacyNameOf(chip, placement) {
  const pk = `${placement.grain}|${placement.role}`;
  let table = reverse.get(pk);
  if (!table) {
    table = new Map();
    for (const name of LEGACY_NAMES) { const c = chipForLegacy(name, placement); if (c) table.set(canonical(c), name); }
    reverse.set(pk, table);
  }
  return table.get(canonical(chip)) || null;
}

// ── fields ──────────────────────────────────────────────────────────────────────────────────
const FIELD_OF = { impressions: 'im', clicks: 'cl', linkClicks: 'lc', reach: 'rc', videoStarts: 'st', firstQuartiles: 'q1', midpoints: 'q2', thirdQuartiles: 'q3' };
function sumField(chip) {
  if (chip.base === 'completes') return chip.basis === 'viewsVolume' ? 'coViews' : chip.basis === 'vcrBasis' ? 'coV' : 'co';
  if (chip.base === 'conversions') return chip.type === 'pc' ? 'pc' : chip.type === 'pv' ? 'pv' : 'cv';
  if (chip.base === 'spend') return (chip.money || 'media') === 'media' ? 'sp' : 'dc';
  return FIELD_OF[chip.base] || null;
}
const CV_FIELD = new Set(['cv', 'pc', 'pv']);
const RATE = {
  avgCpm: { num: 'sp', den: 'im', scale: 1000, moneyNum: true },
  avgCpc: { num: 'sp', den: 'cl', scale: 1, moneyNum: true },
  avgCpv: { num: 'sp', den: 'co', scale: 1, moneyNum: true },
  ctr: { num: 'cl', den: 'im', scale: 100 },
  vcr: { num: 'co', den: 'im', scale: 100 },
  acr: { num: 'co', den: 'im', scale: 100 },
  cpa: { num: 'dc', den: 'cv', scale: 1, moneyNum: true },
};
const TARGET_SCALAR = { ctrTarget: 'ctrT', vcrTarget: 'vcrT', acrTarget: 'acrT', marginTarget: 'mTgt', daysLeft: 'daysLeft', daysPassed: 'daysPassed' };
const linesDefault = (def) => (def.settings.lines ? def.settings.lines.def : 'all');

// ── environment: the records and day lists of one frozen snapshot ───────────────────────────
const envCache = new WeakMap();
const RECORD_BOUND = 64;
function envOf(sources) {
  const frozenSources = sources && Object.isFrozen(sources);
  let e = frozenSources ? envCache.get(sources) : null;
  if (e) return e;
  e = { records: new Map(), days: new Map(), lines: new Map(), campaign: new Map() };
  if (frozenSources) envCache.set(sources, e);
  return e;
}
function bounded(map, bound) { if (map.size > bound) map.delete(map.keys().next().value); }
function recordOf(sources, env, id, window) {
  if (window.kind === 'empty' || window.kind === 'leaves') return zeroFlow();   // no days: a record of zeros, never the whole flight
  const key = `${window.key}|${id}`;
  const hit = env.records.get(key); if (hit) return hit;
  const filter = window.kind === 'range' ? { kind: 'range', from: window.from, to: window.to } : window.kind === 'dates' ? { kind: 'dates', dates: window.dates } : { kind: 'all' };
  const rec = windowRecord(sources.liDaily, sources.liPlan[id], id, filter);
  env.records.set(key, rec); bounded(env.records, RECORD_BOUND);
  return rec;
}
function linesCached(sources, env, lines) {
  const key = `${lines || 'all'}|${sources.asOf || ''}`;
  let ids = env.lines.get(key);
  if (!ids) { ids = linesOf(sources, lines || 'all', sources.asOf); env.lines.set(key, ids); }
  return ids;
}
function windowEnv(sources, range, env, ids) {
  return {
    range: range ? { from: range.from, to: range.to } : null, asOf: sources.asOf, flightStart: sources.flightStart, flightEnd: sources.flightEnd,
    scope: sources.scope || null, ids,
    dataDaysOf: (list) => {
      const key = list.join(',');
      let d = env.days.get(key);
      if (!d) { d = dataDays(sources.liDaily, list, sources.liPlan, cvOnlyDaysOf(sources.liDaily)); env.days.set(key, d); bounded(env.days, 8); }
      return d;
    },
  };
}
// The calendar a window covers, for the conversions test: a date set's first to last day, so a
// chip over the last N data days is nulled only by a line whose flight touches those days.
const spanOf = (window, range) => (window.kind === 'range' ? { from: window.from, to: window.to }
  : window.kind === 'dates' ? { from: window.list[0], to: window.list[window.list.length - 1] } : range);
// A plan span's month is anchored where windows.js anchors a fact window: the last data day
// inside the scope and the flight, never the widget's own range end (plan decision f), so
// `Budget · Month to date` and `Spend · Month to date` on one widget read one month. No asOf
// means no data day and no anchor: the span reads 0, as the fact window reads empty.
const planW = (sources, range) => ({ range: range ? { from: range.from, to: range.to } : null, planWindow: planWindowOf(sources, range),
  anchor: sources.asOf ? [sources.asOf, sources.scope && sources.scope.to, sources.flightEnd].filter(Boolean).sort()[0] : null, asOf: sources.asOf, scope: sources.scope || null });

/** What this phase does not serve, as the sentence the slot prints. Null when it is served. */
function notYet(chip) {
  const def = CATALOG[chip.base];
  if (!def) return CHIPS_NOT_READABLE;
  if (FormulaChips.chipIsCm(chip)) return CHIP_CM_NOT_YET;
  if (def.family === 'aggregate' || def.family === 'source') return CHIP_NOT_YET;
  if (['delivered', 'remaining', 'paceIndex', 'neededPerDay', 'projected', 'daysWithData', 'lineStatus'].includes(chip.base)) return CHIP_NOT_YET;
  if (chip.base === 'expected' && ((chip.reading && chip.reading !== 'total') || (chip.upTo && chip.upTo !== 'lastDataDay'))) return CHIP_NOT_YET;
  if (chip.base === 'daysLeft' && (chip.to === 'endOfMonth' || chip.to === 'endOfPeriod')) return CHIP_NOT_YET;
  if (chip.base === 'daysPassed' && chip.through && chip.through !== 'flight') return CHIP_NOT_YET;
  if ((chip.base === 'conversions' || chip.base === 'cpa') && chip.count && chip.count !== 'primary') return CHIP_NOT_YET;
  if (chip.base === 'cpa' && chip.type && chip.type !== 'all') return CHIP_NOT_YET;
  if (chip.base === 'marginTarget' && chip.weight && chip.weight !== 'clientBudget') return CHIP_NOT_YET;
  return null;
}
export const chipNotYet = notYet;

/** The window's expected deltas over a subset of lines, summed the way campaignReadingContext sums them. */
function expectedOver(sources, range, ids) {
  const out = { expIm: 0, expCo: 0, expCl: 0, expVw: 0, imprExpected: 0, clExpected: 0 };
  const bounds = expectedBounds(sources, range);
  for (const id of ids) {
    const e = withExpected(zeroFlow(), sources.liPlan[id], bounds);
    for (const k of Object.keys(out)) out[k] += e[k] || 0;
  }
  return out;
}
function readExpected(chip, get) {
  const unit = chip.unit || 'buyUnit';
  const name = unit === 'buyUnit' || unit === 'mixed' ? 'expIm' : unit === 'impressions' ? 'imprExpected' : unit === 'clicks' ? 'expCl' : unit === 'clickPaced' ? 'clExpected' : unit === 'views' ? 'expVw' : 'expCo';
  return get(name);
}

// ── the aggregate read ──────────────────────────────────────────────────────────────────────
/** readChipAgg(chip, sources, range, opts) → number | null | { error }. `opts.ids` restricts the
 *  cut (a kept subset's Totals); without it the whole cut's legacy context answers. */
export function readChipAgg(chip, sources, range, opts = {}) {
  const why = notYet(chip); if (why) return { error: why };
  const def = CATALOG[chip.base];
  const ctx = campaignReadingContext(sources, range);
  const env = envOf(sources);
  // A kept subset's ids in the cut's own order, whatever order the caller passed: every path
  // below sums in effLIs order, so a subset Totals is the legacy subset()'s float path.
  const want = opts.ids ? new Set([...opts.ids].map(String)) : null;   // any iterable: retotal hands a Set
  const cutIds = want ? (sources.effLIs || []).filter((id) => want.has(String(id)) && sources.liPlan[id]) : null;
  if (!cutIds) { const name = legacyNameOf(chip, { grain: 'agg', role: 'row', cm: false }); if (name) return ctx.get(name); }
  if (def.family === 'plan' || def.family === 'days') return readPlanAgg(chip, def, sources, range, ctx, env, cutIds);
  if (def.family === 'expected') return readExpected(chip, (name) => (cutIds ? expectedOver(sources, range, cutIds)[name] : ctx.get(name)));
  // fact chips: lines, window, records
  const lines = chip.lines || linesDefault(def);
  const ids = cutIds ? linesOf(sources, lines, sources.asOf, cutIds) : linesCached(sources, env, lines);
  const window = resolveChipWindow(chip, windowEnv(sources, range, env, ids));
  if (window.kind === 'leaves') return { error: CHIP_LEAVES };
  if (window.kind === 'empty' || !ids.length) return null;
  const field = def.family === 'sum' ? sumField(chip) : null;
  const readsCv = (field && CV_FIELD.has(field)) || chip.base === 'cpa';
  if (readsCv && cvOffIds(sources, ids, spanOf(window, range)).length) return null;
  const records = ids.map((id) => recordOf(sources, env, id, window));
  const grossSum = () => ids.reduce((t, id, i) => t + records[i].dc / grossOf(sources.liPlan[id], sources.rawLiPlan && sources.rawLiPlan[id]), 0);
  if (def.family === 'sum') return chip.money === 'clientGross' ? grossSum() : combine(records)[field];
  const r = RATE[chip.base];
  const t = combine(records);
  const money = chip.money || (chip.base === 'cpa' ? 'clientNet' : 'media');
  const numerator = !r.moneyNum ? t[r.num] : money === 'media' ? t.sp : money === 'clientNet' ? t.dc : grossSum();
  return t[r.den] > 0 ? (numerator / t[r.den]) * r.scale : null;
}

function readPlanAgg(chip, def, sources, range, ctx, env, cutIds) {
  const w = planW(sources, range);
  if (chip.base in TARGET_SCALAR) {
    // The weighted targets and the campaign's days: the whole cut's are the context's own; a
    // subset (a kept Totals, `Lines: running`) weighs them over its lines, with each line's
    // delivered impressions in the window as the CTR target's weight, exactly as the engine does.
    const lines = chip.lines || 'all';
    // Both narrow the set: the kept subset (opts.ids) and the chip's own Lines.
    const sub = cutIds ? (lines !== 'all' ? linesOf(sources, lines, sources.asOf, cutIds) : cutIds)
      : (lines !== 'all' ? linesOf(sources, lines, sources.asOf) : null);
    if (!sub) return ctx.scalars()[TARGET_SCALAR[chip.base]];
    const win = resolveChipWindow({ base: 'spend' }, windowEnv(sources, range, env, sub));
    const scalars = campaignScalars(sources.liPlan, sub, sources.asOf, sources.flightStart, sources.flightEnd, w.range, false, w.planWindow,
      (id) => recordOf(sources, env, id, win).im);
    return scalars[TARGET_SCALAR[chip.base]];
  }
  const lines = chip.lines || linesDefault(def);
  const ids = linesOf(sources, lines, sources.asOf, cutIds || sources.effLIs);
  if (chip.base === 'planCpm' || chip.base === 'planCpc' || chip.base === 'planCpv') {
    const want = chip.base === 'planCpm' ? (lines === 'impressionPaced' ? null : 'CPM') : chip.base === 'planCpc' ? 'CPC' : 'CPV';
    let cost = 0, units = 0;
    for (const id of ids) {
      const p = sources.liPlan[id]; const rt = p.rateType || 'CPM';
      // The `want: null` branch is a blacklist, so an install-paced line was summed into plan
      // CPM with its planImpr — which holds the INSTALL goal, not impressions. CPI is ours.
      if (want ? rt !== want : (rt === 'CPC' || rt === 'CPV' || rt === 'CPI')) continue;
      cost += planSpan(p, sources.rawLiPlan && sources.rawLiPlan[id], 'budget', { base: 'budget', money: chip.money || 'cost' }, w).value;
      units += Number(p.planImpr) || 0;
    }
    return units > 0 ? (cost / units) * (chip.base === 'planCpm' ? 1000 : 1) : null;
  }
  const kind = chip.base === 'plannedUnits' ? 'plannedUnits' : 'budget';
  let total = 0; let leaves = false;
  for (const id of ids) { const s = planSpan(sources.liPlan[id], sources.rawLiPlan && sources.rawLiPlan[id], kind, chip, w); total += s.value; leaves = leaves || s.leaves; }
  return leaves ? { error: CHIP_LEAVES } : total;
}

// ── the line item row read ──────────────────────────────────────────────────────────────────
/** readChipLine(chip, line, sources, range) → number | null | { error }. `line` = { id, plan, sums, scalars }. */
export function readChipLine(chip, line, sources, range) {
  const why = notYet(chip); if (why) return { error: why };
  const def = CATALOG[chip.base];
  const name = legacyNameOf(chip, { grain: 'li', role: 'row', cm: false });
  if (name) {
    // The row's own context on the entity basis, the read the legacy column made, null kept
    // (the legacy formula flattened it to 0; plan decision (a): a chip prints empty there).
    const rates = ratesFromSums(line.sums, 'entity');
    if (name in rates) return rates[name];
    if (name in line.sums) return line.sums[name];
    return name in line.scalars ? line.scalars[name] : null;
  }
  const env = envOf(sources);
  const w = planW(sources, range);
  const own = (lines) => lines === 'all' || linesOf(sources, lines, sources.asOf, [line.id]).length > 0;
  if (def.family === 'plan' || def.family === 'days') {
    if (chip.base === 'daysLeft') {
      // A row outside Lines reads empty whatever To says (spec 4.2's row rule, as every plan
      // chip here). Inside it, `To: Line's own end` is the row's own days (the fast path when
      // Lines is default too); `To: Last line's end` is the campaign's last line over the Lines
      // set (spec 2.2), the aggregate's own read, never this row's end.
      if (!own(chip.lines || 'all')) return null;
      if (chip.to === 'own') return line.scalars.daysLeft;
      // One campaign read per (chip, window) on a frozen snapshot, not one per row.
      const key = `${canonical(chip)}|${range ? `${range.from}:${range.to}` : ''}`;
      if (!env.campaign.has(key)) env.campaign.set(key, readPlanAgg(chip, def, sources, range, campaignReadingContext(sources, range), env, null));
      return env.campaign.get(key);
    }
    if (chip.base in TARGET_SCALAR) return line.scalars[TARGET_SCALAR[chip.base]];
    if (chip.base === 'planCpm' || chip.base === 'planCpc' || chip.base === 'planCpv') {
      const rt = line.plan.rateType || 'CPM'; const want = chip.base === 'planCpm' ? 'CPM' : chip.base === 'planCpc' ? 'CPC' : 'CPV';
      if (rt !== want || !((line.plan.planImpr || 0) > 0)) return null;
      const cost = planSpan(line.plan, sources.rawLiPlan && sources.rawLiPlan[line.id], 'budget', { base: 'budget', money: chip.money || 'cost' }, w).value;
      return (cost / line.plan.planImpr) * (chip.base === 'planCpm' ? 1000 : 1);
    }
    if (!own(chip.lines || linesDefault(def))) return null;
    const s = planSpan(line.plan, sources.rawLiPlan && sources.rawLiPlan[line.id], chip.base === 'plannedUnits' ? 'plannedUnits' : 'budget', chip, w);
    return s.leaves ? { error: CHIP_LEAVES } : s.value;
  }
  if (def.family === 'expected') return readExpected(chip, (n) => line.sums[n]);
  const lines = chip.lines || linesDefault(def);
  if (!own(lines)) return null;
  const dayIds = chip.period && chip.period.days === 'row' ? [line.id] : linesCached(sources, env, lines);
  const window = resolveChipWindow(chip, windowEnv(sources, range, env, dayIds));
  if (window.kind === 'leaves') return { error: CHIP_LEAVES };
  if (window.kind === 'empty') return null;
  const field = def.family === 'sum' ? sumField(chip) : null;
  if (((field && CV_FIELD.has(field)) || chip.base === 'cpa') && cvOffIds(sources, [line.id], spanOf(window, range)).length) return null;
  const rec = range && window.key === `r:${range.from}:${range.to}` ? line.sums : recordOf(sources, env, line.id, window);
  const k = chip.money === 'clientGross' ? grossOf(line.plan, sources.rawLiPlan && sources.rawLiPlan[line.id]) : 1;
  if (def.family === 'sum') return chip.money === 'clientGross' ? rec.dc / k : rec[field];
  const r = RATE[chip.base];
  const money = chip.money || (chip.base === 'cpa' ? 'clientNet' : 'media');
  const numerator = !r.moneyNum ? rec[r.num] : money === 'media' ? rec.sp : rec.dc / k;
  return rec[r.den] > 0 ? (numerator / rec[r.den]) * r.scale : null;
}

// ── holders ─────────────────────────────────────────────────────────────────────────────────
function evaluateWith(holder, readRef) {
  if (holderInfo(holder).cm) return { value: null, warned: false, error: CHIP_CM_NOT_YET };
  const c = compileHolder(holder);
  if (c.error) return { value: null, warned: false, error: c.error };
  if (c.windowed) return { value: null, warned: false, error: CHIP_NO_DATE_AXIS };
  let error = null;
  const value = evaluateStrict(c.ast, (ref) => {
    const chip = holder.chips && holder.chips[ref];
    const r = chip ? readRef(chip) : { error: CHIPS_NOT_READABLE };
    if (r && typeof r === 'object' && 'error' in r) { error = error || r.error; return null; }
    return r;
  });
  return { value: error ? null : value, warned: false, error };
}
export const evaluateHolderAgg = (holder, sources, range, opts = {}) => evaluateWith(holder, (chip) => readChipAgg(chip, sources, range, opts));
export const evaluateHolderLine = (holder, line, sources, range) => evaluateWith(holder, (chip) => readChipLine(chip, line, sources, range));
