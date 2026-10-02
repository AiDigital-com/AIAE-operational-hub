// workspace/src/lib/dashboard/split-metrics.js
// Pure split-row (container date_child / dim_child) metric helpers.
//
// Margin is REALIZED, consistent with LI- and campaign-level margin
// (metrics.js: PacingCore.margin(t.dc, t.sp)): derived from actual dynamic
// cost — the client-facing revenue delivered in the split's window — NOT from
// the prorated planned client budget (target_spend × time-fraction). The
// dynamic cost is already aggregated per split by sumDateChild / sumDimChild
// in containers.js as `act.dc`.
import PacingCore from './pacing-core.js';
import { dI } from './date-utils.js';

/**
 * Resolve a split's target margin with the canonical fallback child → container
 * → plan. `0` is a valid explicit override (means "no margin"); only null/empty
 * triggers inheritance — mirrors PacingCore.effMargin semantics.
 *
 * @param {object|null} child      date_child or dim_child (may carry margin_percent)
 * @param {object|null} container  parent container (may carry margin_percent)
 * @param {object|null} plan       LI plan (mTgt fallback)
 * @returns {number}
 */
export function effSplitMargin(child, container, plan) {
  if (child && child.margin_percent != null && child.margin_percent !== '') {
    return Number(child.margin_percent);
  }
  if (container && container.margin_percent != null && container.margin_percent !== '') {
    return Number(container.margin_percent);
  }
  return plan && plan.mTgt != null ? Number(plan.mTgt) : 0;
}

/**
 * Realized margin for one split child from its aggregated actuals.
 *
 * @param {{dc:number, sp:number}} act  split actuals (sumDateChild / sumDimChild)
 * @param {object|null} child           date_child or dim_child
 * @param {object|null} container       parent container
 * @param {object|null} plan            LI plan (mTgt fallback)
 * @param {number} marginWarn           negative pp threshold for the amber band
 * @returns {{ effM:number, marginActual:(number|null), hasMargin:boolean, status:(string|null) }}
 */
export function splitActualMargin(act, child, container, plan, marginWarn) {
  const effM = effSplitMargin(child, container, plan);
  const dc = (act && Number(act.dc)) || 0;
  const sp = (act && Number(act.sp)) || 0;
  const hasMargin = dc > 0;
  const marginActual = hasMargin ? PacingCore.margin(dc, sp) : null;
  const status = hasMargin ? PacingCore.marginStatus(marginActual, effM, marginWarn) : null;
  return { effM, marginActual, hasMargin, status };
}

/**
 * Target progress for one container child (date or dim) over its effective
 * window [fs..fe]. `au` must be the FULL-window actual in the child's unit
 * (impressions for dims; the LI's rate unit for date children) — NOT the
 * URL-range-filtered sum: "what's left of the target" is range-independent.
 * Day conventions match campM: dp counts today as elapsed, daysLeft = fd - dp
 * (today is not a remaining day). Division by zero returns 0 (project canon).
 * @returns {{ remaining:number, daysLeft:number, neededPerDay:number,
 *             state:'not_started'|'active'|'ended' }}
 */
export function childProgress({ ti, au, fs, fe, asOf }) {
  const target = Number(ti) || 0;
  const actual = Number(au) || 0;
  // needed/day comes from the single canonical pace-to-goal source so the
  // SplitRow figure is identical to the Slack daily summary's Tgt. Its branch
  // logic mirrors this function's remaining/daysLeft exactly (guarded by
  // tests/needed-per-day-test.js); remaining/daysLeft/state stay local for display.
  const neededPerDay = PacingCore.neededPerDay(ti, au, fs, fe, asOf);
  if (!(target > 0) || !fs || !fe) {
    return { remaining: 0, daysLeft: 0, neededPerDay, state: 'not_started' };
  }
  const fd = Math.max(1, dI(fs, fe));
  const remaining = Math.max(0, target - actual);
  if (!asOf || asOf < fs) {
    return { remaining, daysLeft: fd, neededPerDay, state: 'not_started' };
  }
  if (asOf > fe) {
    return { remaining, daysLeft: 0, neededPerDay, state: 'ended' };
  }
  const daysLeft = Math.max(0, fd - dI(fs, asOf));
  return { remaining, daysLeft, neededPerDay, state: 'active' };
}
