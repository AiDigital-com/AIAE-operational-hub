/**
 * Canonical widget metric vocabulary shared by the browser and dash-gate.
 *
 * This module deliberately contains no presentation or old composite grammar. It is the
 * complete set accepted by report-v2 canonical values and used by the Builder catalogue.
 * Browser: globalThis.WidgetMetrics; Node: module.exports.
 */
(function (root) {
"use strict";

var PRESET_METRICS = [
  'margin', 'pacing', 'delivery', 'cpm', 'spend', 'ctr', 'vcr', 'cpc', 'cpv',
  'budget', 'marginbar', 'flight'
];

var CANON_METRICS = [
  'neededSpendPerDay', 'neededPerDayImpr', 'neededPerDayClicks', 'neededPerDayViews',
  // CPI (install-paced) line items, the fourth unit a pacing can be bought on.
  'neededPerDayInstalls',
  'imprToDatePct', 'imprActual', 'imprExpected', 'imprDeviation',
  'forecastDspSpend', 'costBudTotal', 'costRemaining',
  'clientPlanCpm', 'clientPlanCpc', 'clientPlanCpv', 'bidPlanCpm', 'dynCpm', 'paceDeltaImpr',
  // «Impressions to Hit Budget» (2026-09-29): per rate type, in that type's own unit.
  'hitBudgetAddImpr', 'hitBudgetAddViews', 'hitBudgetAddClicks',
  'hitBudgetPerDayImpr', 'hitBudgetPerDayViews', 'hitBudgetPerDayClicks',
  'hitBudgetPlan', 'hitBudgetProjected', 'hitBudgetGap',
  // The install-paced twins, ours — the reference has no CPI rate type.
  'hitBudgetAddInstalls', 'hitBudgetPerDayInstalls',
  // The seven above, on the unit the pacing is BOUGHT on (2026-10-05): each resolves through
  // `primaryUnit` at render and reads campM's impressions, clicks or views field accordingly.
  // The Standard Delivery card binds these, so ONE stored definition is right on a CPM, a CPC
  // and a CPV pacing — the fixed `impr*` family above is 0 on the last two by design.
  'unitToDatePct', 'unitActual', 'unitExpected', 'unitPlan', 'unitDeviation',
  'neededPerDayUnit', 'paceDeltaUnit'
];

var WIDGET_METRICS = PRESET_METRICS.concat(CANON_METRICS);
Object.freeze(PRESET_METRICS);
Object.freeze(CANON_METRICS);
Object.freeze(WIDGET_METRICS);

var api = Object.freeze({ PRESET_METRICS: PRESET_METRICS, CANON_METRICS: CANON_METRICS,
  WIDGET_METRICS: WIDGET_METRICS });
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.WidgetMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
