/**
 * alerts-core.js — Shared pure alert-detection core.
 *
 * Single source of truth for the 5 new pacing alerts (v1):
 *   bid_fact_above_plan, data_gap, ctr_below_target,
 *   vcr_below_target, no_impressions_yet.
 *
 * Used by: dashboard (browser <script>), n8n (require), tests (node ESM).
 *
 * ALL functions are pure: no DOM, no global state, no I/O.
 * Division by zero returns 0 (canonical decision, matches pacing-core).
 *
 * Browser: exposes global `AlertsCore`.
 * Node.js: `module.exports = AlertsCore`.
 *
 * Spec: docs/superpowers/specs/2026-05-24-notifications-v1-design.md
 */
(function (root) {
"use strict";

/* ── Internal helpers ──────────────────────────────────────────────────────── */

function parseUTC(y) {
  var p = String(y).split('-');
  var a = +p[0], b = +(p[1] || 1), c = +(p[2] || 1);
  return new Date(Date.UTC(a, b - 1, c));
}

function daysBetween(a, b) {
  return Math.floor((parseUTC(b) - parseUTC(a)) / 864e5) + 1;
}

function safeDiv(n, d) { return d > 0 ? n / d : 0; }

/* ── isVideoLI predicate ──────────────────────────────────────────────────── */

function isVideoLI(liPlan, liDaily, liId) {
  var plan = liPlan && liPlan[liId];
  if (!plan) return false;
  if (plan.rateType === 'CPV') return true;
  var dd = (liDaily && liDaily[liId]) || {};
  for (var d in dd) {
    if (dd[d] && dd[d].co > 0) return true;
  }
  return false;
}

/* ── buildState ───────────────────────────────────────────────────────────── */

function buildState(inp) {
  var pacing = inp.pacing || {};
  var liPlan = inp.liPlan || {};
  var liDaily = inp.liDaily || {};
  var liMetrics = inp.liMetrics || {};
  var flightMetrics = inp.flightMetrics || {};
  var pausedById = inp.pausedById || {};
  var today = inp.today || new Date().toISOString().slice(0, 10);

  // totalImpressions across all LIs and dates, plus the rate-native total that
  // the settle gate uses (a clicks-only pacing has zero impressions forever).
  var total = 0;
  var nativeTotal = 0;
  var datesSet = {};
  for (var li in liDaily) {
    var dd = liDaily[li];
    var nf = nativeField(liPlan[li] && liPlan[li].rateType);
    for (var d in dd) {
      total += (+dd[d].im || 0);
      nativeTotal += (+dd[d][nf] || 0);
      datesSet[d] = true;
    }
  }
  var sortedDates = Object.keys(datesSet).sort();

  var liIds = Object.keys(liPlan);
  var hasVideo = false;
  for (var i = 0; i < liIds.length; i++) {
    if (isVideoLI(liPlan, liDaily, liIds[i])) { hasVideo = true; break; }
  }

  function isVideoLIBound(id) { return isVideoLI(liPlan, liDaily, id); }

  function windowSums(N) {
    // sum spend and impressions across the last N calendar dates that have any data.
    var tail = sortedDates.slice(-Math.max(1, N | 0));
    var sp = 0, im = 0;
    for (var i = 0; i < tail.length; i++) {
      var dt = tail[i];
      for (var li in liDaily) {
        var row = liDaily[li] && liDaily[li][dt];
        if (!row) continue;
        sp += (+row.sp || 0);
        im += (+row.im || 0);
      }
    }
    return { spend: sp, impressions: im };
  }

  return {
    pacing: pacing,
    liPlan: liPlan,
    liDaily: liDaily,
    liMetrics: liMetrics,
    flightMetrics: flightMetrics,
    today: today,
    totalImpressions: total,
    totalNativeUnits: nativeTotal,
    sortedDates: sortedDates,
    hasVideo: hasVideo,
    isVideoLI: isVideoLIBound,
    isPaused: function (id) { return !!pausedById[id]; },
    windowSums: windowSums,
  };
}

/* ── Rate-native activity ──────────────────────────────────────────────────── */

/* Native activity unit per rate type — CPM→im, CPC→cl, CPV→co; unknown/absent
 * ⇒ im. This MIRRORS PacingCore.liActualUnits: alerts-core is a self-contained
 * UMD and cannot require pacing-core, so tests/alerts-native-canon-test.mjs
 * locks the two implementations together. */
function nativeField(rateType) {
  var rt = String(rateType || 'CPM').toUpperCase();
  return rt === 'CPC' ? 'cl' : rt === 'CPV' ? 'co' : 'im';
}
function nativeUnits(plan, totals) {
  var f = nativeField(plan && plan.rateType);
  return Number(totals && totals[f]) || 0;
}
function unitWord(nf) {
  return nf === 'cl' ? 'clicks' : nf === 'co' ? 'completes' : 'impr';
}

/* ── Settle gate ──────────────────────────────────────────────────────────── */

// "Has ANY data started flowing?" — this gate exists so diagnostic detectors stay
// quiet on a campaign that has not started, and it guards ten of them, including
// the paused-leak serving guard. So it must fire on ANY activity: native units
// for a clicks-only pacing (zero impressions forever), impressions for a CPC
// pacing that serves but has not been clicked yet. The narrower "what we sold
// has not arrived" question belongs to detectNoImpressionsYet, which tests the
// native total on its own.
function hasSettled(state) {
  return Math.max(state.totalNativeUnits || 0, state.totalImpressions || 0) > 0;
}

/* ── Detectors ─────────────────────────────────────────────────────────────── */

function detectBidFactAbovePlan(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return null;
  if (!hasSettled(state)) return null;

  var window = +(cfg.window || 2);
  var thresholdPct = +(cfg.threshold_pct || 5);

  var w = state.windowSums(window);
  var bidFactNdCpm = safeDiv(w.spend, w.impressions) * 1000;

  var planImpr = +(state.flightMetrics.planImprTotal || state.pacing.plan_impressions_total || 0);
  var costBud  = +(state.flightMetrics.costBudTotal  || state.pacing.cost_budget_total      || 0);
  var bidPlanCpm = safeDiv(costBud, planImpr) * 1000;

  if (!(bidPlanCpm > 0)) return null;
  var ceiling = bidPlanCpm * (1 + thresholdPct / 100);
  if (!(bidFactNdCpm > ceiling)) return null;

  var overshoot = ((bidFactNdCpm - bidPlanCpm) / bidPlanCpm) * 100;

  return {
    type: 'bid_fact_above_plan',
    severity: 'warning',
    scope: 'campaign',
    li_id: null,
    text: 'Bid Fact (' + window + 'd) $' + bidFactNdCpm.toFixed(2) + ' CPM above Bid Plan $' + bidPlanCpm.toFixed(2) + ' CPM',
    metadata: { window: window, threshold_pct: thresholdPct, bidFactNdCpm: bidFactNdCpm, bidPlanCpm: bidPlanCpm, overshoot_pct: overshoot },
  };
}
function detectDataGap(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var threshold = +(cfg.gap_days || 1);

  var sorted = state.sortedDates;
  var out = [];
  for (var i = 1; i < sorted.length; i++) {
    var gap = Math.round((parseUTC(sorted[i]) - parseUTC(sorted[i - 1])) / 864e5);
    var gapDays = gap - 1;
    if (gapDays > threshold) {
      out.push({
        type: 'data_gap',
        severity: 'info',
        scope: 'campaign',
        li_id: null,
        text: 'Data gap: ' + gapDays + 'd between ' + sorted[i - 1] + ' and ' + sorted[i],
        metadata: { gap_days: gapDays, from: sorted[i - 1], to: sorted[i] },
      });
    }
  }
  return out;
}
function detectCtrBelowTarget(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var factor = +(cfg.factor || 0.7);

  var out = [];
  var liPlan = state.liPlan;
  var liDaily = state.liDaily;
  for (var id in liPlan) {
    var plan = liPlan[id];
    var ctrT = +(plan && plan.ctrTgt || 0);
    if (!(ctrT > 0)) continue;

    var im = 0, cl = 0;
    var dd = liDaily[id] || {};
    for (var d in dd) {
      im += (+dd[d].im || 0);
      cl += (+dd[d].cl || 0);
    }
    if (!(im > 0)) continue;

    var ctr = (cl / im) * 100;
    if (ctr < ctrT * factor) {
      var name = plan.name || id;
      out.push({
        type: 'ctr_below_target',
        severity: 'warning',
        scope: 'line_item',
        li_id: id,
        text: 'CTR ' + ctr.toFixed(2) + '% below target ' + ctrT.toFixed(2) + '% — ' + name,
        metadata: { li_id: id, li_name: name, ctr: ctr, ctrT: ctrT, factor: factor, im: im, cl: cl },
      });
    }
  }
  return out;
}
function detectVcrBelowTarget(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var factor = +(cfg.factor || 0.7);

  var out = [];
  var liPlan = state.liPlan;
  var liDaily = state.liDaily;
  for (var id in liPlan) {
    if (!state.isVideoLI(id)) continue;
    var plan = liPlan[id];
    var vcrT = +(plan && plan.vcrTgt || 0);
    if (!(vcrT > 0)) continue;

    var im = 0, co = 0;
    var dd = liDaily[id] || {};
    for (var d in dd) {
      im += (+dd[d].im || 0);
      co += (+dd[d].co || 0);
    }
    if (!(im > 0)) continue;

    var vcr = (co / im) * 100;
    if (vcr < vcrT * factor) {
      var name = plan.name || id;
      // Audio LIs reuse vcrTgt as an ACR (audio completion rate) target — label
      // them "ACR" while keeping the alert `type` key unchanged for equivalence.
      var lbl = (plan.ch || '').toLowerCase() === 'audio' ? 'ACR' : 'VCR';
      out.push({
        type: 'vcr_below_target',
        severity: 'warning',
        scope: 'line_item',
        li_id: id,
        text: lbl + ' ' + vcr.toFixed(2) + '% below target ' + vcrT.toFixed(2) + '% — ' + name,
        metadata: { li_id: id, li_name: name, ch: (plan.ch || ''), vcr: vcr, vcrT: vcrT, factor: factor, im: im, co: co },
      });
    }
  }
  return out;
}
function detectCtrAboveTarget(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var factor = +(cfg.factor || 2.0);

  var out = [];
  var liPlan = state.liPlan;
  var liDaily = state.liDaily;
  for (var id in liPlan) {
    var plan = liPlan[id];
    var ctrT = +(plan && plan.ctrTgt || 0);
    if (!(ctrT > 0)) continue;

    var im = 0, cl = 0;
    var dd = liDaily[id] || {};
    for (var d in dd) {
      im += (+dd[d].im || 0);
      cl += (+dd[d].cl || 0);
    }
    if (!(im > 0)) continue;

    var ctr = (cl / im) * 100;
    if (ctr > ctrT * factor) {
      var name = plan.name || id;
      out.push({
        type: 'ctr_above_target',
        severity: 'warning',
        scope: 'line_item',
        li_id: id,
        text: 'CTR ' + ctr.toFixed(2) + '% above target ' + ctrT.toFixed(2) + '% — ' + name,
        metadata: { li_id: id, li_name: name, ctr: ctr, ctrT: ctrT, factor: factor, im: im, cl: cl },
      });
    }
  }
  return out;
}
// vcr_over_100 — data-integrity check: VCR can never exceed 100% (completes
// cannot outnumber impressions). A reading > 100% means broken upstream data,
// so this is a critical alert, NOT a KPI band. Threshold is the physical
// constant 100 (not configurable). There is no VCR upper KPI band — a high VCR
// is good.
function detectVcrOver100(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];

  var out = [];
  var liPlan = state.liPlan;
  var liDaily = state.liDaily;
  for (var id in liPlan) {
    if (!state.isVideoLI(id)) continue;
    var plan = liPlan[id];

    var im = 0, co = 0;
    var dd = liDaily[id] || {};
    for (var d in dd) {
      im += (+dd[d].im || 0);
      co += (+dd[d].co || 0);
    }
    if (!(im > 0)) continue;

    var vcr = (co / im) * 100;
    if (vcr > 100) {
      var name = plan.name || id;
      // Audio LIs reuse vcrTgt as an ACR target — label "ACR"; type key unchanged.
      var lbl = (plan.ch || '').toLowerCase() === 'audio' ? 'ACR' : 'VCR';
      out.push({
        type: 'vcr_over_100',
        severity: 'critical',
        scope: 'line_item',
        li_id: id,
        text: lbl + ' ' + vcr.toFixed(1) + '% invalid (completes > impressions) — ' + name,
        metadata: { li_id: id, li_name: name, ch: (plan.ch || ''), vcr: vcr, im: im, co: co },
      });
    }
  }
  return out;
}
function detectRateCostAbovePlan(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var thresholdPct = +(cfg.threshold_pct != null ? cfg.threshold_pct : 10);

  var out = [];
  var liPlan = state.liPlan;
  var liDaily = state.liDaily;
  for (var id in liPlan) {
    var plan = liPlan[id];
    if (!plan) continue;
    var rt = plan.rateType;
    if (rt !== 'CPC' && rt !== 'CPV') continue;   // CPM covered by bid_fact_above_plan

    var budget = +(plan.budget || 0);
    var mTgt = +(plan.mTgt || 0);
    var cost = budget * (1 - mTgt / 100);
    if (!(cost > 0)) continue;

    // planImpr is the planned native total for both CPC (plan-clicks) and CPV
    // (plan-views) — the canonical convention (see metrics.js campM).
    var denom = +(plan.planImpr || 0);
    if (!(denom > 0)) continue;
    var planned = cost / denom;

    var sp = 0, units = 0;
    var dd = liDaily[id] || {};
    for (var d in dd) {
      sp += (+dd[d].sp || 0);
      units += rt === 'CPC' ? (+dd[d].cl || 0) : (+dd[d].co || 0);
    }
    if (!(units > 0)) continue;
    var actual = sp / units;

    if (actual > planned * (1 + thresholdPct / 100)) {
      var name = plan.name || id;
      out.push({
        type: 'rate_cost_above_plan',
        severity: 'warning',
        scope: 'line_item',
        li_id: id,
        text: rt + ' $' + actual.toFixed(2) + ' above plan $' + planned.toFixed(2) + ' — ' + name,
        metadata: { li_id: id, li_name: name, rateType: rt, actual: actual, planned: planned, threshold_pct: thresholdPct },
      });
    }
  }
  return out;
}
function detectNoImpressionsYet(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return null;

  var fs = state.pacing.flight_start;
  if (!fs) return null;
  var today = state.today;
  if (!(parseUTC(today) > parseUTC(fs))) return null;       // today must be strictly after flight_start
  if (state.totalNativeUnits > 0) return null;              // resolved as soon as the first native unit arrives

  return {
    type: 'no_impressions_yet',                             // stored config key (migration 020) — semantics went rate-native, the key did not
    severity: 'critical',
    scope: 'campaign',
    li_id: null,
    text: 'No delivery yet — campaign started ' + fs,
    metadata: { flight_start: fs, today: today },
  };
}

function detectPacingOffPace(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];

  var low  = +(cfg.low  != null ? cfg.low  : -5);
  var high = +(cfg.high != null ? cfg.high :  5);

  var out = [];
  var liPlan = state.liPlan;
  var liMetrics = state.liMetrics || {};

  for (var id in liPlan) {
    var m = liMetrics[id];
    if (!m) continue;                        // skip LIs without metrics
    if (m.st === 'not_started') continue;

    var pI = +m.pI;
    if (pI >= low && pI <= high) continue;   // within band — silent

    var direction = pI < low ? 'under' : 'over';
    var severity;
    if (pI < low - 10 || pI > high + 10) severity = 'critical';
    else severity = 'warning';

    var name = (liPlan[id] && liPlan[id].name) || id;
    var sign = pI >= 0 ? '+' : '';
    var fmt = sign + pI.toFixed(1) + 'pp';

    var verb;
    if (severity === 'critical') verb = direction === 'under' ? 'severely under target' : 'severely over target';
    else                         verb = direction === 'under' ? 'under target'          : 'over target';

    out.push({
      type: 'pacing_off_pace',
      severity: severity,
      scope: 'line_item',
      li_id: id,
      text: 'Pacing ' + fmt + ' ' + verb + ' — ' + name,
      metadata: { li_id: id, li_name: name, pI: pI, low: low, high: high, direction: direction },
    });
  }
  return out;
}

function detectMarginBelowTarget(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];

  var gap_pp = +(cfg.gap_pp != null ? cfg.gap_pp : 3);

  var out = [];
  var liPlan = state.liPlan;
  var liMetrics = state.liMetrics || {};

  for (var id in liPlan) {
    var m = liMetrics[id];
    if (!m) continue;
    // Coefficient-cost LI (spec §5): margin ≡ config by construction — drift is
    // structurally impossible; a blended-actual-vs-single-target compare would
    // false-fire on a perfectly-configured LI. Skip.
    if (liPlan[id] && liPlan[id].coef === true) continue;
    if (!(+m.sp > 0)) continue;                    // LI-level settle: must have spend

    var mA = +m.mA;
    var mT = +m.mT;
    if (!(mA < mT - gap_pp)) continue;

    var name = (liPlan[id] && liPlan[id].name) || id;
    // Net cost mode (spec 2026-09-07 §7): mA is already computed from the net
    // client cost upstream, so the text names it — the reader must not read a
    // net margin as a gross one. metadata.net is absent on a gross LI.
    var isNet = !!(liPlan[id] && liPlan[id].net === true);
    out.push({
      type: 'margin_below_target',
      severity: 'critical',
      scope: 'line_item',
      li_id: id,
      text: (isNet ? 'Net margin ' : 'Margin ') + mA.toFixed(2) + '% below target ' + mT.toFixed(2) + '% — ' + name,
      metadata: isNet
        ? { li_id: id, li_name: name, mA: mA, mT: mT, gap_pp: gap_pp, net: true }
        : { li_id: id, li_name: name, mA: mA, mT: mT, gap_pp: gap_pp },
    });
  }
  return out;
}

function detectSpendOverspend(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];

  var warn_pct = +(cfg.warn_pct != null ? cfg.warn_pct : 90);
  var bad_pct  = +(cfg.bad_pct  != null ? cfg.bad_pct  : 100);

  var out = [];
  var liPlan = state.liPlan;
  var liMetrics = state.liMetrics || {};

  for (var id in liPlan) {
    var m = liMetrics[id];
    if (!m) continue;
    var costPr = +m.costPr;
    if (!(costPr > 0)) continue;

    var sp = +m.sp;
    var pct = (sp / costPr) * 100;
    var severity = null;
    var verb = null;
    if (pct > bad_pct)         { severity = 'critical'; verb = 'Overspend'; }
    else if (pct > warn_pct)   { severity = 'warning';  verb = 'Spend at'; }
    else continue;

    var name = (liPlan[id] && liPlan[id].name) || id;
    out.push({
      type: 'spend_overspend',
      severity: severity,
      scope: 'line_item',
      li_id: id,
      text: verb + ' ' + Math.round(pct) + '% of cost budget — ' + name,
      metadata: { li_id: id, li_name: name, pct: pct, warn_pct: warn_pct, bad_pct: bad_pct, sp: sp, costPr: costPr },
    });
  }
  return out;
}

function detectDspForecastOverspend(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return null;
  if (!hasSettled(state)) return null;

  var fm = state.flightMetrics || {};
  var forecastDspSpend = +(fm.forecastDspSpend || 0);
  var costBudTotal     = +(fm.costBudTotal     || 0);

  if (!(costBudTotal > 0)) return null;
  if (!(forecastDspSpend > costBudTotal)) return null;

  var overshoot = forecastDspSpend - costBudTotal;
  var name = state.pacing.name || state.pacing.id || '';

  return {
    type: 'dsp_forecast_overspend',
    severity: 'critical',
    scope: 'campaign',
    li_id: null,
    text: 'DSP forecast $' + forecastDspSpend.toFixed(2) + ' exceeds cost budget $' + costBudTotal.toFixed(2) + ' — ' + name,
    metadata: { forecastDspSpend: forecastDspSpend, costBudTotal: costBudTotal, overshoot_abs: overshoot },
  };
}

function detectStaleData(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return null;

  var days = +(cfg.days != null ? cfg.days : 2);

  var sorted = state.sortedDates || [];
  var latestDate = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  if (!latestDate) return null;                          // no data ⇒ silent (this detector)

  var today = state.today;
  var ageDays = Math.floor((parseUTC(today) - parseUTC(latestDate)) / 864e5);
  // >= boundary matches legacy ms-precision behaviour; spec 2026-05-25 §6.1.
  if (!(ageDays >= days)) return null;

  return {
    type: 'stale_data',
    severity: 'warning',
    scope: 'campaign',
    li_id: null,
    text: 'Stale data: latest ' + latestDate + ' (' + ageDays + 'd ago)',
    metadata: { latestDate: latestDate, ageDays: ageDays, threshold_days: days },
  };
}

// Campaign is STILL delivering past its flight end (over-delivery). The flight
// boundary is a meaningful signal: a campaign that keeps serving after its
// latest LI ended should NOT be silently auto-completed — it should surface to
// the operator. Fires only while delivery is recent (active_days, default 3,
// matching the refresh-side completion grace) so the alert means "Live past
// flight, not yet wound down"; once delivery stops for >active_days the
// auto-complete guard finishes the campaign and this goes silent.
function detectPostFlightDelivery(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return null;

  var fe = state.pacing.flight_end;
  if (!fe) return null;

  var today = state.today;
  if (!(parseUTC(today) > parseUTC(fe))) return null;       // flight not ended yet

  // Sum ACTIVITY strictly AFTER flight end; track the latest such date.
  // Serving question: the LI's native unit OR its impressions, whichever moved —
  // a clicks-only pacing has no impressions, and a CPC pacing that still serves
  // impressions past flight end must not go silent.
  var postImpr = 0;
  var lastPost = null;
  var ld = state.liDaily || {};
  for (var li in ld) {
    var dd = ld[li];
    var nf = nativeField(state.liPlan && state.liPlan[li] && state.liPlan[li].rateType);
    for (var d in dd) {
      if (parseUTC(d) > parseUTC(fe)) {
        var u = Math.max(+(dd[d] && dd[d][nf]) || 0, +(dd[d] && dd[d].im) || 0);
        if (u > 0) {
          postImpr += u;
          if (!lastPost || d > lastPost) lastPost = d;
        }
      }
    }
  }
  if (!(postImpr > 0) || !lastPost) return null;            // clean end ⇒ silent

  var activeDays = +(cfg.active_days != null ? cfg.active_days : 3);
  var ageDays = Math.floor((parseUTC(today) - parseUTC(lastPost)) / 864e5);
  if (ageDays > activeDays) return null;                    // wound down ⇒ silent

  var daysPastEnd = Math.floor((parseUTC(today) - parseUTC(fe)) / 864e5);
  var name = state.pacing.name || state.pacing.id || '';

  return {
    type: 'post_flight_delivery',
    severity: 'warning',
    scope: 'campaign',
    li_id: null,
    text: 'Still delivering past flight end ' + fe + ' (last ' + lastPost + ') — ' + name,
    metadata: {
      flight_end: fe,
      last_date: lastPost,
      post_flight_impr: postImpr,      // name kept for consumers; carries native-or-impressions activity
      post_flight_units: postImpr,
      days_past_end: daysPastEnd,
    },
  };
}

// A per-LI pause is a config intent ("stop this LI"), but delivery can still
// leak for a day or two after the DSP is told to stop. This detector surfaces
// that leak: a PAUSED LI that is still serving impressions in the recent window.
// alerts-core owns NO pause/container math — it only READS the upstream-stamped
// `state.isPaused(id)` boolean (callers compute it via PacingCore.isLiPaused).
function detectPausedLiDelivering(state, cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return [];
  if (!hasSettled(state)) return [];
  var minImp = +(cfg.min_impressions != null ? cfg.min_impressions : 1);
  var win = Math.max(1, (cfg.window | 0) || 1);
  var tail = state.sortedDates.slice(-win);
  var out = [];
  for (var id in state.liPlan) {
    if (!state.isPaused(id)) continue;
    var dd = state.liDaily[id] || {};
    // SERVING question, not a purchased-unit one: a paused LI burning impressions
    // with no clicks must not go silent on a CPC pacing, and a clicks-only pacing
    // has no impressions to burn. Whichever moved counts.
    var nf = nativeField(state.liPlan[id] && state.liPlan[id].rateType);
    var units = 0, im = 0, sp = 0;
    for (var i = 0; i < tail.length; i++) { var r = dd[tail[i]]; if (r) { units += (+r[nf] || 0); im += (+r.im || 0); sp += (+r.sp || 0); } }
    var active = Math.max(units, im);
    if (active <= minImp) continue;
    var name = (state.liPlan[id] && state.liPlan[id].name) || id;
    out.push({
      type: 'paused_li_delivering', severity: 'warning', scope: 'line_item', li_id: id,
      text: 'Paused but delivering — ' + name + ' (' + Math.round(units > 0 ? units : im)
        + ' ' + unitWord(units > 0 ? nf : 'im') + ' in last ' + win + 'd)',
      metadata: { li_id: id, li_name: name, units: units, im: im, sp: sp, window: win },
    });
  }
  return out;
}

/* ── Display helpers ──────────────────────────────────────────────────────── */

function compactMoney(n) {
  n = +n || 0;
  var sign = n < 0 ? '-' : '';
  var abs = Math.abs(n);
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
  return sign + '$' + Math.round(abs);
}

/**
 * displayParts(alert) → { value, label }
 *
 * Splits an alert into a short numeric `value` (for prominent display) and a
 * short `label` (description without severity adverbs, LI name, or the number).
 * `value` is null for alert types that have no meaningful number.
 *
 * Used by UI cards (B4d layout). Payload is not mutated.
 */
function num(v) { var n = +v; return isFinite(n) ? n : 0; }

function displayParts(alert) {
  if (!alert || !alert.type) return { value: null, label: '' };
  var md = alert.metadata || {};
  switch (alert.type) {
    case 'pacing_off_pace': {
      var pI = num(md.pI);
      var sign = pI >= 0 ? '+' : '';
      var lbl = md.direction === 'under' ? 'pacing under target' : 'pacing over target';
      return { value: sign + pI.toFixed(1) + 'pp', label: lbl };
    }
    case 'dsp_forecast_overspend':
      return { value: '+' + compactMoney(num(md.overshoot_abs)), label: 'forecast over budget' };
    case 'margin_below_target': {
      var dM = num(md.mA) - num(md.mT);
      var sM = dM >= 0 ? '+' : '';
      return { value: sM + dM.toFixed(1) + 'pp', label: 'margin below target' };
    }
    case 'spend_overspend': {
      var lblS = alert.severity === 'critical' ? 'spend over budget' : 'spend near budget';
      return { value: Math.round(num(md.pct)) + '%', label: lblS };
    }
    case 'no_impressions_yet': {
      var fs = md.flight_start, td = md.today;
      var days = 0;
      if (fs && td) {
        var dT = (parseUTC(td) - parseUTC(fs)) / 864e5;
        days = Math.max(0, Math.floor(dT));
      }
      return { value: days + 'd', label: 'no delivery since start' };
    }
    case 'bid_fact_above_plan': {
      var os = num(md.overshoot_pct);
      var sB = os >= 0 ? '+' : '';
      return { value: sB + Math.round(os) + '%', label: 'bid above plan' };
    }
    case 'ctr_below_target': {
      var dC = num(md.ctr) - num(md.ctrT);
      var sC = dC >= 0 ? '+' : '';
      return { value: sC + dC.toFixed(2) + 'pp', label: 'CTR below target' };
    }
    case 'vcr_below_target': {
      var dV = num(md.vcr) - num(md.vcrT);
      var sV = dV >= 0 ? '+' : '';
      var lblV = (md.ch || '').toLowerCase() === 'audio' ? 'ACR' : 'VCR';
      return { value: sV + dV.toFixed(1) + 'pp', label: lblV + ' below target' };
    }
    case 'ctr_above_target': {
      var dCa = num(md.ctr) - num(md.ctrT);
      var sCa = dCa >= 0 ? '+' : '';
      return { value: sCa + dCa.toFixed(2) + 'pp', label: 'CTR above target' };
    }
    case 'vcr_over_100': {
      var lblO = (md.ch || '').toLowerCase() === 'audio' ? 'ACR' : 'VCR';
      return { value: Math.round(num(md.vcr)) + '%', label: lblO + ' over 100% — data error' };
    }
    case 'rate_cost_above_plan': {
      var over = num(md.planned) > 0 ? ((num(md.actual) - num(md.planned)) / num(md.planned)) * 100 : 0;
      return { value: '+' + Math.round(over) + '%', label: (md.rateType || 'rate') + ' above plan' };
    }
    case 'stale_data':
      return { value: num(md.ageDays) + 'd', label: 'data is stale' };
    case 'post_flight_delivery':
      return { value: num(md.days_past_end) + 'd', label: 'delivering past flight end' };
    case 'data_gap':
      return { value: num(md.gap_days) + 'd', label: 'data gap' };
    default:
      return { value: null, label: alert.type };
  }
}

/* ── Orchestrator ─────────────────────────────────────────────────────────── */

function computeAlerts(state, cfg) {
  cfg = cfg || {};

  var SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
  var evaluated = [];
  var out = [];

  function run(key, fn) {
    var sub = cfg[key];
    if (sub && sub.enabled === false) return;
    evaluated.push(key);
    var r = fn(state, sub || {});
    if (r === null || r === undefined) return;
    if (Array.isArray(r)) { for (var i = 0; i < r.length; i++) out.push(r[i]); }
    else out.push(r);
  }

  run('bid_fact_above_plan',     detectBidFactAbovePlan);
  run('data_gap',                detectDataGap);
  run('ctr_below_target',        detectCtrBelowTarget);
  run('vcr_below_target',        detectVcrBelowTarget);
  run('ctr_above_target',        detectCtrAboveTarget);
  run('vcr_over_100',            detectVcrOver100);
  run('rate_cost_above_plan',    detectRateCostAbovePlan);
  run('no_impressions_yet',      detectNoImpressionsYet);
  run('pacing_off_pace',         detectPacingOffPace);
  run('margin_below_target',     detectMarginBelowTarget);
  run('spend_overspend',         detectSpendOverspend);
  run('dsp_forecast_overspend',  detectDspForecastOverspend);
  run('stale_data',              detectStaleData);
  run('post_flight_delivery',    detectPostFlightDelivery);
  run('paused_li_delivering',    detectPausedLiDelivering);

  // Per-LI pause: mute routine line_item alerts for paused LIs; keep the leak.
  out = out.filter(function (a) {
    if (a.scope === 'line_item' && a.type !== 'paused_li_delivering' && state.isPaused(a.li_id)) return false;
    return true;
  });

  out.sort(function (a, b) {
    var s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return (a.type < b.type) ? -1 : (a.type > b.type ? 1 : 0);
  });

  return { alerts: out, types_evaluated: evaluated };
}

/* ── UMD export ───────────────────────────────────────────────────────────── */

var AlertsCore = {
  buildState: buildState,
  computeAlerts: computeAlerts,
  displayParts: displayParts,
  detectBidFactAbovePlan: detectBidFactAbovePlan,
  detectDataGap: detectDataGap,
  detectCtrBelowTarget: detectCtrBelowTarget,
  detectVcrBelowTarget: detectVcrBelowTarget,
  detectCtrAboveTarget: detectCtrAboveTarget,
  detectVcrOver100: detectVcrOver100,
  detectRateCostAbovePlan: detectRateCostAbovePlan,
  detectNoImpressionsYet: detectNoImpressionsYet,
  detectPacingOffPace: detectPacingOffPace,
  detectMarginBelowTarget: detectMarginBelowTarget,
  detectSpendOverspend: detectSpendOverspend,
  detectDspForecastOverspend: detectDspForecastOverspend,
  detectStaleData: detectStaleData,
  detectPostFlightDelivery: detectPostFlightDelivery,
  detectPausedLiDelivering: detectPausedLiDelivering,
  // internals exposed for tests
  _parseUTC: parseUTC,
  _daysBetween: daysBetween,
  _safeDiv: safeDiv,
  _hasSettled: hasSettled,
  _nativeUnits: nativeUnits,
  _compactMoney: compactMoney,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AlertsCore;
} else {
  root.AlertsCore = AlertsCore;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
