// workspace/src/lib/dashboard/containers.js
import { rangeOverlap } from './date-utils.js';
import { zeroRow } from './row-utils.js';
import { splitStateOf } from './primary-cv.js';

/**
 * Pairs of containers whose date ranges overlap.
 * Container overlap is legal (spec §I4), surfaced as informational warning.
 */
export function detectContainerOverlaps(plan) {
  const cs = (plan.containers || [])
    .map((c, idx) => ({ idx, name: c.name, fs: c.fs, fe: c.fe, ti: Number(c.target_impressions) || 0 }))
    .filter((c) => c.fs && c.fe);

  const overlaps = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const ov = rangeOverlap(cs[i].fs, cs[i].fe, cs[j].fs, cs[j].fe);
      if (ov) overlaps.push({ a: cs[i], b: cs[j], start: ov.start, end: ov.end });
    }
  }
  return overlaps;
}

/**
 * Pairs of date_children inside one container whose dates overlap.
 * Date-child overlap is legal (spec §I5), surfaced as informational warning.
 */
export function detectDateChildOverlaps(container) {
  const ds = (container.date_children || [])
    .map((dc, idx) => ({ idx, name: dc.name, fs: dc.fs, fe: dc.fe, ti: Number(dc.target_impressions) || 0 }))
    .filter((d) => d.fs && d.fe);

  const overlaps = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const ov = rangeOverlap(ds[i].fs, ds[i].fe, ds[j].fs, ds[j].fe);
      if (ov) overlaps.push({ a: ds[i], b: ds[j], start: ov.start, end: ov.end });
    }
  }
  return overlaps;
}

/**
 * Sum actual impressions/clicks/spend for one date_child across its window,
 * clipped by container.fs..fe and the optional filter `range`.
 * When sibling date_children overlap on a day, allocates the day's actuals
 * proportionally to each child's target_impressions (matches the old
 * sumTemporalSplit ratio fallback).
 */
export function sumDateChild(liId, dateChild, container, range, liDaily) {
  const dd = liDaily[liId] || {};
  const fs = dateChild.fs, fe = dateChild.fe;
  const act = zeroRow();
  const siblings = (container.date_children || [])
    .map((dc) => ({ fs: dc.fs, fe: dc.fe, ti: Number(dc.target_impressions) || 0 }))
    .filter((d) => d.fs && d.fe);

  for (const [d, v] of Object.entries(dd)) {
    if (d < fs || d > fe) continue;
    if (container.fs && container.fe && (d < container.fs || d > container.fe)) continue;
    if (range && (d < range.from || d > range.to)) continue;

    let ratio = 1;
    const covering = siblings.filter((m) => d >= m.fs && d <= m.fe);
    if (covering.length > 1) {
      const totalTi = covering.reduce((s, m) => s + m.ti, 0);
      const thisTi = Number(dateChild.target_impressions) || 0;
      ratio = totalTi > 0 ? thisTi / totalTi : 1 / covering.length;
    }

    act.im += v.im * ratio;
    act.cl += v.cl * ratio;
    act.sp += v.sp * ratio;
    act.co += v.co * ratio;
    act.cv += (v.cv || 0) * ratio;
    act.dc += v.dc * ratio;
  }
  return act;
}

/**
 * Sum actual impressions/clicks/spend for one dim_child across the container's
 * window. Source is the workspace per-LI split-daily aggregate already keyed
 * by `<dim_key>:<dim_value>` (built by normalize.js:buildFactsAggregates).
 * Primary conversions (spec 2026-09-13 §4): when this line item is marked on this dimension (its
 * conversions cannot be placed there) and delivers into this child inside the summed dates, `cv`
 * is null, the number no dimension row may print. A child it never delivered into, or whose
 * dates hold none of its delivery, reads 0 as its delivery does (owner decision 2026-09-23): no
 * conversion can belong there. The same rule dimBuckets applies to a table's buckets.
 */
export function sumDimChild(liId, dimChild, container, range, liSplitDaily) {
  const key = dimChild.dim_key + ':' + dimChild.dim_value;
  const dd = (liSplitDaily[liId] || {})[key] || {};
  const act = zeroRow();
  const marked = splitStateOf(liSplitDaily)?.[liId]?.[dimChild.dim_key]?.cv === true;
  let delivered = false;
  for (const [d, v] of Object.entries(dd)) {
    if (container.fs && container.fe && (d < container.fs || d > container.fe)) continue;
    if (range && (d < range.from || d > range.to)) continue;
    act.im += v.im;
    act.cl += v.cl;
    act.sp += v.sp;
    act.co += v.co;
    act.cv += v.cv || 0;
    act.dc += v.dc;
    if (marked && !delivered && dayHasDelivery(v)) delivered = true;
  }
  if (delivered) act.cv = null;
  return act;
}

// A day row that carries delivery. A row with none cannot put a line item's conversions in a
// child (widget-data.js dayHasDelivery, the same test for a table's buckets).
function dayHasDelivery(v) {
  return !!v && ((Number(v.im) || 0) > 0 || (Number(v.cl) || 0) > 0 || (Number(v.co) || 0) > 0
    || (Number(v.sp) || 0) > 0 || (Number(v.dc) || 0) > 0);
}
