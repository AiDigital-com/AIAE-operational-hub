// workspace/src/lib/dashboard/report-calc.js
//
// The v2 report's TWO calc series (widget-builder v2 spec 2026-08-19 §8; the normative
// arithmetic is the superseded spec's §6.2, carried forward unchanged):
//
//   planPerDay    what the plan asked for on THIS calendar day
//   neededPerDay  what the rest of the flight would have to average, seen from that day
//
// Both are computed over the widget's OWN line items — `sources.effLIs` after its scope
// overrides — and over the CONTINUOUS calendar axis the widget engine already walks. No
// React, no DOM, no store: everything arrives as an argument.
//
// This file adds no arithmetic of its own. It FEEDS two canonical implementations:
//   · the plan curve is `liExpUnits` (pause-, container-, date-child- and period-aware),
//     reached through aggregateDateRows' `expIm` column;
//   · the reforecast is `paceToGoalTargets` (reforecast-series.js), shared by every
//     projection that needs the historical required run-rate.
// Do NOT confuse the latter with `shared/pacing-core.js:65 neededPerDay`: that one's
// days-left convention is EXCLUSIVE of the day it answers for (split-metrics only), and
// swapping it in shifts every target by a day's worth of delivery.
import { aggregateDateRows } from './widget-data.js';
import { paceToGoalTargets } from './reforecast-series.js';
import { scopedCampCtx } from './report-render.js';
import { isVcrEligible } from './metrics.js';
import { cvOnlyDaysOf } from './primary-cv.js';

/** The empty answer: a shape every caller can `.map` over, for a question with no axis. */
const NO_SERIES = () => ({ dates: [], values: [] });

const PROJECTION_FIELDS = {
  im: { actual: 'im', expected: 'expIm', round: true },
  cl: { actual: 'cl', expected: 'expCl', round: true },
  coViews: { actual: 'coViews', expected: 'expVw', round: true },
  sp: { actual: 'sp', expected: 'expCo', round: false },
};

/** The fact-date projection domain: one row for every stored fact date in the Widget's
 * scoped population. An explicit all-zero fact remains a fact;
 * an absent calendar day does not become a plotted category merely because the plan spans it.
 * A conversion-only day row (spec 2026-09-13 §3 "Days") is not a fact: on these charts such a
 * conversion is not its own daily point, and it still counts in totals and cumulative lines. */
export function projectionFactDates(sources, range) {
  if (!sources || !sources.liDaily || !sources.liPlan || !Array.isArray(sources.effLIs)) return [];
  const cvOnly = cvOnlyDaysOf(sources.liDaily);
  const dates = new Set();
  for (const id of sources.effLIs) {
    const plan = sources.liPlan[id];
    const skip = cvOnly && cvOnly[id];
    for (const date of Object.keys(sources.liDaily[id] || {})) {
      if (plan && plan.fs && plan.fe && (date < plan.fs || date > plan.fe)) continue;
      if (range && (date < range.from || date > range.to)) continue;
      if (skip && skip.has(date)) continue;
      dates.add(date);
    }
  }
  return [...dates].sort();
}

/**
 * Calendar first, filter second (spec 2026-09-10 «One calculation»). Every projection is
 * computed over the continuous calendar rows and only THEN narrowed to the drawn dates, so a
 * fact-date axis shows each retained day's own value — the per-calendar-day derivative the
 * base design's §8 names — never a value averaged across the gap to the previous fact. The
 * same order makes Plan / day identical to a fixed-Plan projection and Needed / day to a
 * fixed-Reforecast one, per date, by construction.
 */
function projectionDomain(calendar, values, sources, range, domain) {
  if (domain !== 'factDates') return { dates: calendar.map((row) => row.date), values };
  const wanted = new Set(projectionFactDates(sources, range));
  const dates = [];
  const kept = [];
  calendar.forEach((row, index) => {
    if (!wanted.has(row.date)) return;
    dates.push(row.date);
    kept.push(values[index]);
  });
  return { dates, values: kept };
}

function projectionPlan(rows, basis, output) {
  const fields = PROJECTION_FIELDS[basis];
  if (!fields) return [];
  if (output === 'cumulative') {
    return rows.map((row) => {
      const value = Number(row[fields.expected]) || 0;
      return fields.round ? Math.round(value) : value;
    });
  }

  // `rows` is the continuous calendar, so the day's plan is the plain delta of the expected
  // curve — the same reading `planPerDay` below has always taken.
  let previous = 0;
  return rows.map((row) => {
    const current = Number(row[fields.expected]) || 0;
    const value = current - previous;
    previous = current;
    return fields.round ? Math.round(value) : value;
  });
}

function projectionGoal(ctx, basis) {
  if (!ctx) return { total: 0 };
  if (basis === 'im') {
    return { total: Math.max(0, (ctx.allPlanImpr || 0) - (ctx.allPlanImprPausedRem || 0)) };
  }
  if (basis === 'cl') {
    return { total: Math.max(0, (ctx.clicksPlan || ctx.planClicks || 0) - (ctx.clicksPlanPausedRem || 0)) };
  }
  if (basis === 'coViews') {
    return { total: Math.max(0, (ctx.viewsPlan || 0) - (ctx.viewsPlanPausedRem || 0)) };
  }
  return { total: Math.max(0, (ctx.costBudTotal || 0) - (ctx.costBudPausedRem || 0)) };
}

function projectionReforecast(rows, sources, range, basis, output) {
  if (!rows.length) return [];
  const fields = PROJECTION_FIELDS[basis];
  const ctx = scopedCampCtx(sources);
  const seed = preRangeSeed(sources, range);
  Object.defineProperty(rows, 'preRange', { value: seed, enumerable: false });

  const horizon = (ctx && ctx.scopeEnd) || null;
  let daily;
  // The goal the series paces to, in the basis's OWN units — the cumulative branch below
  // needs it to know where the line stands once the flight is over.
  let goalTotal;
  if (basis === 'sp') {
    // Spend reforecast is deliberately impressions-paced whenever an
    // impressions plan exists: delivery demand × planned media cost per impression.
    // Pure CPC/CPV configurations have no such denominator and pace the cost ceiling.
    const cost = projectionGoal(ctx, 'sp').total;
    goalTotal = cost;
    const impressionPlan = Math.max(0,
      ((ctx && ctx.imprPlan) || 0) - ((ctx && ctx.imprPlanPausedRem) || 0));
    if (impressionPlan > 0) {
      const impressionRows = rows;
      const targetImpressions = paceToGoalTargets(
        impressionRows,
        { flightEnd: horizon, planTotal: impressionPlan },
        'im', true,
      );
      daily = targetImpressions.map((value) => value * (cost / impressionPlan));
    } else {
      daily = paceToGoalTargets(rows, {
        flightEnd: horizon,
        planTotal: cost,
      }, fields.actual, false);
    }
  } else {
    const goal = projectionGoal(ctx, basis);
    goalTotal = goal.total;
    daily = paceToGoalTargets(rows, {
      flightEnd: horizon,
      planTotal: goal.total,
    }, fields.actual, fields.round);
  }

  if (output !== 'cumulative') return daily;
  // Cumulative = where the line SHOULD have stood at the end of each day, given where
  // delivery actually stood before it. Summing the daily targets instead double-counts:
  // each target is recomputed against ACTUALS, so a shortfall is charged once per
  // remaining day and the line finishes above the goal it paces to. On the last flight
  // day this reads actualBefore(fe) + (plan − actualBefore(fe)) / 1 — the plan, exactly.
  // `run` re-walks the same actuals, in the same order, that paceToGoalTargets walked,
  // which is what keeps the daily and cumulative outputs two views of one series.
  //
  // PAST THE HORIZON the question has no answer left to compute: reforecastTarget owes 0
  // beyond flight end, so `run + 0` would print the running ACTUAL and the line would
  // fall from the goal to whatever was delivered — a Range whose `to` outlives the flight
  // is the ordinary way to look at a finished pacing, and calendarBounds passes it
  // through unclamped. So the line HOLDS its last in-flight value instead. That value is
  // the goal (the final flight day owes the whole remainder), which is the only
  // meaningful reading of "where you should have stood" once there is no flight left —
  // and holding it, rather than clamping the series, is why the line never goes backwards.
  let run = Number(seed[fields.actual]) || 0;
  // A window that starts AFTER flight end has no in-flight row to hold, so it opens on
  // what the final flight day would have printed: everything delivered by then (the seed
  // carries it — a fact past fe is not the line's delivery and never reaches a row), plus
  // whatever of the goal was still owed. That is the same actualBefore + remainder the
  // walk computes, evaluated at the horizon. Any window WITH an in-flight row overwrites
  // this on its first pass, since a row before the horizon always sorts first.
  const owed = Math.max(0, (Number(goalTotal) || 0) - run);
  let held = run + (fields.round ? Math.round(owed) : owed);
  return daily.map((target, i) => {
    const row = rows[i];
    if (horizon && row.date > horizon) return held;
    const value = run + (Number(target) || 0);
    run += Number(row[fields.actual]) || 0;
    held = value;
    return value;
  });
}

/**
 * preRangeSeed(sources, range) → `{im, sp, cl, co, coViews}`.
 *
 * Actual delivery inside the flight but BEFORE the visible window, over the widget's own
 * lines. Without it a Range filter would make the reforecast divide the whole plan by the
 * remaining days as if nothing had ever been delivered — the 167 of the Audio golden
 * would read 333.
 *
 * The reference is the chart selector's own seed (selectors.js:398-410) and this is the
 * same walk, over the widget's scoped `effLIs`/`liPlan` instead of the dashboard's
 * globally filtered ones: the flight clamp first (a fact outside its line's own dates is
 * not that line's delivery), then STRICTLY before `range.from` — the first visible day is
 * already a row the reforecast walks, and seeding it too would count it twice.
 *
 * No range → all zeros, exactly as the unfiltered chart: with the axis starting at the
 * flight, there is no "before" for a fact to sit in.
 *
 * `coViews` carries the BROAD views-volume gate verbatim (CPV, or VCR-eligible, or audio
 * — selectors.js:403-408) so the pre-window cumulative and the in-window actual line agree
 * across the Range boundary. On the seed the gate is load-bearing only for AUDIO: a
 * non-audio line with any complete at all is VCR-eligible by that fact alone, so its
 * completes seed both fields, while an audio line — never VCR-eligible — would seed
 * neither without the third clause.
 */
export function preRangeSeed(sources, range) {
  const seed = { im: 0, sp: 0, cl: 0, co: 0, coViews: 0 };
  if (!sources || !range || !range.from) return seed;
  const liDaily = sources.liDaily || {};
  const liPlan = sources.liPlan || {};
  for (const id of sources.effLIs || []) {
    const dd = liDaily[id] || {};
    const p = liPlan[id];
    const isCpv = p && p.rateType === 'CPV';
    const isAudio = !!p && (p.ch || '').toLowerCase() === 'audio';
    const viewsBasis = !!(isCpv || isVcrEligible(p, dd) || isAudio);
    for (const [d, v] of Object.entries(dd)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (d >= range.from) continue;
      seed.im += v.im || 0;
      seed.sp += v.sp || 0;
      seed.cl += v.cl || 0;
      seed.co += v.co || 0;
      if (viewsBasis) seed.coViews += v.co || 0;
    }
  }
  return seed;
}

/**
 * calcSeriesValues(calc, sources, range) → `{dates, values}` on the widget's calendar axis.
 *
 * `calc` is `'planPerDay'` or `'neededPerDay'`; the basis is impressions (`im`), the only
 * one v1 offers. Anything else — an unknown calc, an unbuilt `sources`, a window with no
 * days in it — answers with EMPTY arrays rather than a line of zeros: a zero is a measured
 * statement about delivery, and a renderer that cannot tell the two apart draws a flat
 * line across a chart that should have nothing on it.
 *
 * PLAN PER DAY is the per-calendar-day increment of the canonical expected curve:
 *
 *     planPerDay(D) = round( Σ_p liExpUnits(p, D) − liExpUnits(p, dayBefore(D)) )
 *
 * implemented as the delta of `aggregateDateRows`' `expIm` column, whose row 0 is ALREADY
 * a one-day delta (the aggregate subtracts each line's cumulative at `datePrev(range.from)`
 * as its baseline). Two things follow, and both are the point:
 *   · the derivative is always exactly one day wide — a gap between fact dates cannot turn
 *     a one-day target into a two-day sum, which the fact-date chart axis (selectors.js:436)
 *     does today;
 *   · the rounding happens ONCE, at the end, over the summed raw floats — three lines at
 *     0.4 each are a 1, not three 0s.
 *
 * NEEDED PER DAY is the historical reforecast, seeded and scoped:
 *   rows        the same continuous calendar rows, carrying `preRange` non-enumerably —
 *               the shape paceToGoalTargets reads;
 *   flightEnd   `scopeEnd`, the latest flight end among the WIDGET's lines — not the
 *               campaign's `endDate`, which would keep demanding delivery from a scope
 *               that ended a week ago;
 *   planTotal   the all-lines goal less the remaining plan of lines paused at asOf (a
 *               paused line will not deliver, so the target must not demand it).
 * The goal and the horizon both come from ONE scoped, full-flight campaign context
 * (report-render.js's `scopedCampCtx`), and every day is computed the same way, so
 * narrowing the visible window only chooses which historical points are drawn (§6.1).
 */
export function calcSeriesValues(calc, sources, range, options = {}) {
  const projection = calc && typeof calc === 'object' && calc.calc === 'projection' ? calc : null;
  if (!projection && calc !== 'planPerDay' && calc !== 'neededPerDay') return NO_SERIES();
  if (!sources || !sources.liDaily || !sources.liPlan || !Array.isArray(sources.effLIs)) return NO_SERIES();

  if (projection) {
    const calendar = aggregateDateRows(sources, range);
    if (!calendar.length || !PROJECTION_FIELDS[projection.basis]) return NO_SERIES();
    const mode = options.mode === 'reforecast' ? 'reforecast' : 'plan';
    const values = mode === 'reforecast'
      ? projectionReforecast(calendar, sources, range, projection.basis, projection.output)
      : projectionPlan(calendar, projection.basis, projection.output);
    return projectionDomain(calendar, values, sources, range, options.domain);
  }

  const rows = aggregateDateRows(sources, range);
  if (!rows.length) return NO_SERIES();
  const dates = rows.map((r) => r.date);

  if (calc === 'planPerDay') {
    return { dates, values: rows.map((r, i) => Math.round(r.expIm - (i > 0 ? rows[i - 1].expIm : 0))) };
  }

  const ctx = scopedCampCtx(sources);
  Object.defineProperty(rows, 'preRange', { value: preRangeSeed(sources, range), enumerable: false });
  const reforecast = {
    flightEnd: (ctx && ctx.scopeEnd) || null,
    planTotal: Math.max(0, ((ctx && ctx.allPlanImpr) || 0) - ((ctx && ctx.allPlanImprPausedRem) || 0)),
  };
  return { dates, values: paceToGoalTargets(rows, reforecast, 'im', true) };
}
