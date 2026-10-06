// workspace/src/lib/dashboard/line-item-columns.js
// The ONE workspace residence of the Line Items column catalogue (shared/line-item-columns.js,
// Line Items settings spec 2026-10-01), the report-v2 door pattern: every consumer imports
// from here, never from @shared directly. The door adds what only the browser can answer:
// what each card cell PRINTS for one line (`cellFor`), the value a sort orders the lines by
// (`sortValueFor`, `sortLineItems`), and the two per-line rules the hero already uses
// (`lineDaysLeft`, `neededPerDay`). Every default cell reproduces LineItemCard's text byte
// for byte; the eight new ones follow the spec's column table.
import LineItemColumns from '@shared/line-item-columns';
import PacingCore from './pacing-core.js';
import { fI, f$, fP } from './format.js';
import { rateLabel } from './metrics.js';
import { completionLabelForLI } from './completion-label.js';
import { basisLabel } from './coef-rebuild.js';

export const {
  COLUMNS, COLUMN_KEYS, DEFAULT_COLUMNS, MAX_COLUMNS, ROWS_MIN, ROWS_MAX,
  SORT_FIELDS, SORT_FIELD_LABELS, SORT_DIRS, VIEWS, DEFAULTS,
  normLineItems, isDefault,
} = LineItemColumns;

export default LineItemColumns;

/** The settings a card or the tile renders from: absent, null or unreadable → DEFAULTS
 *  (a stored value this build cannot read falls back to today's render, never throws). */
export function resolveLineItemSettings(stored) {
  if (stored === undefined || stored === null) return DEFAULTS;
  const r = normLineItems(stored);
  return r.ok && r.value ? r.value : DEFAULTS;
}

const DASH = '—';
const cell = (label, value, sub = null, valueCls = '', title = undefined) => ({ label, value, sub, valueCls, title });

/** The card's spend colour rule (was LineItemCard's `spendStatus`): the Notifications
 *  thresholds, with the card's old fallbacks when none are handed in. */
export function spendStatusCls(sp, costPr, thresholds) {
  if (!costPr || costPr <= 0) return '';
  const pct = (sp / costPr) * 100;
  if (pct <= (thresholds?.spendWarn ?? 105)) return 'text-[var(--status-green)]';
  if (pct <= (thresholds?.spendBad ?? 115)) return 'text-[var(--status-amber)]';
  return 'text-[var(--status-red)]';
}

/** The card's margin colour rule (was LineItemCard's `marginStatusCls`). */
export function marginStatusCls(mA, mTgt, thresholds) {
  const warnThreshold = thresholds?.marginWarn ?? -5;
  const st = PacingCore.marginStatus(mA, mTgt, warnThreshold);
  return st === 'g' ? 'text-[var(--status-green)]'
    : st === 'w' ? 'text-[var(--status-amber)]'
      : 'text-[var(--status-red)]';
}

/**
 * This line's own days left: calendar, range-free, the hero's per-line rule (metrics.js
 * campM). PacingCore.prorate reads the plan's flight against the data day: a not-started
 * line shows the whole flight, a paused line its calendar days to the flight end, an ended
 * line 0. Never the card's windowed `pacing.dP` (a past Custom range would count days from
 * the window, not from today).
 */
export function lineDaysLeft(effPlan, asOf) {
  const pr = PacingCore.prorate(effPlan, asOf);
  return Math.max(0, pr.fDays - pr.dP);
}

/**
 * Needed per day for one line, the hero's rule: 0 while paused, before the start and once
 * the flight has no day left; otherwise the remaining plan units over the line's own days
 * left, rounded UP (a tiny positive remainder never reads as 0/day while work is left).
 * `scopeActualUnits` is the line's delivered units in its buy unit over the WHOLE flight.
 */
export function neededPerDay(effPlan, asOf, scopeActualUnits) {
  const pr = PacingCore.prorate(effPlan, asOf);
  if (PacingCore.isLiPaused(effPlan, asOf) || pr.st === 'not_started') return 0;
  const left = Math.max(0, pr.fDays - pr.dP);
  if (left <= 0) return 0;
  const remaining = Math.max(0, (effPlan.planImpr || 0) - (scopeActualUnits || 0));
  return Math.ceil(remaining / left);
}

const net = (p) => p.k > 0 && p.k < 1;
const unitsOf = (m) => m?.au ?? 0;
const rateCostOf = (rt, m) => (
  rt === 'CPC' ? (m?.cl > 0 ? (m.sp || 0) / m.cl : 0)
    : rt === 'CPV' ? (m?.co > 0 ? (m.sp || 0) / m.co : 0)
      : (m?.cpm ?? 0)
);
const rateSubOf = (p, m) => (
  p.vcrTgt != null && p.vcrTgt > 0 ? `${completionLabelForLI(p)} ${fP(m?.vcr ?? 0)} / target ${fP(p.vcrTgt)}`
    // A stored CTR target of 0 is «no target» (owner decision 2026-09-23): no «target 0.00%».
    : p.ctrTgt > 0 ? `CTR ${fP(m?.ctr ?? 0)} / target ${fP(p.ctrTgt)}`
      : null
);
const hasFlight = (effPlan) => !!(effPlan && effPlan.fs && effPlan.fe);
const cpaOf = (m) => (m && m.cv != null && m.cv > 0 ? (m.sp || 0) / m.cv : null);
const neededOf = (ctx) => {
  const { effPlan, flight, asOf } = ctx;
  if (!effPlan || !(effPlan.planImpr > 0) || !flight) return null;
  return { value: neededPerDay(effPlan, asOf, flight.au), left: Math.max(0, effPlan.planImpr - (flight.au || 0)) };
};

/**
 * What the card prints for one column of one line, or null for an unknown key.
 * ctx = { p, effPlan, m, pacing, flight, liId, name, hasLens, thresholds, conv, asOf, index }:
 *   m       the Lens read (liM over the card's window, delivery narrowed by Lens chips), null while loading
 *   pacing  the Scope read (liM over the same window, plan-side), null while loading
 *   flight  the Scope read over the WHOLE flight (range null): the hero's Needed per day input, null while loading
 *   conv    the Conv tile (convTile's {value, sub, title}), or null
 * A value the line cannot have prints "—" with no sub, never a 0.
 */
export function cellFor(key, ctx) {
  const { p, effPlan, m, pacing, hasLens, thresholds, conv } = ctx;
  const isNet = net(p);
  switch (key) {
    case 'margin': {
      const mA = m?.mA ?? 0;
      const mTgt = effPlan?.mTgt ?? 0;
      const valueCls = pacing
        ? (hasLens || p.coef === true ? 'text-[var(--text-primary)]' : marginStatusCls(pacing.mA, mTgt, thresholds))
        : 'text-[var(--text-muted)]';
      return cell(basisLabel('Margin', 'margin', isNet), fP(mA), `target ${fP(mTgt)}`, valueCls);
    }
    case 'spend': {
      const sp = m?.sp ?? 0;
      const costPr = pacing?.costPr ?? 0;
      const valueCls = pacing && !hasLens ? spendStatusCls(pacing.sp, costPr, thresholds) : '';
      return cell('Spend / Cost Bud.', f$(sp), `${f$(costPr)} pror. · day ${pacing?.dP ?? 0}/${pacing?.fDays ?? 0}`, valueCls);
    }
    case 'units':
      return cell(rateLabel(p.rateType || 'CPM'), fI(unitsOf(m)), `${fI(Math.round(pacing?.eI ?? 0))} expected`);
    case 'pacing':
      return {
        ...cell(hasLens ? 'Pacing · Scope' : 'Pacing', null),
        labelTitle: hasLens ? 'Pacing uses Scope delivery and plan. Lens filters the displayed delivery.' : undefined,
        pace: { value: pacing?.pI ?? 0, status: pacing?.st ?? 'no_data' },
      };
    case 'rate': {
      const rt = p.rateType || 'CPM';
      return cell(rt, f$(rateCostOf(rt, m)), rateSubOf(p, m));
    }
    case 'conv':
      return conv ? cell('Conv', conv.value, conv.sub ?? null, '', conv.title) : cell('Conv', DASH);
    case 'ctr':
      return cell('CTR', fP(m?.ctr ?? 0), p.ctrTgt > 0 ? `target ${fP(p.ctrTgt)}` : null);
    case 'vcr': {
      const label = completionLabelForLI(p);
      if (!(m?.co > 0)) return cell(label, DASH);
      return cell(label, fP(m.vcr ?? 0), p.vcrTgt > 0 ? `target ${fP(p.vcrTgt)}` : null);
    }
    case 'cpa': {
      const v = cpaOf(m);
      return v == null ? cell('CPA', DASH) : cell('CPA', f$(v));
    }
    case 'clicks':
      return cell('Clicks', fI(m?.cl ?? 0));
    case 'views':
      return cell('Views', fI(m?.co ?? 0));
    case 'neededPerDay': {
      const n = neededOf(ctx);
      return n ? cell('Needed / day', fI(n.value), `${fI(n.left)} left`) : cell('Needed / day', DASH);
    }
    case 'daysLeft': {
      if (!hasFlight(effPlan)) return cell('Days left', DASH);
      const pr = PacingCore.prorate(effPlan, ctx.asOf);
      return cell('Days left', String(Math.max(0, pr.fDays - pr.dP)), `of ${pr.fDays}`);
    }
    case 'budget': {
      const label = basisLabel('Client budget', 'net', isNet);
      if (!(effPlan?.budget > 0)) return cell(label, DASH);
      return cell(label, f$(effPlan.budget), `${f$(effPlan.budget * (1 - (effPlan.mTgt || 0) / 100))} cost`);
    }
    default:
      return null;
  }
}

/**
 * The value a sort orders this line by for `key`: the column's primary value from the same
 * source as its cell (Lens for the delivery cells, Scope for pacing, needed per day and days
 * left), or the name, channel, flight end, or the default position. A cell that prints a dash
 * is null here (sorted last in either direction); a loading Lens read sorts as the 0 it prints.
 */
export function sortValueFor(key, ctx) {
  const { p, effPlan, m, pacing } = ctx;
  switch (key) {
    case 'margin': return m?.mA ?? 0;
    case 'spend': return m?.sp ?? 0;
    case 'units': return unitsOf(m);
    case 'pacing': return pacing?.pI ?? 0;
    case 'rate': return rateCostOf(p.rateType || 'CPM', m);
    case 'conv': return m ? (m.cv == null ? null : m.cv) : 0;
    case 'ctr': return m?.ctr ?? 0;
    case 'vcr': return m?.co > 0 ? (m.vcr ?? 0) : null;
    case 'cpa': return cpaOf(m);
    case 'clicks': return m?.cl ?? 0;
    case 'views': return m?.co ?? 0;
    case 'neededPerDay': { const n = neededOf(ctx); return n ? n.value : null; }
    case 'daysLeft': return hasFlight(effPlan) ? lineDaysLeft(effPlan, ctx.asOf) : null;
    case 'budget': return effPlan?.budget > 0 ? effPlan.budget : null;
    case 'name': return ctx.name ?? null;
    case 'channel': return p.ch || 'Unknown';
    case 'flightEnd': return p.fe || null;
    case 'default': return ctx.index ?? 0;
    default: return null;
  }
}

/**
 * The line ids in the configured order. `default` keeps the input order (reversed for
 * `desc`); any other key sorts by `sortValueFor` (numbers numerically, strings by locale),
 * nulls last in either direction, ties in input order (a stable sort).
 * @param {string[]} ids
 * @param {{key:string, dir:'asc'|'desc'}} sort
 * @param {(id:string, index:number) => object} ctxFor  the reader ctx for one line
 */
export function sortLineItems(ids, sort, ctxFor) {
  const list = Array.isArray(ids) ? ids : [];
  const key = sort?.key || 'default';
  const desc = sort?.dir === 'desc';
  if (key === 'default') return desc ? list.slice().reverse() : list.slice();
  const keyed = list.map((id, index) => ({ id, index, v: sortValueFor(key, ctxFor(id, index)) }));
  keyed.sort((a, b) => {
    const an = a.v == null, bn = b.v == null;
    if (an || bn) return an && bn ? a.index - b.index : (an ? 1 : -1);
    let c = typeof a.v === 'string' || typeof b.v === 'string'
      ? String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base', numeric: true })
      : a.v - b.v;
    if (desc) c = -c;
    return c !== 0 ? c : a.index - b.index;
  });
  return keyed.map((k) => k.id);
}
