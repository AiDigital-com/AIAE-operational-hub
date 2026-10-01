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
  'imprToDatePct', 'imprActual', 'imprExpected', 'imprDeviation',
  'forecastDspSpend', 'costBudTotal', 'costRemaining',
  'clientPlanCpm', 'clientPlanCpc', 'clientPlanCpv', 'bidPlanCpm', 'dynCpm', 'paceDeltaImpr'
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
