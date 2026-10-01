// Presentation only: attributed conversions can be fractional. Never round the
// values sent to aggregation, sorting, formulas, or exports.
const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const CONVERSION_METRICS = new Set(['cv', 'pc', 'pv']);

export const isConversionMetric = (metric) => CONVERSION_METRICS.has(metric);
export const isConversionValue = (value) => value?.kind === 'metric' && isConversionMetric(value.metric);

export function formatConversion(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number !== 0 && Math.round(Math.abs(number) * 10) === 0) return number > 0 ? '<0.1' : '>−0.1';
  return countFormat.format(number === 0 ? 0 : number);
}
