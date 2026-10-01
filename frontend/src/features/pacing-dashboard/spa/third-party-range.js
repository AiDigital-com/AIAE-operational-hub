// Pure range-aware aggregation helpers for Delivery vs CM360.
// Classification is deliberately full-flight; only displayed values are cut to
// the dashboard range. That keeps a known overlap tuple comparable when CM360
// is late inside a short window.

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const UNMAPPED_KEY = Symbol('unmapped');

export function tupleKeyOf(vals) {
  return vals.join('\u0001');
}

export function inDateRange(date, range) {
  return !range || (date >= range.from && date <= range.to);
}

function monthFull(date) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(date == null ? '' : date));
  return m ? MONTHS_FULL[parseInt(m[2], 10) - 1] : null;
}

export function resolveDimValue(dim, row, cells) {
  if (dim.auto_kind === 'month') return monthFull(row.date);
  const c = cells[row.key];
  const v = c ? c[dim.id] : undefined;
  return v == null ? null : v;
}

function tupleValues(row, cells, dims) {
  const vals = [];
  for (const dim of dims) {
    const v = resolveDimValue(dim, row, cells);
    if (v == null) return null;
    vals.push(v);
  }
  return vals;
}

export function buildMembership({
  deliveryDaily = [], deliveryCells = {}, cm360Daily = [], cm360Cells = {},
  dims = [], deliveryRows = [], cm360Groups = [], range = null,
} = {}) {
  const displayByKey = new Map();
  for (const row of deliveryRows) displayByKey.set(row.key, row.display || row.key);
  for (const group of cm360Groups) displayByKey.set(group.key, group.display || group.key);

  // Scope is full-flight and keyed collision-free, independently of the range.
  const scopeImpressions = new Map();
  const scopePass = (rows, cells, side) => {
    for (const row of rows) {
      const vals = tupleValues(row, cells, dims);
      if (vals == null) continue;
      const key = JSON.stringify(vals);
      let entry = scopeImpressions.get(key);
      if (!entry) {
        entry = { delivery: 0, cm360: 0 };
        scopeImpressions.set(key, entry);
      }
      entry[side] += Number(row.impressions) || 0;
    }
  };
  scopePass(deliveryDaily, deliveryCells, 'delivery');
  scopePass(cm360Daily, cm360Cells, 'cm360');

  // Contributor values, unlike scope, describe only the selected time window.
  const groups = new Map();
  const bucketFor = (tupleKey, scopeKey, side, key) => {
    let group = groups.get(tupleKey);
    if (!group) {
      group = { scopeKey, delivery: new Map(), cm360: new Map() };
      groups.set(tupleKey, group);
    }
    let entry = group[side].get(key);
    if (!entry) {
      entry = { key, impressions: 0, clicks: 0, completions: 0 };
      group[side].set(key, entry);
    }
    return entry;
  };
  const ingest = (rows, cells, side) => {
    for (const row of rows) {
      if (!inDateRange(row.date, range)) continue;
      const vals = tupleValues(row, cells, dims);
      const tupleKey = vals == null ? UNMAPPED_KEY : tupleKeyOf(vals);
      const entry = bucketFor(tupleKey, vals == null ? null : JSON.stringify(vals), side, row.key);
      entry.impressions += Number(row.impressions) || 0;
      entry.clicks += Number(row.clicks) || 0;
      entry.completions += Number(row.completions) || 0;
    }
  };
  ingest(deliveryDaily, deliveryCells, 'delivery');
  ingest(cm360Daily, cm360Cells, 'cm360');

  const out = new Map();
  for (const [tupleKey, group] of groups) {
    const totals = group.scopeKey == null
      ? null
      : (scopeImpressions.get(group.scopeKey) || { delivery: 0, cm360: 0 });
    const scope = totals == null ? null
      : totals.delivery > 0 && totals.cm360 > 0 ? 'overlap'
        : totals.delivery > 0 ? 'delivery_only'
          : totals.cm360 > 0 ? 'cm360_only' : 'overlap';
    out.set(tupleKey, {
      delivery: [...group.delivery.values()].map((entry) => ({
        ...entry, display: displayByKey.get(entry.key) || entry.key,
      })),
      cm360: [...group.cm360.values()].map((entry) => ({
        ...entry, display: displayByKey.get(entry.key) || entry.key,
      })),
      scope,
    });
  }
  return out;
}

export function buildComparisonDaily({
  deliveryDaily = [], deliveryCells = {}, cm360Daily = [], cm360Cells = {},
  dims = [], membership = new Map(), focusedKey = null,
  metric = 'impressions', range = null,
} = {}) {
  const hasDims = dims.length > 0;
  const focusId = focusedKey != null ? tupleKeyOf(focusedKey) : null;
  const rowTupleId = (row, cells) => {
    const vals = tupleValues(row, cells, dims);
    return vals == null ? null : tupleKeyOf(vals);
  };
  const includes = (row, cells) => {
    if (!hasDims) return true;
    const tupleKey = rowTupleId(row, cells);
    if (tupleKey == null) return false;
    if (focusId != null) return tupleKey === focusId;
    return membership.get(tupleKey)?.scope === 'overlap';
  };

  const byDate = new Map();
  const bump = (date, field, value) => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { date, delivery: 0, cm360: 0 };
      byDate.set(date, entry);
    }
    entry[field] += Number(value) || 0;
  };
  for (const row of deliveryDaily) {
    if (inDateRange(row.date, range) && includes(row, deliveryCells)) {
      bump(row.date, 'delivery', row[metric]);
    }
  }
  for (const row of cm360Daily) {
    if (inDateRange(row.date, range) && includes(row, cm360Cells)) {
      bump(row.date, 'cm360', row[metric]);
    }
  }
  return [...byDate.values()].sort((a, b) => (
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  ));
}
