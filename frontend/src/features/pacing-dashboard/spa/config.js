import PacingCore from './pacing-core.js';
import { parseUTC } from './date-utils.js';

export function findActiveContainer(plan, asOf, range) {
  return PacingCore.findActiveContainer(plan, asOf, range);
}

export function buildVirtualPlanFromContainer(plan, container) {
  return PacingCore.buildVirtualPlanFromContainer(plan, container);
}

// Cache: liPlan ref → Map<periodKey, plans>. WeakMap so plans are GC'd
// when liPlan is replaced (Settings save, new dashboard load). The cache is
// essential: it keeps virtual-plan object identity stable per (liPlan,
// periodKey), which pacing-calc.js memoizes on (that stability is what fixed
// the original Period Scope render freeze).
const scopedPlansCache = new WeakMap();

// Build virtual plans for the selected period. Per-LI resolution (date_child
// PRIMARY → standalone container SECONDARY → null) lives in the shared core
// (PacingCore.buildScopedPlanForPeriodKey) so dashboard, dash-gate health, and
// n8n all scope to the same numbers.
export function buildScopedPlansForPeriod(liPlan, periodKey) {
  if (!liPlan || !periodKey) return {};
  let perPlan = scopedPlansCache.get(liPlan);
  if (!perPlan) {
    perPlan = new Map();
    scopedPlansCache.set(liPlan, perPlan);
  }
  const cached = perPlan.get(periodKey);
  if (cached) return cached;

  const plans = {};
  for (const id of Object.keys(liPlan)) {
    plans[id] = PacingCore.buildScopedPlanForPeriodKey(liPlan[id], periodKey);
  }
  perPlan.set(periodKey, plans);
  return plans;
}

// getEffRange — in period-scope mode, "all" means the period's full window.
// User filters (custom range or any N-day quick range) still narrow further INSIDE the period;
// the per-LI fact filter (d < p.fs || d > p.fe) clips anything outside.
export function getEffRange(filters, campaign, asOf, splitScopedMode, splitScopedPlans) {
  return getEffRangeInfo(filters, campaign, asOf, splitScopedMode, splitScopedPlans).range;
}

/**
 * getEffRange, plus WHICH branch answered (2026-09-23). `narrowed` is true only when the
 * viewer's own choice produced the window: a Custom range with both ends, or an N-day preset
 * on a pacing that has data. Flight, the period window and a Custom range with a missing end
 * all answer `narrowed: false`.
 *
 * The flag exists because "a range exists" cannot say it: Flight is a range too
 * ({campaign start .. asOf}), and every widget reads one. It is what decides whether the
 * PLAN follows the window (widget plan scalars, campM's plan sums) or stays the flight's.
 */
export function getEffRangeInfo(filters, campaign, asOf, splitScopedMode, splitScopedPlans) {
  if (filters.range === 'custom' && filters.customRange?.from && filters.customRange?.to) {
    return { range: { from: filters.customRange.from, to: filters.customRange.to }, narrowed: true };
  }
  if (filters.range !== 'all' && filters.range !== 'custom' && asOf) {
    const days = Number(filters.range.replace('d', ''));
    const cut = parseUTC(asOf);
    cut.setUTCDate(cut.getUTCDate() - (days - 1));
    return { range: { from: cut.toISOString().slice(0, 10), to: asOf }, narrowed: true };
  }
  return { range: wideRange(campaign, asOf, splitScopedMode, splitScopedPlans), narrowed: false };
}

/** The window nobody narrowed: the active period's (period scope), else the flight. */
function wideRange(campaign, asOf, splitScopedMode, splitScopedPlans) {
  if (splitScopedMode && splitScopedPlans) {
    let minFs = null, maxFe = null;
    for (const vp of Object.values(splitScopedPlans)) {
      if (vp) {
        if (!minFs || vp.fs < minFs) minFs = vp.fs;
        if (!maxFe || vp.fe > maxFe) maxFe = vp.fe;
      }
    }
    if (minFs && maxFe) return { from: minFs, to: asOf && asOf < maxFe ? asOf : maxFe };
  }
  return { from: campaign.startDate, to: asOf || campaign.endDate };
}

export function computeEffLIs(liPlan, filters) {
  if (!liPlan) return [];
  let ids = Object.keys(liPlan);
  if (filters.channels?.length) {
    ids = ids.filter((id) => filters.channels.includes(liPlan[id].ch));
  }
  if (filters.labels?.length) {
    ids = ids.filter((id) => filters.labels.some((l) => (liPlan[id].labels || []).includes(l)));
  }
  if (filters.selection?.length) {
    ids = ids.filter((id) => filters.selection.includes(id));
  }
  return ids;
}

export function getEffPlan(liPlan, liId, splitScopedMode, splitScopedPlans) {
  if (splitScopedMode && splitScopedPlans?.[liId]) return splitScopedPlans[liId];
  return liPlan[liId];
}
