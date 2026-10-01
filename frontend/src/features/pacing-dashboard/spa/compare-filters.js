import { parseBreakdownFilters } from './breakdown-filter.js';

// Mapping tuples cannot reliably apply a delivery dimension/platform filter to
// both sides. Keep date windowing independent and preserve all unfiltered reads.
export function cm360FilterReason(filters) {
  const kinds = [];
  const implicit = Object.keys(filters?.containerFilters || {}).some(id =>
    (!filters?.effLIs || filters.effLIs.includes(id)) && Object.keys(filters.containerFilters[id] || {}).length);
  if (parseBreakdownFilters({ brkf: filters?.brkf }).length) kinds.push('dimension');
  if (filters?.platforms?.length) kinds.push('platform');
  if (implicit) return `CM360 does not follow this period's dimension scope. Turn off Period Scope${kinds.length ? ' and clear these filters' : ''} to see CM360 values.`;
  return kinds.length
    ? `CM360 does not follow the active ${kinds.join(' and ')} filters. Clear those filters to see CM360 values.`
    : null;
}
