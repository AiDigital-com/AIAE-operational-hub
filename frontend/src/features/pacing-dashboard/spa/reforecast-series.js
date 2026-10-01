// Historical pace-to-goal series for canonical Widget projections.
//
// The per-day maths lives in shared/pacing-core.js:reforecastTarget — the SAME
// function the Overview heatmap and the Slack summary call. This module only walks
// the rows and carries the running "delivered before this day" total.
//
// `rows.preRange[valueField]` seeds delivery before the visible window, so a
// range-filtered Widget shows the same historical targets as the full-flight series:
// a date filter changes what is VISIBLE, never how a day is computed.
// `round` is true for unit counts and false for money.

import PacingCore from './pacing-core.js';

export function paceToGoalTargets(rows, reforecast, valueField, round) {
  const { flightEnd, planTotal } = reforecast;
  const total = planTotal || 0;
  const targets = [];
  const pre = rows.preRange && rows.preRange[valueField] ? rows.preRange[valueField] : 0;
  let run = pre;

  for (const row of rows) {
    const target = PacingCore.reforecastTarget(total, run, row.date, flightEnd);
    targets.push(round ? Math.round(target) : target);
    run += row[valueField] || 0;
  }

  return targets;
}
