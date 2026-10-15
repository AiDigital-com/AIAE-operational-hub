// workspace/src/lib/dashboard/launch-plan.js
//
// Launch recommendations (F5, 2026-07-11): indicative starting daily volumes
// for a campaign that has NOT started yet — the pre-launch pacing-document
// replacement. Owner decision: EVEN split (plan units / flight days); a
// curve-aware variant was considered and rejected. Pure + host-tested.

import PacingCore from './pacing-core.js';

/** Today's YYYY-MM-DD in the campaign's operating timezone (not the browser's). */
export function todayInTz(tz) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'America/Chicago' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** True while the campaign flight has not begun (campaign-TZ day). */
export function campaignNotStarted(campaign, today = null) {
  const start = campaign?.startDate;
  if (!start) return false;
  const t = today || todayInTz(campaign?.timezone);
  return t < start;
}

const perDay = (total, days) => (days > 0 && total > 0 ? total / days : 0);

/**
 * Even-split daily recommendations per LI (and per container with targets).
 *
 * Two modes, selected by `fromDate`:
 *  - launch (fromDate omitted): plan / FULL flight days — the pre-start view.
 *  - catch-up (fromDate = campaign-TZ today): the flight is running but NOTHING
 *    has delivered — the full plan is spread over the REMAINING days
 *    (max(fs, fromDate) .. fe, inclusive); windows that already ended drop out.
 *
 * @param {Object} liPlan  map id → plan ({ ch, rateType, fs, fe, planImpr, budget, containers })
 * @param {string} [fromDate]  YYYY-MM-DD — clamp every window's start to this day
 * @returns {{ rows: Array, totals: { spendPerDay: number, unitsPerDayByRt: Object } }}
 */
export function buildLaunchPlan(liPlan, fromDate = null) {
  const rows = [];
  const totals = { spendPerDay: 0, unitsPerDayByRt: {} };
  const clamp = (fs) => (fromDate && fromDate > fs ? fromDate : fs);

  for (const liId of Object.keys(liPlan || {}).sort()) {
    const p = liPlan[liId];
    if (!p || !p.fs || !p.fe || p.fs > p.fe) continue;
    const fs = clamp(p.fs);
    if (fs > p.fe) continue; // flight already over — nothing to recommend
    const days = Math.max(1, PacingCore.daysBetween(fs, p.fe));
    const rt = p.rateType || 'CPM';
    const dailyUnits = perDay(Number(p.planImpr) || 0, days);
    const dailySpend = perDay(Number(p.budget) || 0, days);

    const containers = (p.containers || [])
      .filter((c) => c && c.fs && c.fe && c.fs <= c.fe && (Number(c.target_impressions) || 0) > 0)
      .filter((c) => clamp(c.fs) <= c.fe)
      .map((c) => {
        const cFs = clamp(c.fs);
        const cDays = Math.max(1, PacingCore.daysBetween(cFs, c.fe));
        return {
          name: c.name || 'Container',
          fs: cFs,
          fe: c.fe,
          days: cDays,
          dailyUnits: perDay(Number(c.target_impressions) || 0, cDays),
          dailySpend: perDay(Number(c.target_spend) || 0, cDays),
        };
      });

    rows.push({ liId, ch: p.ch || 'Unknown', rt, fs, fe: p.fe, days, dailyUnits, dailySpend, containers });

    totals.spendPerDay += dailySpend;
    // Units never mix across rate types — impressions + clicks + views is not
    // a number. Totals are kept per rate type.
    totals.unitsPerDayByRt[rt] = (totals.unitsPerDayByRt[rt] || 0) + dailyUnits;
  }

  return { rows, totals };
}

/**
 * Which recommendation mode applies (or null for none):
 *  - 'launch'  — flight not started (existing pre-start card);
 *  - 'catchup' — flight running, campaign not over, ZERO delivered rows.
 * First delivery (rowCount > 0) retires the card.
 */
export function launchPlanMode(campaign, rowCount, today = null) {
  if (!campaign?.startDate) return null;
  const t = today || todayInTz(campaign?.timezone);
  if (t < campaign.startDate) return 'launch';
  if (rowCount === 0 && campaign.endDate && t <= campaign.endDate) return 'catchup';
  return null;
}
