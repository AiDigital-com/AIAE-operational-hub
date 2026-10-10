// workspace/src/lib/mapping/line-join.js
//
// Which CM360 belongs to which line item (docs/2026-09-29-cm360-by-line.md §2). The CM360
// export carries no line item, so the link is the mapping's own groups: every classified
// delivery row belongs to one line (`activeDeliveryRows[].liId`), every classified CM360 row
// to one group, and a group with one line hands that line its CM360.
//
//   · Join dimensions: the mapping's dimensions that classify at least one row on EACH side
//     (`classified.perDim`), Month excluded. A dimension one side never gets cannot tell
//     CM360 rows apart by line, and keeping it would leave every CM360 row unclassified.
//   · A group is the join dimensions' values plus the calendar month of the row's date. Its
//     lines are the lines that delivered on its rows.
//       one line   → every CM360 row of the group is that line's, late days included;
//       several    → split by day: a day exactly one of them delivered is that line's, any
//                    other day's CM360 is shared;
//       no line    → left out (another pacing's placements in the same CM360 campaign).
//     An unclassified CM360 row is left out too.
//   · A line prints a dash only where its own delivery sits on a SHARED day that carries
//     CM360: a shared group with nothing reported that day splits 0, and 0 is honest.
//
// Pure: no React, no store, no @shared import, so host tests load it directly. Everything is
// built in one pass over each daily series, lazily, once per dataset (a WeakMap, the way
// `cmReaderFor` keeps its readers).

export const LINE_METRICS = Object.freeze(['impressions', 'clicks', 'completions']);

const JOINS = new WeakMap();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const monthOf = (date) => String(date).slice(0, 7);
const inRange = (date, range) => !range || (date >= range.from && date <= range.to);

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
function deltaRatio(cm360, delivery) {
  if (!Number.isFinite(cm360) || !Number.isFinite(delivery) || delivery === 0) return null;
  return (cm360 - delivery) / delivery;
}

/** The dimensions a line join groups by (§2.1). Exported for the tests and the spec's note. */
export function lineJoinDims(dataset) {
  const ds = dataset || {};
  const perDim = new Map(((ds.classified && ds.classified.perDim) || []).map((p) => [p.dimId, p]));
  return (ds.dims || []).filter((d) => {
    if (!d || d.auto_kind === 'month') return false;
    const p = perDim.get(d.id);
    return !!p && p.dCount > 0 && p.cCount > 0;
  });
}

function build(dataset) {
  const ds = dataset || {};
  const classified = ds.classified || {};
  const dCells = classified.deliveryCells || {};
  const cCells = classified.cm360Cells || {};
  const dims = lineJoinDims(ds);
  // One JSON array per tuple: a value may contain any character, so no separator is safe.
  const tupleOf = (cells, key) => {
    const c = cells[key] || {};
    const vals = [];
    for (const d of dims) {
      const v = c[d.id];
      if (v == null) return null;
      vals.push(String(v));
    }
    return JSON.stringify(vals);
  };
  const liOf = new Map((ds.activeDeliveryRows || []).map((r) => [r.key, String(r.liId)]));

  // ── delivery: which lines stand in which group, per month and per day ──
  const delivered = new Set();                // lines with any delivery at all
  const classifiedLines = new Set();          // …of it classified in every join dimension
  const lineDays = new Map();                 // li → date → classified delivery
  const monthLines = new Map();               // tuple|month → Set(li)
  const dayLines = new Map();                 // tuple|date  → Set(li)
  const lineMonths = new Map();               // li → Set(tuple|month)
  for (const row of ds.deliveryDaily || []) {
    const li = liOf.get(row.key);
    if (!li || !row.date) continue;
    const hasDelivery = num(row.impressions) + num(row.clicks) + num(row.completions) > 0;
    if (hasDelivery) delivered.add(li);
    const t = tupleOf(dCells, row.key);
    if (t == null) continue;
    addInto(bucket(bucket(lineDays, li, () => new Map()), row.date, zero), row);
    if (!hasDelivery) continue;
    classifiedLines.add(li);
    const mKey = `${t}|${monthOf(row.date)}`;
    bucket(monthLines, mKey, () => new Set()).add(li);
    bucket(dayLines, `${t}|${row.date}`, () => new Set()).add(li);
    bucket(lineMonths, li, () => new Set()).add(mKey);
  }

  // ── CM360: each row to one line, to a shared day, or out ──
  const own = new Map();                      // li → date → CM360
  const shared = new Map();                   // tuple|date → { date, lines, dayLines, sums }
  const outside = new Map();                  // date → CM360 no line of this pacing holds
  const total = new Map();                    // date → every CM360 row
  const monthsWithCm = new Set();             // tuple|month that received any CM360 row
  for (const row of ds.cm360Daily || []) {
    if (!row.date) continue;
    addInto(bucket(total, row.date, zero), row);
    const t = tupleOf(cCells, row.key);
    const mKey = t == null ? null : `${t}|${monthOf(row.date)}`;
    const lines = mKey ? monthLines.get(mKey) : null;
    if (!lines) { addInto(bucket(outside, row.date, zero), row); continue; }
    monthsWithCm.add(mKey);
    let li = null;
    const dKey = `${t}|${row.date}`;
    const onDay = dayLines.get(dKey) || null;
    if (lines.size === 1) [li] = lines;
    else if (onDay && onDay.size === 1) [li] = onDay;
    if (li) { addInto(bucket(bucket(own, li, () => new Map()), row.date, zero), row); continue; }
    const s = bucket(shared, dKey, () => ({ date: row.date, lines, dayLines: onDay, sums: zero() }));
    addInto(s.sums, row);
  }

  // A line is dashed on a day only where its own delivery sits on a shared day WITH CM360.
  const sharedOn = new Map();                 // li → date → Set(other lines that day)
  for (const s of shared.values()) {
    if (!s.dayLines || s.dayLines.size < 2) continue;
    for (const li of s.dayLines) {
      const others = bucket(bucket(sharedOn, li, () => new Map()), s.date, () => new Set());
      for (const o of s.dayLines) if (o !== li) others.add(o);
    }
  }

  const statusOf = (li) => {
    if (!delivered.has(li)) return 'noDelivery';
    if (!classifiedLines.has(li)) return 'unmapped';
    const months = lineMonths.get(li);
    if (!months || ![...months].some((m) => monthsWithCm.has(m))) return 'noPlacement';
    return null;
  };
  const daySum = (days, metric, range) => {
    if (!days) return 0;
    let s = 0;
    for (const [date, v] of days) if (inRange(date, range)) s += v[metric];
    return s;
  };
  const sharedWith = (li, range) => {
    const days = sharedOn.get(li);
    if (!days) return null;
    const out = new Set();
    for (const [date, others] of days) if (inRange(date, range)) for (const o of others) out.add(o);
    return out.size ? out : null;
  };

  /** A line over a window: its pair, and the reason when its CM360 half is not a number. */
  const lineAt = (metric, liId, range) => {
    const li = String(liId);
    const status = statusOf(li);
    if (status) return { pair: null, reason: { kind: status } };
    const delivery = daySum(lineDays.get(li), metric, range);
    const others = sharedWith(li, range);
    if (others) return { pair: { delivery, cm360: null, delta: null }, reason: { kind: 'shared', with: [...others], day: false } };
    const cm360 = daySum(own.get(li), metric, range);
    return { pair: { delivery, cm360, delta: deltaRatio(cm360, delivery) }, reason: null };
  };

  /** One line on one day (a Date × line item row). */
  const dayAt = (metric, date, liId) => {
    const li = String(liId);
    const status = statusOf(li);
    if (status) return { pair: null, reason: { kind: status } };
    const d = lineDays.get(li)?.get(date);
    const delivery = d ? d[metric] : 0;
    const others = sharedOn.get(li)?.get(date);
    if (others) return { pair: { delivery, cm360: null, delta: null }, reason: { kind: 'shared', with: [...others], day: true } };
    const c = own.get(li)?.get(date);
    const cm360 = c ? c[metric] : 0;
    return { pair: { delivery, cm360, delta: deltaRatio(cm360, delivery) }, reason: null };
  };

  /**
   * What a table of these rows cannot put on a row (§2.5), per metric: `other` is the one
   * «Other CM360» row — CM360 shared by lines the table holds, CM360 of a line the table prints
   * a dash for, and (Date × line item) CM360 of a line on a day it has no row — and `leftOut`
   * is everything else in the window: another pacing's placements, unclassified rows, and the
   * CM360 of lines the table does not hold.
   */
  const remainder = (range, grain, rowKeys) => {
    const keys = [...(rowKeys || [])].map(String);
    const lines = new Set(grain === 'dateLi' ? keys.map((k) => k.slice(k.indexOf('|') + 1)) : keys);
    const rowDays = grain === 'dateLi' ? new Set(keys) : null;
    const dashed = grain === 'dateLi' ? new Set() : new Set([...lines].filter((li) => sharedWith(li, range)));
    const out = {};
    for (const metric of LINE_METRICS) {
      const all = daySum(total, metric, range);
      let sharedCm = 0;
      for (const s of shared.values()) {
        if (!inRange(s.date, range)) continue;
        if ([...s.lines].every((li) => lines.has(li))) sharedCm += s.sums[metric];
      }
      let dashedCm = 0;
      let offRow = 0;
      let shown = 0;
      for (const li of lines) {
        const days = own.get(li);
        if (!days) continue;
        for (const [date, v] of days) {
          if (!inRange(date, range)) continue;
          if (dashed.has(li)) dashedCm += v[metric];
          else if (rowDays && !rowDays.has(`${date}|${li}`)) offRow += v[metric];
          else shown += v[metric];
        }
      }
      const other = sharedCm + dashedCm + offRow;
      out[metric] = {
        other: { cm360: other, shared: sharedCm + dashedCm, offRow },
        leftOut: { cm360: Math.max(0, all - shown - other), total: all },
      };
    }
    return out;
  };

  /**
   * The lines one CM360 daily row can belong to, by the same groups as everything above:
   * `month` the lines that delivered its group that month, `day` the ones that delivered it on
   * its day (null where none did). `classified` says whether the row has a value in every
   * join dimension: when it does and no line delivered its group, it is another pacing's
   * placement (left out above), not a row the join could not read (value groups, spec
   * 2026-10-02, read a row's label through these lines).
   */
  const linesFor = (row) => {
    const t = row ? tupleOf(cCells, row.key) : null;
    if (t == null || !row.date) return { month: null, day: null, classified: false };
    return {
      month: monthLines.get(`${t}|${monthOf(row.date)}`) || null,
      day: dayLines.get(`${t}|${row.date}`) || null,
      classified: true,
    };
  };

  return { joinDimIds: dims.map((d) => d.id), lineAt, dayAt, remainder, linesFor };
}

/** The line join for one comparison dataset, built on first use and kept with the dataset. */
export function buildLineJoin(dataset) {
  if (!dataset || typeof dataset !== 'object') return null;
  let join = JOINS.get(dataset);
  if (!join) { join = build(dataset); JOINS.set(dataset, join); }
  return join;
}
