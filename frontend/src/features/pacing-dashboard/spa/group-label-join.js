// workspace/src/lib/mapping/group-label-join.js
//
// CM360 beside a dimension that has value groups (spec 2026-10-02, kept outside git).
//
// A widget row of a dimension joins CM360 by its label: the comparison's pivot names a tuple
// of the mapping's one selected dimension, and a row whose value is that name takes the
// tuple's pair (report-render.js `atLabel`). A value group renames rows PER LINE: on a line
// that groups TX and FL as South, its TX delivery is in the row South, while another line's
// TX stays in the row TX. The pivot, built from the rows as delivered, would hand all TX CM360
// to the row TX and none to South.
//
// So the pivot is built again with every row read through its own line's dictionary, the
// way the store reads delivery:
//   · a delivery row belongs to one line (its sub-row key carries it) and takes that line's
//     name for its value;
//   · a CM360 row belongs to the lines the line join gives it (line-join.js `linesFor`: the
//     lines that delivered its mapping group that month, then that day); a row classified in
//     every join dimension that no line delivered is another pacing's and keeps its value;
//     a row the line join cannot read (not classified in some join dimension) belongs to the
//     lines that delivered its value that month and day. It
//     takes the name its lines AGREE on — usually there is one line, or none of them groups
//     the value. Where they do not agree, the row cannot honestly go to either name and is set
//     aside into the table's «Other CM360» row, by the rule the line join keeps for a line:
//       · two or more of them delivered on its day and read the value differently: SHARED,
//         and the rows it could belong to print a dash with the reason (their own CM360 goes
//         to «Other CM360» too);
//       · none of them delivered on its day (a late day, a time-zone shift): it is set aside
//         as CM360 ON A DAY NO LINE DELIVERED, and no row prints a dash for it.
// Nothing changes where no row was renamed: the caller then reads the plain pivot.
//
// Pure apart from the shared pivot kernel; `nameOf(li, value)` comes from the caller, so this
// file needs no store and no pacing-core.

import MappingDims from '@shared/mapping-dims';
import { buildLineJoin, LINE_METRICS } from './line-join.js';
import { tupleLabel } from './compare-project.js';

const { pivotCompare } = MappingDims;

// The tuple a shared CM360 row is parked in: no row of any table can be spelled like it.
const SHARED = '\u0000shared\u0000';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const monthOf = (date) => String(date).slice(0, 7);
const inRange = (date, range) => !range || (date >= range.from && date <= range.to);
const hasDelivery = (row) => num(row.impressions) + num(row.clicks) + num(row.completions) > 0;
function zero() { return { impressions: 0, clicks: 0, completions: 0 }; }
function addInto(target, row) {
  target.impressions += num(row.impressions);
  target.clicks += num(row.clicks);
  target.completions += num(row.completions);
}
function bucket(map, key, make) {
  let v = map.get(key);
  if (!v) { v = make(); map.set(key, v); }
  return v;
}

/**
 * buildGroupLabelJoin(dataset, { dims, range, nameOf })
 *   dims    the projection's selected dimensions; only ONE (not Month) gives a row label a
 *           single value to rename, so any other selection answers null
 *   range   the projection's window ({from, to} or null), the pivot's own
 *   nameOf  (liId, value) → the line's group name for the value, or null
 * → null when no row is renamed (read the plain pivot), else
 *   { pairAt(metric, label), reasonAt(label), remainder(labels) }.
 */
export function buildGroupLabelJoin(dataset, { dims, range = null, nameOf } = {}) {
  const ds = dataset || {};
  if (typeof nameOf !== 'function' || !Array.isArray(dims) || dims.length !== 1) return null;
  const d = dims[0];
  if (!d || !d.id || d.auto_kind === 'month') return null;
  const classified = ds.classified || {};
  const dCells = classified.deliveryCells || {};
  const cCells = classified.cm360Cells || {};
  const liOf = new Map((ds.activeDeliveryRows || []).map((r) => [r.key, String(r.liId)]));
  const labelOf = (li, value) => {
    if (li == null) return value;
    const name = nameOf(li, value);
    return name == null ? value : name;
  };
  let renamed = false;

  // ── delivery: each row under its own line's name ──
  const deliveryCells = {};
  for (const key of Object.keys(dCells)) {
    const c = dCells[key];
    const v = c ? c[d.id] : null;
    if (v == null) { deliveryCells[key] = c; continue; }
    const label = labelOf(liOf.get(key), v);
    if (label === v) { deliveryCells[key] = c; continue; }
    deliveryCells[key] = { ...c, [d.id]: label };
    renamed = true;
  }

  // Where the line join cannot place a CM360 row, the lines that delivered its value.
  const valueMonth = new Map();               // value|month → Set(li)
  const valueDay = new Map();                 // value|date  → Set(li)
  for (const row of ds.deliveryDaily || []) {
    const li = liOf.get(row.key);
    const c = dCells[row.key];
    const v = c ? c[d.id] : null;
    if (li == null || v == null || !row.date || !hasDelivery(row)) continue;
    bucket(valueMonth, `${v}|${monthOf(row.date)}`, () => new Set()).add(li);
    bucket(valueDay, `${v}|${row.date}`, () => new Set()).add(li);
  }

  // ── CM360: each row under the name its lines agree on, or set aside as shared ──
  const lineJoin = buildLineJoin(ds);
  const cm360Daily = [];
  const cm360Cells = { ...cCells };
  const shared = new Map();                   // sorted labels → { values, lines, labels, sums }
  const noDay = new Map();                    // sorted labels → { labels, sums }
  const total = zero();
  for (const row of ds.cm360Daily || []) {
    if (row && row.date && inRange(row.date, range)) addInto(total, row);
    const c = row ? cCells[row.key] : null;
    const v = c ? c[d.id] : null;
    if (v == null || !row.date) { cm360Daily.push(row); continue; }
    const placed = lineJoin ? lineJoin.linesFor(row) : { month: null, day: null, classified: false };
    const month = placed.classified ? placed.month : (valueMonth.get(`${v}|${monthOf(row.date)}`) || null);
    const day = placed.classified ? placed.day : (valueDay.get(`${v}|${row.date}`) || null);
    if (!month || !month.size) { cm360Daily.push(row); continue; }
    const labelsOf = (lines) => new Set([...lines].map((li) => labelOf(li, v)));
    let label = null;
    const monthLabels = labelsOf(month);
    if (monthLabels.size === 1) [label] = monthLabels;
    else if (day && day.size) {
      const dayLabels = labelsOf(day);
      if (dayLabels.size === 1) [label] = dayLabels;
    }
    if (label === v) { cm360Daily.push(row); continue; }
    renamed = true;
    const parked = label == null;
    const key = `${row.key}\u0000${parked ? SHARED : ''}${parked ? v : label}`;
    if (!cm360Cells[key]) cm360Cells[key] = { ...c, [d.id]: parked ? SHARED + v : label };
    cm360Daily.push({ ...row, key });
    if (!parked || !inRange(row.date, range)) continue;
    if (!day || !day.size) {
      const labels = [...monthLabels].sort();
      addInto(bucket(noDay, JSON.stringify(labels), () => ({ labels, sums: zero() })).sums, row);
      continue;
    }
    const labels = [...labelsOf(day)].sort();
    const entry = bucket(shared, JSON.stringify(labels), () => ({ values: new Set(), lines: new Set(), labels, sums: zero() }));
    entry.values.add(v);
    for (const li of day) entry.lines.add(li);
    addInto(entry.sums, row);
  }
  if (!renamed) return null;

  let pivot;
  try {
    pivot = pivotCompare({
      deliveryDaily: ds.deliveryDaily || [], cm360Daily, deliveryCells, cm360Cells, dims: [d], mode: 'flight', range,
    });
  } catch {
    return null;                              // the plain pivot answers, as it always has
  }
  const tuples = new Map();
  for (const r of pivot.rows) tuples.set(tupleLabel(r.key), r);

  // A row a shared CM360 row could belong to is incomplete: its CM360 half is not a number.
  const incomplete = new Map();               // label → { values, lines, labels }
  for (const entry of shared.values()) {
    for (const label of entry.labels) {
      const cur = bucket(incomplete, label, () => ({ values: new Set(), lines: new Set(), labels: new Set() }));
      for (const v of entry.values) cur.values.add(v);
      for (const li of entry.lines) cur.lines.add(li);
      for (const l of entry.labels) cur.labels.add(l);
    }
  }

  return {
    pairAt(metric, label) {
      const r = tuples.get(String(label));
      if (!r) return null;
      if (incomplete.has(String(label))) return { delivery: r.delivery[metric], cm360: null, delta: null };
      return { delivery: r.delivery[metric], cm360: r.cm360[metric], delta: r.delta[metric] };
    },
    /** Why a row's CM360 half is a dash, or null. */
    reasonAt(label) {
      const why = incomplete.get(String(label));
      if (!why) return null;
      return {
        kind: 'groupShared',
        values: [...why.values].sort(),
        lines: [...why.lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        labels: [...why.labels].sort(),
      };
    },
    /**
     * What the table's «Other CM360» row holds for the rows it shows (`labels`): the shared
     * CM360 those rows could belong to (`shared`), the CM360 of days none of their lines
     * delivered (`noDay`), and the CM360 of the rows that print a dash (`dashed`). Per metric,
     * in the shape the line grains' remainder has; null when it is 0 throughout.
     */
    remainder(labels) {
      const shown = new Set([...(labels || [])].map(String));
      const out = {};
      let any = false;
      for (const metric of LINE_METRICS) {
        let sharedCm = 0;
        for (const entry of shared.values()) {
          if (entry.labels.some((l) => shown.has(l))) sharedCm += entry.sums[metric];
        }
        let noDayCm = 0;
        for (const entry of noDay.values()) {
          if (entry.labels.some((l) => shown.has(l))) noDayCm += entry.sums[metric];
        }
        let dashedCm = 0;
        for (const label of incomplete.keys()) {
          if (!shown.has(label)) continue;
          const r = tuples.get(label);
          if (r) dashedCm += num(r.cm360[metric]);
        }
        const other = sharedCm + noDayCm + dashedCm;
        if (other > 0) any = true;
        out[metric] = { other: { cm360: other, shared: sharedCm, noDay: noDayCm, offRow: 0, dashed: dashedCm },
          leftOut: { cm360: 0, total: total[metric] } };
      }
      return any ? out : null;
    },
  };
}
