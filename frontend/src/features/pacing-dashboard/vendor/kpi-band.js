/**
 * kpi-band.js — Single source of CTR/VCR band coloring.
 *
 * Shared across dash-gate (Overview health kpis), workspace (KpiPlanFact,
 * KpiTrend). Pure, no I/O. Browser/Vite: globalThis.KpiBand; Node/dash-gate:
 * module.exports.
 *
 * Band model (ratio r = actual / target):
 *   green  : r >= 1 AND (high == null || r <= high)
 *   warn   : low != null AND low <= r < 1
 *   bad    : (low != null && r < low) || (high != null && r > high)
 *   neutral: target invalid / ratio not finite
 * A null bound means "that side is disabled" (no flag on that side).
 *
 * VCR has NO upper band: a high VCR is good; the only "too high" case
 * (VCR > 100%) is the vcr_over_100 data-integrity alert, not band coloring —
 * so the VCR high bound is always null. CTR keeps its upper band from
 * ctr_above_target (default 2.0x).
 */
(function (root) {
"use strict";

var DEFAULT_LOW = 0.7;
var DEFAULT_HIGH = 2.0;

function kpiBandStatus(ratio, low, high) {
  if (ratio == null || !isFinite(ratio)) return 'n';
  if (ratio >= 1) {
    if (high != null && ratio > high) return 'b';
    return 'g';
  }
  // ratio < 1
  if (low == null) return 'g';        // lower bound disabled -> not flagged
  if (ratio < low) return 'b';
  return 'w';
}

// Derive { low, high } for 'ctr' | 'vcr' from a notify config, honoring the
// per-alert `enabled` flag (disabled -> that bound is null = no flag/red).
function bandFromNotify(notify, metric) {
  var a = (notify && notify.alerts) || {};
  var below = a[metric + '_below_target'];
  var low = below && below.enabled === false
    ? null
    : (below && below.factor != null ? Number(below.factor) : DEFAULT_LOW);
  if (metric === 'vcr') return { low: low, high: null };
  var above = a[metric + '_above_target'];
  var high = above && above.enabled === false
    ? null
    : (above && above.factor != null ? Number(above.factor) : DEFAULT_HIGH);
  return { low: low, high: high };
}

var KpiBand = {
  kpiBandStatus: kpiBandStatus,
  bandFromNotify: bandFromNotify,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KpiBand;
} else {
  root.KpiBand = KpiBand;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
