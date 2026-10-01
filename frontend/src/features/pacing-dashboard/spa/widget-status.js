// Presentation thresholds shared by canonical Layout blocks and Widget chrome.
// Pure: numbers in, words/statuses out.

export function paceStatus(delta) { return delta >= 0 ? 'g' : delta >= -5 ? 'w' : 'b'; }

export function paceWord(delta) {
  if (delta > 5) return 'Ahead of pace';
  if (delta >= -2) return 'On track';
  if (delta >= -5) return 'Slightly behind';
  return 'Shortfall';
}

export function marginStatus(delta) { return delta >= 0 ? 'g' : delta >= -5 ? 'w' : 'b'; }

export function marginWord(delta) {
  if (delta >= 2) return 'Above target';
  if (delta >= -2) return 'On target';
  if (delta >= -5) return 'Slightly below';
  return 'Below target';
}

// Fixed per-campaign meter scale: [target - 20, target + 10], clamped to 0..100.
export function meterBounds(target, format = 'percent') {
  // Other units use a target-relative domain, never percentage limits or current value.
  if (format !== 'percent' && format !== 'percent2') return { min: 0, max: Math.max(Number.MIN_VALUE, (target || 0) * 1.5) };
  const rounded = Math.round(target || 0);
  const min = Math.max(0, rounded - 20);
  const max = Math.min(100, Math.max(min + 10, rounded + 10));
  return { min, max };
}

// Primary delivery unit: impressions first, then a plan-bearing views/clicks
// fallback. With no plan-bearing fallback, prefer the visible views reading.
// Chosen on the WHOLE-flight plans (campM's *PlanFlight twins, 2026-09-23): a narrowed
// window holding none of a unit's plan must not switch the verdict to another unit.
// (`hasImpr` is already read off the flight twin.)
export function primaryUnit(cm) {
  if (cm.hasImpr) return 'impr';
  if (cm.hasViews && (cm.viewsPlanFlight ?? cm.viewsPlan ?? 0) > 0) return 'views';
  if (cm.hasClicks && (cm.clicksPlanFlight ?? cm.planClicks ?? 0) > 0) return 'clicks';
  return cm.hasViews ? 'views' : 'clicks';
}

export const UNIT_FIELDS = Object.freeze({
  impr: Object.freeze({
    title: 'Impressions', actual: 'imprActual', expected: 'imprExpected', plan: 'imprPlan',
    toDate: 'imprToDatePct', neededPerDay: 'neededPerDayImpr', dailyRate: 'imprPlanDailyRate', latest: 'latestDayImpr',
  }),
  clicks: Object.freeze({
    title: 'Clicks', actual: 'clicksActual', expected: 'clicksExpected', plan: 'clicksPlan',
    toDate: 'clicksToDatePct', neededPerDay: 'neededPerDayClicks', dailyRate: 'clicksPlanDailyRate', latest: 'latestDayClicks',
  }),
  views: Object.freeze({
    title: 'Views', actual: 'viewsActual', expected: 'viewsExpected', plan: 'viewsPlan',
    toDate: 'viewsToDatePct', neededPerDay: 'neededPerDayViews', dailyRate: 'viewsPlanDailyRate', latest: 'latestDayViews',
  }),
});
