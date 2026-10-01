// Named domain readings for ordinary Layout bindings. The old Flight brick and its
// editable recipe share exactly the same range-aware day averaging and flight remainder.
import { LAYOUT_DOMAIN_READINGS } from './report-v2.js';

export const LAYOUT_READING_OPTIONS = Object.freeze([
  { key: 'flight.day', label: 'Flight day', note: 'Average elapsed days of effective line items in the selected window.', format: 'int' },
  { key: 'flight.total', label: 'Flight duration', note: 'Average flight duration of effective line items in the selected window.', format: 'int' },
  { key: 'flight.remaining', label: 'Flight days remaining', note: 'Remaining days across the full flight.', format: 'int' },
].map((entry) => Object.freeze(entry)));

export function flightProgress(cm, flCM, effLIs) {
  const n = Math.max(1, (effLIs || []).length);
  const left = Math.max(0, (flCM && flCM.daysLeft) || 0);
  return {
    day: Math.round(((cm && cm.totalDP) || 0) / n),
    total: Math.round(((cm && cm.totalFD) || 0) / n),
    daysLeft: left,
    daysLeftText: left === 0 ? 'flight ended' : left === 1 ? '1 day left' : `${left} days left`,
  };
}

export function layoutReading(key, ctx = {}) {
  if (!LAYOUT_DOMAIN_READINGS.includes(key)) return { value: null, error: 'Unknown domain reading' };
  const progress = flightProgress(ctx.cm, ctx.flCM, ctx.effLIs);
  return { value: progress[({ 'flight.day': 'day', 'flight.total': 'total', 'flight.remaining': 'daysLeft' })[key]], format: 'int' };
}
