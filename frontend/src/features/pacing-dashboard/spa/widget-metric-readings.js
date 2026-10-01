// Canonical scalar readings shared by Layout blocks, the Widget metric catalog
// and the render layer. Each entry owns the title, display format and the one
// calculation for that campaign reading; it is not an authoring preset catalog.

const readings = {
  __proto__: null,
  margin: {
    title: 'Margin', format: 'percent',
    compute: (cm, fl) => ({ value: cm.mA, target: fl?.mT ?? null, invert: false, sub: 'vs target' }),
  },
  pacing: {
    title: 'Pacing', format: 'pp',
    compute: (cm) => ({ value: cm.pac, target: null, invert: false, sub: 'index vs plan' }),
  },
  delivery: {
    title: 'Delivery', format: 'percent',
    compute: (cm) => {
      // The unit is chosen on the whole-flight plan (2026-09-23); the percent is over the
      // window's plan, which is the flight's unless the viewer narrowed it. A window holding
      // none of that plan has no percent: an em dash, not a 0% that reads as no delivery.
      const has = (flight, win) => (cm[flight] ?? cm[win] ?? 0) > 0;
      const pct = (actual, plan) => (plan > 0 ? (actual / plan) * 100 : null);
      if (has('imprPlanFlight', 'pI')) return { value: cm.pI > 0 ? cm.iPct : null, target: null, invert: false, sub: 'of impressions plan' };
      if (has('clicksPlanFlight', 'clicksPlan')) return { value: pct(cm.clicksActual, cm.clicksPlan), target: null, invert: false, sub: 'of clicks plan' };
      if (has('viewsPlanFlight', 'viewsPlan')) return { value: pct(cm.viewsActual, cm.viewsPlan), target: null, invert: false, sub: 'of views plan' };
      return { value: 0, target: null, invert: false, sub: 'no delivery plan' };
    },
  },
  cpm: {
    title: 'CPM', format: 'money',
    compute: (cm, fl) => ({ value: cm.cpm, target: fl?.tgtCpm ?? null, invert: true, sub: 'vs plan CPM' }),
  },
  spend: {
    title: 'Spend', format: 'money',
    compute: (cm, fl) => ({ value: cm.sp, target: fl?.costBudTotal ?? null, invert: true, sub: 'vs cost budget' }),
  },
  ctr: {
    title: 'CTR', format: 'percent2',
    // The target is weighted by delivered impressions in the window the CTR is read over
    // (owner decision 2026-09-23), so it comes from the SAME metrics object as the value:
    // a narrowed window compares its CTR with its own target, never the flight's.
    compute: (cm) => ({ value: cm.ctr, target: cm.ctrT ?? null, invert: false, sub: 'vs target' }),
  },
  vcr: {
    title: 'VCR', format: 'percent',
    compute: (cm, fl) => ({ value: cm.vcr, target: fl?.vcrT ?? null, invert: false, sub: 'vs target' }),
  },
  cpc: {
    title: 'CPC', format: 'money',
    compute: (cm, fl) => ({
      value: cm.cl > 0 ? cm.sp / cm.cl : 0,
      target: fl && fl.planClicks > 0 ? fl.costBudTotal / fl.planClicks : null,
      invert: true, sub: 'vs plan CPC',
    }),
  },
  cpv: {
    title: 'CPV', format: 'money4',
    compute: (cm, fl) => ({
      value: cm.cpv,
      target: fl && fl.cpvViewsPlan > 0 ? fl.costBudTotal / fl.cpvViewsPlan : null,
      invert: true, sub: 'vs plan CPV',
    }),
  },
  budget: {
    title: 'Budget', format: 'percent',
    compute: (cm) => ({ value: cm.spendToDatePct, target: 100, invert: false, sub: 'of plan-to-date' }),
  },
  marginbar: {
    title: 'Margin meter', format: 'percent',
    compute: (cm, fl) => ({ value: cm.mA, target: fl.mT, invert: false, sub: null }),
  },
  flight: {
    title: 'Flight', format: 'number',
    compute: (_cm, fl) => ({ value: fl.daysLeft, target: null, invert: false, sub: 'days left' }),
  },
};

for (const reading of Object.values(readings)) Object.freeze(reading);

export const METRIC_READINGS = Object.freeze(readings);

export function readingFor(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(METRIC_READINGS, key)
    ? METRIC_READINGS[key]
    : null;
}
