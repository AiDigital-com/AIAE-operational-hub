import { COLOR_SLOTS } from '../report-v2.js';
import { cmFeedOf, reportDimKey, resolveValue, valueToExpr } from '../report-render.js';

export function pieSliceColor(slice, index) {
  if (slice.residual) return 'var(--text-faint)';
  if (slice.others || slice.leftover) return 'var(--text-muted)';
  return `var(--pal-${((index % COLOR_SLOTS) + COLOR_SLOTS) % COLOR_SLOTS})`;
}

// A table can serve as a pie's legend only when both describe the same reading.
// Adjacency is checked by the layout caller, never inferred from a widget name.
export function pieTablePair(pie, table, spec, controlState, pieModel, tableModel) {
  if (pie?.kind !== 'pie' || table?.kind !== 'table' || !pieModel || !tableModel) return null;
  const dim = reportDimKey(pie, spec, controlState);
  if (!dim || dim !== tableModel.rowDimension || dim !== reportDimKey(table, spec, controlState)) return null;
  if (!!pie.residual !== !!table.residual || tableModel.shareError) return null;
  const shareColumn = table.share?.columnId;
  // Authored columns can disappear on this pacing (buy unit / empty basis). A
  // reference to one cannot make the table a legend for a reading it cannot show.
  if (shareColumn && (!tableModel.columns.some((column) => column.id === shareColumn)
    || Object.hasOwn(tableModel.colErrors || {}, shareColumn))) return null;
  const shareValue = table.share?.value || table.columns?.find((column) => column.id === table.share?.columnId)?.value;
  const a = resolveValue(pie.value, spec, controlState);
  const b = resolveValue(shareValue, spec, controlState);
  const dataset = spec?.dataset?.type || 'delivery';
  if (!a || !b || cmFeedOf(a, dataset) || cmFeedOf(b, dataset)) return null;
  const expr = valueToExpr(a, dataset);
  if (expr == null || expr !== valueToExpr(b, dataset) || (a.source || 'bq') !== (b.source || 'bq')) return null;
  return { pieId: pie.id, tableId: table.id, pieModel, tableModel };
}

const markerKey = (row) => JSON.stringify([row.label, !!row.residual, !!row.leftover]);

export function pieTableMarkers(slices) {
  const markers = new Map();
  let folded = null;
  slices.forEach((slice, index) => {
    if (slice.others) folded = slice;
    else markers.set(markerKey(slice), { color: pieSliceColor(slice, index) });
  });
  return (row) => markers.get(markerKey(row)) || {
    color: row.residual ? 'var(--text-faint)' : 'var(--text-muted)',
    title: folded && !row.residual && !row.leftover
      ? `Included in ${folded.label} in the chart` : 'Not shown separately in the chart',
  };
}
