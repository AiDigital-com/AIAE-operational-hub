import { LAYOUT_RATE_UNITS } from './report-v2.js';

/** CPA is a computed dynamic rate; the other rate-row series have no CPA reading. */
export function rateUnitsForSeries(series) {
  return series === 'dynamic'
    ? [...LAYOUT_RATE_UNITS]
    : LAYOUT_RATE_UNITS.filter((unit) => unit !== 'CPA');
}

/** An explicit series change keeps compatible choices and never leaves a new empty block. */
export function normalizeRateUnitsForSeries(series, units) {
  if (!Array.isArray(units)) return undefined;
  const supported = rateUnitsForSeries(series);
  const compatible = units.filter((unit) => supported.includes(unit));
  return compatible.length ? compatible : supported;
}
