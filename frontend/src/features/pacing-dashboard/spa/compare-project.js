// workspace/src/lib/mapping/compare-project.js
//
// Seam 2 of the Delivery x CM360 adapter (spec 2026-08-18 §8.5): one dataset
// (seam 1) plus the viewer's choices — breakdown, metric, focus, date window —
// projected into everything a table and a chart need to draw.
//
// Two things live here that the panel does not have, because the panel has no
// stored cap: the `maxSelected` rules of §8.5. Everything else is a
// transcription of ThirdPartyPanel.jsx:336-425 and of the ORDERING that
// CompareTable.jsx:68-69/:125-151 applies on the way to the screen. The order
// moved in here on purpose: the legacy panel and the v2 view read the same
// projection, so they cannot sort the same numbers differently.

import MappingDims from '@shared/mapping-dims';
import { buildComparisonDaily, buildMembership, resolveDimValue, tupleKeyOf } from './third-party-range.js';

const { pivotCompare } = MappingDims;

/** Default breakdown width when nothing caps it (ThirdPartyPanel.jsx:341 `.slice(0, 2)`). */
export const DEFAULT_SELECTED_DIMS = 2;

/**
 * The table's fixed section order, with each section's default open state.
 * Overlap first, the two one-sided sections collapsed between, Unmapped last
 * (§8.5). Ids only — the copy belongs to the component that renders them.
 */
export const COMPARE_SECTION_ORDER = Object.freeze([
  Object.freeze({ id: 'overlap', openByDefault: true }),
  Object.freeze({ id: 'delivery_only', openByDefault: false }),
  Object.freeze({ id: 'cm360_only', openByDefault: false }),
  Object.freeze({ id: 'unmapped', openByDefault: true }),
]);

/** A tuple key's visible label — the row sort's last tie-break (CompareTable.jsx:26). */
export function tupleLabel(key) {
  if (!Array.isArray(key) || key.length === 0) return 'All';
  return key.join(' · ');
}

/**
 * Which dimensions the breakdown runs over, ALWAYS in mapping order — never in
 * the order the user clicked the chips (§8.5).
 *
 *   selectedDimIds === null  → the default. Handed the `dataset`, it is
 *       `comparableDefaultDimIds` (below): dimensions the comparison can actually
 *       compare. Without one, the first min(2, maxSelected ?? 2, availableNonAuto)
 *       NON-auto dims. Auto dims (Channel/Tactic/Month) classify the CM360 side
 *       only through user aliases, so defaulting to one would dump the whole
 *       CM360 side into Unmapped on a fresh mapping (panel :334-343).
 *   selectedDimIds === []    → no breakdown; grand totals.
 *   an explicit list         → those dims, mapping-ordered, with ids the mapping
 *       no longer carries dropped (§7.7's external-deletion rule). A v2 list
 *       longer than `maxSelected` is invalid viewer state and is REPAIRED to the
 *       ordered allowed subset; legacy viewer state (maxSelected null) is uncapped.
 *
 * → { dims, defaultIds, repaired } — `repaired` is true only when a cap actually
 *   cut an explicit selection, so a caller can write the repair back into its state.
 */
export function selectComparisonDims(dims, { selectedDimIds = null, maxSelected = null, dataset = null } = {}) {
  const all = Array.isArray(dims) ? dims : [];
  const nonAuto = all.filter((d) => d && !d.auto_kind);
  const cap = maxSelected == null ? DEFAULT_SELECTED_DIMS : Math.min(DEFAULT_SELECTED_DIMS, maxSelected);
  const defaultIds = dataset
    ? [...comparableDefaultDimIds(dataset, cap)]
    : nonAuto.slice(0, Math.max(0, cap)).map((d) => d.id);

  const wanted = new Set(selectedDimIds == null ? defaultIds : selectedDimIds);
  const ordered = all.filter((d) => d && wanted.has(d.id));
  if (selectedDimIds == null || maxSelected == null || ordered.length <= maxSelected) {
    return { dims: ordered, defaultIds, repaired: false };
  }
  return { dims: ordered.slice(0, Math.max(0, maxSelected)), defaultIds, repaired: true };
}

/**
 * The breakdown a viewer who has picked nothing is shown: the first custom dimensions, in
 * mapping order, that the comparison can actually compare (2026-09-30).
 *
 * A dimension only one side carries (a value that happens to match CM360 placement names and
 * no line name) makes every group one-sided, and so does a pair whose values never meet on the
 * two sides. Defaulting to either left the Compare view with nothing in its overlap and every
 * CM360 date, KPI and total on the tile empty, because `buildComparisonDaily` reads the
 * overlap only — on a widget with no Breakdown switch, where the viewer cannot pick another.
 *
 * So: the first PAIR of custom dimensions that leaves at least one group with delivery and
 * CM360 impressions over the whole flight (`buildMembership`'s own scope rule, read the same
 * full-flight way), else the first single one that does, else none: every row, a grand total
 * per day, the Compare view with no breakdown. `width` is the cap: 2, or `maxSelected` below
 * it. A default that compares anything today is the same pair or dimension here, so only a
 * default that compared nothing moves. A mapping that bridges nothing at all (an empty CM360
 * side, or no dimension classifying both) keeps the author's order: no pick could compare
 * anything there, and the state ladder answers instead of the numbers.
 *
 * Kept with the dataset, because the projection, the focus generation and the chips each ask.
 */
const COMPARABLE_DEFAULTS = new WeakMap();

export function comparableDefaultDimIds(dataset, width = DEFAULT_SELECTED_DIMS) {
  if (!dataset || typeof dataset !== 'object') return [];
  const n = Math.max(0, Math.min(DEFAULT_SELECTED_DIMS, width == null ? DEFAULT_SELECTED_DIMS : width));
  let byWidth = COMPARABLE_DEFAULTS.get(dataset);
  if (!byWidth) { byWidth = new Map(); COMPARABLE_DEFAULTS.set(dataset, byWidth); }
  if (!byWidth.has(n)) byWidth.set(n, Object.freeze(comparableDefault(dataset, n)));
  return byWidth.get(n);
}

function comparableDefault(ds, n) {
  if (n === 0) return [];
  const classified = ds.classified || {};
  const deliveryCells = classified.deliveryCells || {};
  const cm360Cells = classified.cm360Cells || {};
  const perDimList = classified.perDim || [];
  const bridges = typeof ds.anyBridge === 'boolean'
    ? ds.anyBridge : perDimList.some((p) => p.dCount > 0 && p.cCount > 0);
  if (!bridges) return (ds.dims || []).filter((d) => d && !d.auto_kind).slice(0, n).map((d) => d.id);
  // Both sides must carry a dimension for it to compare anything; the pair test below would
  // find that too, and this skips the rows for the common case.
  const perDim = new Map(perDimList.map((p) => [p.dimId, p]));
  const candidates = (ds.dims || []).filter((d) => {
    if (!d || d.auto_kind) return false;
    const p = perDim.get(d.id);
    return !p || (p.dCount > 0 && p.cCount > 0);
  });
  if (!candidates.length) return [];
  // Impressions per classified row over the WHOLE flight: the scope is full-flight, so the
  // default does not move with the dashboard's window.
  const flight = (rows) => {
    const out = new Map();
    for (const r of rows || []) {
      if (!r || r.key == null) continue;
      out.set(r.key, (out.get(r.key) || 0) + (Number(r.impressions) || 0));
    }
    return out;
  };
  const delivery = flight(ds.deliveryDaily);
  const cm360 = flight(ds.cm360Daily);
  const groups = (byKey, cells, dims) => {
    const out = new Map();
    for (const [key, impressions] of byKey) {
      const vals = [];
      for (const dim of dims) {
        const v = resolveDimValue(dim, { key }, cells);
        if (v == null) { vals.length = 0; break; }
        vals.push(v);
      }
      if (vals.length !== dims.length) continue;
      const t = tupleKeyOf(vals);
      out.set(t, (out.get(t) || 0) + impressions);
    }
    return out;
  };
  const compares = (dims) => {
    const d = groups(delivery, deliveryCells, dims);
    for (const [t, impressions] of groups(cm360, cm360Cells, dims)) {
      if (impressions > 0 && (d.get(t) || 0) > 0) return true;
    }
    return false;
  };
  if (n >= 2) {
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (compares([candidates[i], candidates[j]])) return [candidates[i].id, candidates[j].id];
      }
    }
  }
  for (const d of candidates) if (compares([d])) return [d.id];
  return [];
}

// pivotCompare's own date guard (`assertIsoDate`) is the only throw the chain
// expects: a non-ISO date in either daily series, or a reversed range. Anything
// else reaching the catch is a defect, and says so instead of blaming the data.
const ISO_FAULT = [
  { re: /non-ISO date/, code: 'nonIsoDate' },
  { re: /range\.from must be on or before range\.to/, code: 'rangeReversed' },
];

/** A caught projection throw, typed for the state resolver (§8.5's `projectionError`). */
export function projectionErrorOf(err) {
  if (!err) return null;
  const message = err && err.message != null ? String(err.message) : String(err);
  for (const fault of ISO_FAULT) {
    if (fault.re.test(message)) return { kind: 'invalidDate', code: fault.code, message };
  }
  return { kind: 'modelError', code: 'unexpected', message };
}

/** Rows in visible order: active metric's Delivery desc, then CM360 desc, then label. */
export function sortComparisonRows(rows, metric) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const av = a.delivery?.[metric] ?? 0;
    const bv = b.delivery?.[metric] ?? 0;
    if (bv !== av) return bv - av;
    const ac = a.cm360?.[metric] ?? 0;
    const bc = b.cm360?.[metric] ?? 0;
    if (bc !== ac) return bc - ac;
    return tupleLabel(a.key) < tupleLabel(b.key) ? -1 : 1;
  });
}

/** Contributing rows inside one group, active metric descending (CompareTable.jsx:68-69). */
export function sortComparisonMembers(list, metric) {
  return [...(list || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
}

/**
 * projectCm360Comparison(dataset, {selectedDimIds, maxSelected, metric, focusedKey, range})
 *   → { asked, selectedDims, defaultDimIds, selectionRepaired,
 *       pivot, projectionError, membership, chartDaily,
 *       scopeCounts, sortedRows, visibleRowOrder, sectionOrder, memberOrder }
 *
 * `range` cuts VALUES only: classification and tuple scope stay full-flight, so a
 * known overlap tuple keeps its scope when CM360 lags inside a short window
 * (pivotCompare's `mode` is therefore always 'flight' — spec §8.3).
 *
 * `asked` ECHOES the three viewer inputs that decide what `chartDaily` is a series
 * OF and which population it covers, AFTER defaults. Without it a caller holding
 * this result cannot tell whether the array is impressions or clicks, nor which
 * window and focus it was cut to — and a second reader (the v2 Δ%/cm slots, T9)
 * that had to be told separately could be told WRONG and would serve one field's
 * numbers under another field's header, silently. Echoing removes the second
 * channel: there is one object, and it carries its own question with its answer.
 * `selectedDims` already echoes the fourth input, which is why it is not repeated.
 */
export function projectCm360Comparison(dataset, {
  selectedDimIds = null, maxSelected = null,
  metric = 'impressions', focusedKey = null, range = null,
} = {}) {
  const ds = dataset || {};
  const classified = ds.classified || {};
  const deliveryDaily = ds.deliveryDaily || [];
  const cm360Daily = ds.cm360Daily || [];
  const deliveryCells = classified.deliveryCells || {};
  const cm360Cells = classified.cm360Cells || {};

  const selection = selectComparisonDims(ds.dims, { selectedDimIds, maxSelected, dataset: ds });
  const selectedDims = selection.dims;

  // One global effective window drives table, expansion and chart values.
  let pivot;
  let projectionError = null;
  try {
    pivot = pivotCompare({
      deliveryDaily,
      cm360Daily,
      deliveryCells,
      cm360Cells,
      dims: selectedDims,
      mode: 'flight',
      range,
    });
  } catch (e) {
    pivot = { error: e, rows: [], unmapped: null, lastCommonDay: null };
    projectionError = projectionErrorOf(e);
  }

  const membership = buildMembership({
    deliveryDaily,
    deliveryCells,
    cm360Daily,
    cm360Cells,
    dims: selectedDims,
    deliveryRows: ds.activeDeliveryRows || [],
    cm360Groups: ds.activeCm360Rows || [],
    range,
  });

  // The chart follows the table's scope: no dims → grand totals; a breakdown →
  // overlap tuples only; a focused row → that one tuple.
  const chartDaily = buildComparisonDaily({
    deliveryDaily,
    deliveryCells,
    cm360Daily,
    cm360Cells,
    dims: selectedDims,
    membership,
    focusedKey,
    metric,
    range,
  });

  let overlap = 0;
  let deliveryOnly = 0;
  let cm360Only = 0;
  for (const r of pivot.rows) {
    if (r.scope === 'delivery_only') deliveryOnly++;
    else if (r.scope === 'cm360_only') cm360Only++;
    else overlap++;
  }

  const sortedRows = sortComparisonRows(pivot.rows, metric);
  const visibleRowOrder = {
    overlap: sortedRows.filter((r) => r.scope !== 'delivery_only' && r.scope !== 'cm360_only').map((r) => r.key),
    deliveryOnly: sortedRows.filter((r) => r.scope === 'delivery_only').map((r) => r.key),
    cm360Only: sortedRows.filter((r) => r.scope === 'cm360_only').map((r) => r.key),
  };

  // Same keys and same iteration order as `membership` (the Unmapped bucket's
  // key is a Symbol) — only the two contributor lists are re-ordered.
  const memberOrder = new Map();
  for (const [key, group] of membership.entries()) {
    memberOrder.set(key, {
      delivery: sortComparisonMembers(group.delivery, metric),
      cm360: sortComparisonMembers(group.cm360, metric),
    });
  }

  return {
    // Frozen: it is a statement about what was asked, and a caller editing it would be
    // editing the label on numbers that are already computed.
    asked: Object.freeze({ metric, focusedKey, range }),
    selectedDims,
    defaultDimIds: selection.defaultIds,
    selectionRepaired: selection.repaired,
    pivot,
    projectionError,
    membership,
    chartDaily,
    scopeCounts: { overlap, deliveryOnly, cm360Only },
    sortedRows,
    visibleRowOrder,
    sectionOrder: COMPARE_SECTION_ORDER,
    memberOrder,
  };
}
