import { highlightHasFacts, buildSeriesModel, kpiHighlightValue, campaignWindowScalars } from './widget-data.js';
import { isCmBearing, cmPairMarkerOf, cmFieldRefusal } from './cm-formula-context.js';
import { cmHighlightOne, cmHighlightSeries } from './cm-highlight-read.js';
import { FIELDS_PLAN } from './widget-formula.js';
import { layoutReading } from './layout-readings.js';
import { isVcrEligible } from './metrics.js';

const colors = {
  red: 'var(--status-red)', amber: 'var(--status-amber)', green: 'var(--status-green)',
  blue: 'var(--status-blue)', purple: 'var(--pal-4)', muted: 'var(--text-secondary)',
};
export const highlightPaint = (color) => Object.hasOwn(colors, color) ? colors[color] : undefined;
export function highlightTextStyle(result) {
  const style = result?.style;
  if (!style) return undefined;
  return {
    ...(style.color ? { color: highlightPaint(style.color) } : null),
    ...(style.background ? { backgroundColor: `color-mix(in srgb, ${highlightPaint(style.background)} 16%, transparent)` } : null),
    ...(typeof style.bold === 'boolean' ? { fontWeight: style.bold ? 700 : 400 } : null),
  };
}

const numeric = (value) => Number.isFinite(value) ? value : null;
const readNumber = (value) => {
  if (value && typeof value === 'object') return value.error || value.absent ? null : numeric(value.value);
  return numeric(value);
};
function operandValue(operand, ctx) {
  if (!operand) return null;
  if (operand.kind === 'number') return numeric(operand.value);
  if (operand.kind === 'formula') return readNumber(ctx.readFormula?.(operand.expr));
  const base = readNumber(ctx[operand.kind]);
  return base == null ? null : numeric(base * (operand.factor ?? 1) + (operand.offset ?? 0));
}
const compare = {
  gt: (v, a) => v > a, gte: (v, a) => v >= a, lt: (v, a) => v < a,
  lte: (v, a) => v <= a, eq: (v, a) => v === a, neq: (v, a) => v !== a,
  between: (v, a, b) => v >= a && v <= b, outside: (v, a, b) => v < a || v > b,
};

/** Later matches override only authored style properties. No highlight means no
 * rendering overrides; unavailable is separate from a rule that did not match. */
export function evaluateHighlights(rules, ctx = {}) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const result = { style: {}, notes: [], matched: [], unavailable: [] };
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    const unavailable = (reason) => result.unavailable.push({ id: rule.id, reason });
    let value = readNumber(ctx.value);
    if (rule.input?.expr) value = readNumber(ctx.readFormula?.(rule.input.expr));
    else if (rule.input?.reading) value = readNumber(ctx.readReading?.(rule.input.reading));
    else if (rule.input?.kind === 'share') value = readNumber(ctx.share);
    else if (ctx.available === false) value = null;
    if (value == null) { unavailable('Value unavailable'); continue; }
    if (rule.guard) {
      const volume = readNumber(ctx.readFormula?.(rule.guard.expr));
      if (volume == null) { unavailable('Data volume unavailable'); continue; }
      if (volume < rule.guard.min) { unavailable('Not enough data'); continue; }
    }
    const condition = rule.condition;
    const lower = operandValue(condition?.threshold, ctx);
    const range = condition?.op === 'between' || condition?.op === 'outside';
    const upper = range ? operandValue(condition.upper, ctx) : null;
    if (lower == null || (range && (upper == null || upper < lower))) {
      unavailable('Comparison unavailable'); continue;
    }
    if (!Object.hasOwn(compare, condition?.op) || !compare[condition.op](value, lower, upper)) continue;
    Object.assign(result.style, rule.style);
    result.matched.push(rule.id);
    if (rule.note && !result.notes.includes(rule.note)) result.notes.push(rule.note);
  }
  return result;
}

/** Expressions used by one owner, collected once for batched contextual reads. */
export function highlightExpressions(rules) {
  const expressions = new Set();
  for (const rule of rules || []) {
    if (!rule || rule.enabled === false) continue;
    for (const item of [rule.input, rule.guard, rule.condition?.threshold, rule.condition?.upper]) {
      if (typeof item?.expr === 'string') expressions.add(item.expr);
    }
  }
  return [...expressions];
}

/**
 * A Layout block's highlight expression read off the CM360 pairs (2026-09-18): the block's own
 * window for a block, a stat-row cell, a target or a marker, and the mini chart's calendar for
 * a line. It is the reading the block's VALUE already takes (`bindValue`'s cm arm and
 * `cmMiniLine` in brick-data.js: the same reader on the Layout context, the same field gate,
 * the same window plan), under the highlight canon (cm-highlight-read.js), so a rule and the
 * number it colours stand on one join.
 *
 * null is «Value unavailable»: no reader yet (the file has not landed, or a filter masked the
 * bundle), a name the pairs cannot serve, or a plan field with no plan published.
 *
 * Cached by the READER first and the data second, never by the data alone: the delivery cache
 * below outlives a CM360 file landing and a focus change, and a CM360 reading must not.
 */
const brickCmReadings = new WeakMap();
function brickCmReading(expr, ctx, dated) {
  const data = ctx.data;
  const cmRead = ctx.cmRead;
  if (!cmRead) return null;
  let byData = brickCmReadings.get(cmRead);
  if (!byData) { byData = new WeakMap(); brickCmReadings.set(cmRead, byData); }
  let cache = byData.get(data);
  if (!cache) { cache = new Map(); byData.set(data, cache); }
  const key = `${dated ? 'date' : 'agg'}:${expr}`;
  if (cache.has(key)) return cache.get(key);
  const marker = cmPairMarkerOf(expr);
  let reading = null;
  if (marker && !cmFieldRefusal(marker, FIELDS_PLAN)) {
    const scalars = marker.planFields.length ? campaignWindowScalars(data.range, data.sources) : null;
    if (!marker.planFields.length || scalars) {
      if (!dated) reading = cmHighlightOne(expr, (metric) => cmRead.totals(metric), scalars);
      else {
        const dates = buildSeriesModel([], data.range, data.sources, true).dates;
        const values = cmHighlightSeries(expr, dates, (metric, date) => cmRead.atDate(metric, date), scalars) || [];
        reading = { dates, values, byDate: new Map(dates.map((date, i) => [date, values[i]])) };
      }
    }
  }
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  cache.set(key, reading);
  return reading;
}

const brickReaders = new WeakMap();
export function createBrickHighlightReader(ctx) {
  const data = ctx?.data;
  if (!data?.sources) return () => null;
  const cacheable = Object.isFrozen(data.sources);
  let cache = cacheable ? brickReaders.get(data) : null;
  if (!cache) { cache = new Map(); if (cacheable) brickReaders.set(data, cache); }
  return (expr, extra = {}) => {
    const dated = extra?.date != null || extra?.index != null || extra?.formulaContext === 'date';
    // A cm-bearing expression is never the delivery engine's (it has no field called cmIm),
    // and on a block whose OWN value reads CM360 every expression is read off the pairs, as it
    // is on a cm-fed column: `im` there is the matched population's delivery, not the scope's.
    if (extra?.onPairs || isCmBearing(expr)) {
      const onPairs = brickCmReading(expr, ctx, dated);
      if (!dated) return onPairs ?? null;
      return (extra.date != null ? onPairs?.byDate.get(extra.date) : onPairs?.values[extra.index]) ?? null;
    }
    const key = `${dated ? 'date' : 'agg'}:${expr}`;
    if (!cache.has(key)) {
      if (dated) {
        const out = buildSeriesModel([{ id: 'highlight', expr }], data.range, data.sources, true);
        cache.set(key, out.errors.highlight ? null : {
          dates: out.dates, values: out.series[0]?.values || [],
          byDate: new Map(out.dates.map((date, i) => [date, out.series[0]?.values[i]])),
        });
      } else cache.set(key, kpiHighlightValue(expr, data.range, data.sources).value);
      if (cache.size > 128) cache.delete(cache.keys().next().value);
    }
    const reading = cache.get(key);
    return dated ? (extra.date != null ? reading?.byDate.get(extra.date) : reading?.values[extra.index]) ?? null : reading;
  };
}

const FACT_METRICS = new Set([
  'margin', 'marginbar', 'pacing', 'delivery', 'cpm', 'cpc', 'cpv', 'ctr', 'vcr', 'spend', 'budget',
  'imprActual', 'imprToDatePct', 'imprDeviation', 'paceDeltaImpr', 'dynCpm', 'forecastDspSpend', 'neededSpendPerDay',
  'hitBudgetAddImpr', 'hitBudgetAddViews', 'hitBudgetAddClicks', 'hitBudgetPerDayImpr', 'hitBudgetPerDayViews',
  'hitBudgetPerDayClicks', 'hitBudgetAddInstalls', 'hitBudgetPerDayInstalls', 'hitBudgetProjected', 'hitBudgetGap',
  // The buy-unit twins (2026-10-05): same facts, on whichever unit the pacing is bought on.
  'unitActual', 'unitToDatePct', 'unitDeviation', 'paceDeltaUnit',
]);
// CTR is not here (owner decision 2026-09-23): it counts every line's impressions, so a
// CPC-only pacing's facts are a CTR's facts too.
const IMPRESSION_METRICS = new Set(['imprActual', 'imprToDatePct', 'imprDeviation', 'paceDeltaImpr', 'dynCpm', 'cpm', 'forecastDspSpend']);
const FLIGHT_FACT_METRICS = new Set(['forecastDspSpend', 'neededSpendPerDay', 'hitBudgetAddImpr', 'hitBudgetAddViews',
  'hitBudgetAddClicks', 'hitBudgetPerDayImpr', 'hitBudgetPerDayViews', 'hitBudgetPerDayClicks', 'hitBudgetAddInstalls',
  'hitBudgetPerDayInstalls', 'hitBudgetProjected', 'hitBudgetGap']);
// The «Impressions to Hit Budget» readings that stand on one unit's lines (2026-09-29).
const HIT_BUDGET_UNIT = { __proto__: null, hitBudgetAddImpr: 'impr', hitBudgetPerDayImpr: 'impr',
  hitBudgetAddViews: 'views', hitBudgetPerDayViews: 'views', hitBudgetAddClicks: 'clicks', hitBudgetPerDayClicks: 'clicks',
  hitBudgetAddInstalls: 'installs', hitBudgetPerDayInstalls: 'installs' };
/** The buy-unit metrics, whose unit is the pacing's answer rather than the metric's — resolved
 *  exactly the way the `delivery` preset below resolves its own. */
const BUY_UNIT_METRICS = new Set(['unitActual', 'unitToDatePct', 'unitDeviation', 'paceDeltaUnit']);
const RATE_METRICS = new Set(['ctr', 'cpm', 'cpc', 'cpv', 'vcr']);
const has = (object, key) => object != null && Object.hasOwn(object, key);
const scopeIds = (ctx) => ctx?.effLIs ?? ctx?.data?.sources?.effLIs;
const canonicalSources = new WeakMap();

function campaignHighlightSources(ctx) {
  const sources = ctx?.data?.sources;
  if (!sources) return null;
  const ids = scopeIds(ctx) || Object.keys(sources.liPlan || {});
  const immutable = Object.isFrozen(sources);
  let cached = immutable ? canonicalSources.get(sources) : null;
  if (!cached) { cached = new Map(); if (immutable) canonicalSources.set(sources, cached); }
  const key = JSON.stringify(ids);
  if (!cached.has(key)) {
    // Keep dimension getters lazy, exactly as the canonical report reader does.
    const scoped = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(sources),
      liDaily: { value: sources.campaignLiDaily || sources.liDaily, enumerable: true },
      effLIs: { value: ids, enumerable: true },
    });
    cached.set(key, immutable ? Object.freeze(scoped) : scoped);
    if (cached.size > 16) cached.delete(cached.keys().next().value);
  }
  return cached.get(key);
}

function defaultDenominatorAvailable(owner, ctx) {
  const metric = owner.bind?.metric;
  if (RATE_METRICS.has(metric) && ctx?.data?.sources) {
    // Reuse the existing eligible-basis and denominator checks; the number
    // being painted still comes from the canonical brick reading.
    return readNumber(kpiHighlightValue(metric, ctx.data.range, campaignHighlightSources(ctx))) != null;
  }
  const cm = metric === 'forecastDspSpend' ? ctx?.flCM : ctx?.cm;
  const field = ['cpm', 'dynCpm', 'forecastDspSpend'].includes(metric) ? 'imprActual'
    : metric === 'ctr' ? 'imAll' : metric === 'cpc' ? 'cl' : metric === 'margin' || metric === 'marginbar' ? 'clientPr'
      : metric === 'budget' ? 'costPr' : metric === 'imprToDatePct' ? 'imprExpected' : null;
  // A minimal preview can carry the already calculated value without all its
  // inputs. An explicitly provided zero denominator, however, is unavailable.
  if (field && has(cm, field)) return cm[field] > 0;
  return true;
}

function domainReading(key, ctx) {
  const ids = scopeIds(ctx);
  if (Array.isArray(ids) && !ids.length) return null;
  // A supplied domain value remains valid in previews without a fact snapshot.
  // Missing metrics must not become layoutReading's fallback zero, however.
  const source = key === 'flight.remaining' ? ctx?.flCM : ctx?.cm;
  const field = { 'flight.remaining': 'daysLeft', 'flight.day': 'flightSpanDay', 'flight.total': 'flightSpanDays' }[key];
  return field && Number.isFinite(source?.[field]) ? layoutReading(key, ctx) : null;
}

function factPolicy(owner, ctx, extra) {
  if (extra.readingKind === 'plan') return null;
  const metric = owner.bind?.metric;
  if (metric) {
    if (!FACT_METRICS.has(metric)) return null;
    let unit = IMPRESSION_METRICS.has(metric) ? 'impr' : metric === 'vcr' ? 'vcr' : metric === 'cpv' ? 'cpvRate'
      : HIT_BUDGET_UNIT[metric] || null;
    if (metric === 'delivery' || BUY_UNIT_METRICS.has(metric)) {
      // The same unit the Delivery reading picks: on the whole-flight plan, so a narrowed
      // window holding none of the impressions plan does not flip it (2026-09-23).
      const cm = ctx?.cm;
      unit = (cm?.imprPlanFlight ?? cm?.pI) > 0 ? 'impr' : (cm?.clicksPlanFlight ?? cm?.clicksPlan) > 0 ? 'clicks' : 'views';
    }
    return { unit, flight: FLIGHT_FACT_METRICS.has(metric) };
  }
  if (owner.type === 'unitBars') return { unit: extra.unit };
  if (owner.type === 'rateRows') return owner.series === 'planRate' ? null : {
    unit: extra.unit, flight: owner.series === 'bidPair',
  };
  if (owner.type === 'detailCard' && owner.source) {
    if (owner.source === 'planUnits' || owner.source === 'planRate') return null;
    if (owner.source === 'neededPerDay') return extra.unit === 'spend' ? { flight: true } : null;
    return { unit: extra.unit, date: owner.source === 'latestDay' ? (ctx?.facts?.asOf ?? ctx?.data?.sources?.asOf) : undefined };
  }
  return null;
}

function defaultFactsAvailable(owner, ctx, extra) {
  const policy = factPolicy(owner, ctx, extra);
  if (!policy) return true;
  const sources = ctx?.data?.sources;
  // Canonical Layout readings use Scope facts, whereas authored formulas use
  // Lens facts. A Lens with no matches must not erase a measured campaign value.
  const daily = sources?.campaignLiDaily ?? sources?.liDaily ?? ctx?.facts?.liDaily;
  const ids = scopeIds(ctx);
  if (Array.isArray(ids) && !ids.length) return false;
  if (daily && typeof daily === 'object') {
    const plans = sources?.liPlan || ctx?.liPlan || {};
    const unit = String(policy.unit || '').toLowerCase();
    const scoped = (Array.isArray(ids) ? ids : Object.keys(daily)).filter((id) => {
      const plan = plans[id];
      // The shared presence helper rejects rows whose owning plan is missing.
      if (!plan) return true;
      const rate = plan.rateType || 'CPM';
      if (['impr', 'impressions', 'cpm'].includes(unit)) return rate !== 'CPC' && rate !== 'CPV';
      if (unit === 'clicks' || unit === 'cpc') return rate === 'CPC';
      if (unit === 'views' || unit === 'cpv') return rate === 'CPV';
      if (unit === 'vcr') return isVcrEligible(plan, daily[id]);
      if (unit === 'cpvrate') return (rate === 'CPV' || isVcrEligible(plan, daily[id])) && (plan.ch || '').toLowerCase() !== 'audio';
      return true;
    });
    if (owner.source === 'latestDay' && !policy.date) return false;
    const range = policy.date ? { from: policy.date, to: policy.date } : policy.flight ? null : ctx?.data?.range;
    return highlightHasFacts({ liDaily: daily, liPlan: plans }, range, scoped);
  }
  // A facts object explicitly says whether any delivery has arrived. With no
  // source metadata at all, trust the numeric reading provided by the renderer.
  if (has(ctx, 'facts')) return !!ctx.facts?.asOf;
  if (has(sources, 'asOf')) return !!sources.asOf;
  return true;
}

export function brickHighlightResult(owner, ctx, reading = {}, extra = {}) {
  if (!owner?.highlights?.length) return null;
  const reader = createBrickHighlightReader(ctx);
  // Follow brickValue's binding precedence: a canonical/domain reading wins
  // over any stale expr key still present in a repairable draft.
  const holder = owner.bind?.metric || owner.bind?.reading ? null : owner.bind?.expr ? owner.bind : owner.expr ? owner : null;
  const expr = holder ? holder.expr : null;
  // A block whose own value reads CM360 has every rule expression read off the pairs. The
  // HOLDER is asked (the bind, or the line itself), so a CM360 chip counts as the text did.
  const onPairs = isCmBearing(holder);
  const readFormula = extra.readFormula || ((formula) => reader(formula, { ...extra, onPairs }));
  const available = !reading.error && !reading.absent && (expr ? readNumber(readFormula(expr)) != null
    : owner.bind?.reading ? readNumber(domainReading(owner.bind.reading, ctx)) != null
      : defaultFactsAvailable(owner, ctx, extra) && defaultDenominatorAvailable(owner, ctx));
  const reference = (bind, value) => {
    if (!bind) return value;
    if (bind.reading) return readNumber(domainReading(bind.reading, ctx)) == null ? null : value;
    if (bind.metric) {
      const referenceOwner = { bind };
      return defaultFactsAvailable(referenceOwner, ctx, {}) && defaultDenominatorAvailable(referenceOwner, ctx) ? value : null;
    }
    return bind.expr && readNumber(reader(bind.expr)) == null ? null : value;
  };
  // A self-target names the preset's plan, not its actual reading. Explicit
  // formula Target/Marker bindings still need strict validation of their own.
  const selfTarget = owner.target?.metric && owner.target.metric === owner.bind?.metric;
  let target = selfTarget ? reading.target : reference(owner.target, reading.target);
  if ((!owner.target || selfTarget) && ['ctr', 'vcr', 'cpm'].includes(owner.bind?.metric) && !(readNumber(target) > 0)) target = null;
  return evaluateHighlights(owner.highlights, {
    ...reading, ...extra, target, marker: reference(owner.tick, extra.marker), available, readFormula,
    readReading: (key) => domainReading(key, ctx),
  });
}
