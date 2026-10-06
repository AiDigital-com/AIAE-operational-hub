// Named domain readings for ordinary Layout bindings. The old Flight brick and its
// editable recipe share exactly the same campaign flight: its range-aware day and its remainder.
import { LAYOUT_DOMAIN_READINGS } from './report-v2.js';

export const LAYOUT_READING_OPTIONS = Object.freeze([
  { key: 'flight.day', label: 'Flight day', note: 'Days from the earliest line item start to the last data day in the selected window.', format: 'int' },
  { key: 'flight.total', label: 'Flight duration', note: 'Days from the earliest line item start to the latest line item end.', format: 'int' },
  { key: 'flight.remaining', label: 'Flight days remaining', note: 'Days after the last data day until the latest line item end.', format: 'int' },
].map((entry) => Object.freeze(entry)));

// The campaign's own flight, earliest line start to latest line end (metrics.js campaignSpan,
// 2026-09-29), so «Day X of Y · N days left» adds up: X + N = Y on the flight. They were the
// averages of the lines' own days, which on a pacing whose lines end on different dates read
// «Flight ended» with two lines still running. `effLIs` is kept for callers; the span is cm's.
export function flightProgress(cm, flCM, effLIs) { // eslint-disable-line no-unused-vars
  const left = Math.max(0, (flCM && flCM.daysLeft) || 0);
  return {
    day: (cm && cm.flightSpanDay) || 0,
    total: (cm && cm.flightSpanDays) || 0,
    daysLeft: left,
    daysLeftText: left === 0 ? 'flight ended' : left === 1 ? '1 day left' : `${left} days left`,
  };
}

export function layoutReading(key, ctx = {}) {
  if (!LAYOUT_DOMAIN_READINGS.includes(key)) return { value: null, error: 'Unknown domain reading' };
  const progress = flightProgress(ctx.cm, ctx.flCM, ctx.effLIs);
  return { value: progress[({ 'flight.day': 'day', 'flight.total': 'total', 'flight.remaining': 'daysLeft' })[key]], format: 'int' };
}
