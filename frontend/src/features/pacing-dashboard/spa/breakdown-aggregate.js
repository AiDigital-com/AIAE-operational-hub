// workspace/src/lib/dashboard/breakdown-aggregate.js
// Pure aggregation for the Breakdown surfaces (per-LI and campaign mode).
// Extracted from Breakdown.jsx / CampaignBreakdown.jsx so the math is
// host-testable (tests/dashboard/vcr-gating.test.js).
//
// VCR gating (2026-06): every bucket carries imV/coV — impressions/completes
// from VCR-ELIGIBLE LIs only (metrics.js:isVcrEligible — vcrTgt>0 or any
// completes; audio excluded). Row VCR = coV/imV, so display impressions
// delivered to the same dim value don't dilute the video completion rate.
// Campaign-merged day rows carry imV/coV inline; per-LI rows derive them from
// the single LI's eligibility flag.
import { zeroRow, addRow, addFact } from './row-utils.js';
import { OTHER_DIMS } from './breakdown-filter.js';
import { isVcrEligible } from './metrics.js';
import PacingCore from './pacing-core.js';

const zeroBucket = () => ({ ...zeroRow(), imV: 0, coV: 0 });

/**
 * The split keys of the lines in view, as the bare `{ '<dim>:<value>': true }` map
 * detectAvailDims reads.
 *
 * Exists so the panel can answer "which dimensions does this pacing HAVE" from the
 * UNFILTERED aggregate. Which tabs exist is a property of the data; it must not
 * move when a delivery filter is applied. Reading it from the filtered aggregate
 * is what made clicking a row remove the row's own tab: the filter leaves that
 * dimension with exactly one value, and the tab stops qualifying.
 *
 * @param {Object} liSplitDaily  { [liId]: { '<dim>:<value>': { date: row } } }
 * @param {Set<string>|string[]} liIds  lines in view
 */
export function splitKeysFor(liSplitDaily, liIds) {
  const out = {};
  const ids = liIds instanceof Set ? liIds : new Set((liIds || []).map(String));
  for (const id of ids) {
    if (!liSplitDaily || !Object.prototype.hasOwnProperty.call(liSplitDaily, id)) continue;
    for (const k of Object.keys(liSplitDaily[id])) out[k] = true;
  }
  return out;
}

/**
 * Impressions each dimension TAGS, and the total delivered, over the FULL flight
 * of every line in view. Feeds the single-value half of detectAvailDims below.
 *
 * Deliberately takes no date range. Which tabs EXIST must not move when the
 * period picker moves — tabs that appeared and vanished were the original
 * breakdown bug (2026-03-13), and the value-count half has always been read from
 * split KEYS, which the range never removes. The flight clip stays: out-of-flight
 * days are excluded from every other number on the panel, and leaving them in
 * would make a dim that tags everything look partial.
 *
 * Impressions rather than the pacing's rate-native unit: the question here is
 * structural — did this name position tag all the delivery or only part of it —
 * and impressions are the one quantity every delivered row carries. A CPV line's
 * display rows would answer it with zeros.
 *
 * @param {Object} liSplitDaily  { [liId]: { '<dim>:<value>': { date: row } } }
 * @param {Object} liDaily       { [liId]: { date: row } }
 * @param {Set<string>|string[]} liIds  lines in view
 * @param {Object} liPlanMap     { [liId]: { fs, fe } } — flight clip; may be null
 * @returns {{ total: number, byDim: Map<string, number> }}
 */
export function dimTaggedDelivery(liSplitDaily, liDaily, liIds, liPlanMap) {
  const byDim = new Map();
  let total = 0;
  const ids = liIds instanceof Set ? liIds : new Set((liIds || []).map(String));
  const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

  for (const id of ids) {
    const p = own(liPlanMap, id) ? liPlanMap[id] : null;
    const clipped = (d) => !!(p && p.fs && p.fe && (d < p.fs || d > p.fe));

    if (own(liDaily, id)) {
      for (const [d, v] of Object.entries(liDaily[id])) {
        if (clipped(d)) continue;
        total += v.im || 0;
      }
    }

    if (!own(liSplitDaily, id)) continue;
    for (const [sk, dd] of Object.entries(liSplitDaily[id])) {
      const idx = sk.indexOf(':');
      if (idx < 0) continue;
      const val = sk.slice(idx + 1).trim();
      // Same placeholder rule as detectAvailDims: '-' is not a value, so it must
      // not count toward what the dimension tags. Otherwise a dim carrying one
      // real value plus a '-' bucket would add up to the whole line and read as
      // "tags everything" — the exact case this is meant to let through.
      if (!val || val === '-') continue;
      const dim = sk.slice(0, idx);
      // A fact carries at most one value per dim, so the buckets of one dim
      // partition the tagged delivery — summing them cannot double count.
      let sum = 0;
      for (const [d, v] of Object.entries(dd)) {
        if (clipped(d)) continue;
        sum += v.im || 0;
      }
      byDim.set(dim, (byDim.get(dim) || 0) + sum);
    }
  }

  return { total, byDim };
}

/* ── module-level memos for the Breakdown subtree ────────────────────────────
 *
 * Everything below caches a PURE aggregate outside React, the same way
 * selectors.js caches buildChartData and metrics.js caches campM. It is not a
 * micro-optimisation: React discards in-progress hook state when a concurrent
 * render is interrupted, and on the biggest pacing the Breakdown subtree's render
 * body runs ~80 times for ONE commit during the mount cascade — so a `useMemo`
 * over an O(rows × dims) walk is cold every single time. Measured: 640 ms of
 * dimTaggedDelivery and 180 ms of per-date delivery per dashboard open, on top of
 * the 620 ms of mergeSplitAcrossLIs the same restarts caused.
 *
 * Keys are always (facts object, liPlan object) by identity — a new pacing brings
 * new objects and the old entries fall off the WeakMaps — plus a scalar key for
 * everything a filter can move. The one thing that may NOT be a key is a Set or
 * an array minted per render: it would miss on every attempt, which is the whole
 * bug. So the line list arrives as a joined string and any derived set is built
 * INSIDE the memo.
 */
const idsKeyOf = (liIds) => (liIds instanceof Set ? [...liIds] : (liIds || [])).join(',');
const rangeKeyOf = (range) => (range ? `${range.from}:${range.to}` : '__all__');

const NO_PLANS = Object.freeze({});
function nested(cache, facts, liPlanMap) {
  let byPlan = cache.get(facts);
  if (!byPlan) { byPlan = new WeakMap(); cache.set(facts, byPlan); }
  const planKey = liPlanMap || NO_PLANS;
  let byKey = byPlan.get(planKey);
  if (!byKey) { byKey = new Map(); byPlan.set(planKey, byKey); }
  return byKey;
}

/**
 * The inner Map is BOUNDED. The outer WeakMaps free themselves when a pacing is
 * replaced, but the inner key is a filter window, and a merged split map for a
 * 100-line pacing is ~88 000 bucket objects — a user clicking through ten ranges
 * would otherwise pin ten of them for the life of the page. The React memo this
 * replaced held exactly one; a small ring keeps the previous window warm (the
 * common there-and-back click) without ever growing.
 */
function remember(byKey, key, value, limit) {
  byKey.set(key, value);
  while (byKey.size > limit) byKey.delete(byKey.keys().next().value);
  return value;
}

const coverageCache = new WeakMap();   // facts → WeakMap<liPlan, Map<idsKey, result>>

/** dimTaggedDelivery over a whole facts object, memoized. */
export function dimTaggedDeliveryMemo(facts, liIds, liPlanMap) {
  if (!facts) return dimTaggedDelivery(null, null, liIds, liPlanMap);
  const byKey = nested(coverageCache, facts, liPlanMap);
  const key = idsKeyOf(liIds);
  if (byKey.has(key)) return byKey.get(key);
  return remember(byKey, key, dimTaggedDelivery(facts.liSplitDaily, facts.liDaily, liIds, liPlanMap), 4);
}

/**
 * Per-date delivery in the panel's unit for the lines in view — the series a
 * dimension source's coverage is compared against, so it is read from the same
 * facts.liDaily the Total row is built from, under the same flight clamp and the
 * same range. Lifted out of Breakdown.jsx verbatim (it was a useMemo there) so it
 * can be memoized outside React; the VCR gate it needs on the `coV` unit is built
 * here rather than passed in, because a caller-minted Set could not be a cache key.
 */
export function deliveryByDate(facts, liIds, liPlanMap, range, unitKey, srcUnitKey) {
  const out = {};
  const ld = facts?.liDaily;
  if (!ld) return out;
  const plans = liPlanMap || {};
  const gated = srcUnitKey === 'coV';
  const ids = liIds instanceof Set ? liIds : new Set((liIds || []).map(String));
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(ld, id)) continue;
    const p = Object.prototype.hasOwnProperty.call(plans, id) ? plans[id] : null;
    // On the gated unit only the lines the Compl. column is built from count.
    // An ineligible line still MARKS its delivered days — the key is created
    // with a zero — so the shared window is the same one every other unit sees;
    // it simply contributes nothing to the quantity being compared.
    const eligible = !gated || isVcrEligible(liPlanMap?.[id], facts?.liDaily?.[id]);
    for (const [d, v] of Object.entries(ld[id])) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      const amount = gated ? (eligible ? (v.co || 0) : 0) : (v[unitKey] || 0);
      out[d] = (out[d] || 0) + amount;
    }
  }
  return out;
}

const deliveryCache = new WeakMap();   // facts → WeakMap<liPlan, Map<key, result>>

export function deliveryByDateMemo(facts, liIds, liPlanMap, range, unitKey, srcUnitKey) {
  if (!facts) return deliveryByDate(facts, liIds, liPlanMap, range, unitKey, srcUnitKey);
  const byKey = nested(deliveryCache, facts, liPlanMap);
  const key = `${idsKeyOf(liIds)}|${rangeKeyOf(range)}|${unitKey}|${srcUnitKey}`;
  if (byKey.has(key)) return byKey.get(key);
  return remember(byKey, key, deliveryByDate(facts, liIds, liPlanMap, range, unitKey, srcUnitKey), 8);
}

/**
 * Which dimensions earn a tab.
 *
 * Audience: ≥1 value, unchanged. Every other dim: ≥2 values, OR exactly one that
 * does NOT tag all the delivery — a single value on part of it splits delivery in
 * two (the value + the 'Others' remainder the table already computes), which is a
 * breakdown; a single value on ALL of it draws a one-slice donut, which is not.
 * That second case is `platform` and `tactic` on nearly every pacing, and it is
 * what the older "≥2 values" rule was right to refuse — while wrongly refusing a
 * namebuilder position that tags a quarter of a line (Family RV: message=Whitelist
 * on 24.8% of a Video line, offered by the filter bar and the widgets but by no
 * tab). See tests/dashboard/breakdown-avail.test.js for the history.
 *
 * `coverage` is dimTaggedDelivery's result. Omitting it keeps the pre-2026-08
 * behaviour exactly — a single value never earns a tab — so a call site that does
 * not have the aggregates cannot accidentally widen anything.
 *
 * The rule is strictly additive: nothing that was available before can stop being
 * available (pinned by the last block of the test).
 */
export function detectAvailDims(splitData, coverage) {
  // Per-position model: split keys are `<dim>:<value>` where dim is one of
  // audience or the 7 namebuilder positions. Aggregate distinct values per dim.
  const avail = new Set();
  const dimVals = { audience: new Set(), tactic: new Set(), platform: new Set() };
  OTHER_DIMS.forEach((d) => { dimVals[d] = new Set(); });

  for (const sk of Object.keys(splitData)) {
    const idx = sk.indexOf(':');
    if (idx < 0) continue;
    const dim = sk.slice(0, idx);
    const val = sk.slice(idx + 1).trim();
    // '-' is a delivered placeholder ("no value"), not a real dimension value —
    // don't let it make a dim look available (it folds into Unclassified below).
    if (!val || val === '-') continue;
    if (dimVals[dim]) dimVals[dim].add(val);
  }

  // The one value tags some delivery, but not all of it.
  const total = Number(coverage?.total) || 0;
  const partial = (dim) => {
    if (!(total > 0) || !coverage?.byDim) return false;
    const tagged = coverage.byDim.get(dim) || 0;
    return tagged > 0 && tagged < total;
  };
  const earnsTab = (dim) => {
    const n = dimVals[dim].size;
    return n >= 2 || (n === 1 && partial(dim));
  };

  if (dimVals.audience.size >= 1) avail.add('audience');
  ['tactic', 'platform'].forEach((dim) => { if (earnsTab(dim)) avail.add(dim); });
  OTHER_DIMS.forEach((dim) => { if (earnsTab(dim)) avail.add(dim); });

  return avail;
}

export function aggregateDim(splitData, liPlan, dim, range, liEligible = false) {
  const dimMap = {};
  const prefix = dim + ':';
  for (const [sk, dd] of Object.entries(splitData)) {
    if (!sk.startsWith(prefix)) continue;
    const rawVal = sk.slice(prefix.length).trim();
    const key = (!rawVal || rawVal === '-') ? '__unclassified__' : rawVal;
    if (!dimMap[key]) dimMap[key] = zeroBucket();

    for (const [d, v] of Object.entries(dd)) {
      if (liPlan && liPlan.fs && liPlan.fe && (d < liPlan.fs || d > liPlan.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      addRow(dimMap[key], v);
      // addRow covers the 14 zeroRow fields only (the registry's delivery keys); carry the gated pair —
      // merged campaign rows bring their own imV/coV, per-LI rows derive.
      dimMap[key].imV += v.imV !== undefined ? v.imV : (liEligible ? (v.im || 0) : 0);
      dimMap[key].coV += v.coV !== undefined ? v.coV : (liEligible ? (v.co || 0) : 0);
    }
  }
  return dimMap;
}

/**
 * Subtotal of the delivery that sits OUTSIDE this line item's dim splits on one
 * dim (spec 2026-08-14-container-dim-scope §4.1). Walks the same per-value daily
 * aggregate as aggregateDim, but decides per DAY: the declared set follows the
 * containers covering that date, so a value declared for July and absent in
 * August is outside in August only.
 *
 * Returns null when the LI has no covering container — there is nothing to be
 * outside of, and the caller must not render the row at all.
 */
export function aggregateOutside(splitData, liPlan, dim, range, liEligible = false) {
  const idx = PacingCore.buildDimScopeIndex(liPlan);
  if (!idx.any) return null;
  const bucket = zeroBucket();
  const prefix = dim + ':';
  let hit = false;
  const probe = { date: '', [dim]: '' };
  for (const [sk, dd] of Object.entries(splitData)) {
    if (!sk.startsWith(prefix)) continue;
    const rawVal = sk.slice(prefix.length).trim();
    if (!rawVal || rawVal === '-') continue;          // untagged is never outside
    probe[dim] = rawVal;
    for (const [d, v] of Object.entries(dd)) {
      if (liPlan && liPlan.fs && liPlan.fe && (d < liPlan.fs || d > liPlan.fe)) continue;
      if (range && (d < range.from || d > range.to)) continue;
      probe.date = d;
      if (!PacingCore.factOutsideSplits(idx, dim, probe)) continue;
      addRow(bucket, v);
      bucket.imV += v.imV !== undefined ? v.imV : (liEligible ? (v.im || 0) : 0);
      bucket.coV += v.coV !== undefined ? v.coV : (liEligible ? (v.co || 0) : 0);
      hit = true;
    }
  }
  return hit ? bucket : null;
}

// `kByLi` ({ [liId]: k } or undefined): the per-LI net ratio, applied to dc after the
// currency rate exactly as the fact builders do — this file reads the DSP's own
// creative rows, which have been through neither.
export function aggregateCreativeAsset(creatives, liIdSet, liPlanForFlight, range, eligibleSet, rate, kByLi) {
  const byKey = {};
  if (!Array.isArray(creatives) || liIdSet.size === 0) return byKey;
  for (const row of creatives) {
    const lid = String(row.line_item_id);
    if (!liIdSet.has(lid)) continue;

    if (liPlanForFlight) {
      const p = liPlanForFlight[lid];
      if (p && p.fs && p.fe && (row.date < p.fs || row.date > p.fe)) continue;
    }
    if (range && (row.date < range.from || row.date > range.to)) continue;

    // Key by the human-readable creative NAME — the existing dim-rendering
    // pipeline uses Object.keys(dimMap) as donut/table labels. Falling back
    // to creative_id only when name is empty preserves Search / DOOH rows
    // that DSP exposes without a creative name. Trade-off: two DSP creatives
    // with literally the same `creative` string will collapse into one bucket;
    // that matches what an operator visually expects ("show me totals by
    // creative I see in the DSP UI").
    const name = (row.creative && String(row.creative).trim()) || '';
    const key = name || row.creative_id || '__unclassified__';

    if (!byKey[key]) byKey[key] = zeroBucket();
    // canonical mapper; dc -> USD via rate (Slice 6/C4), then -> net via k
    addFact(byKey[key], row, rate, undefined, kByLi ? kByLi[lid] : undefined);
    if (eligibleSet && eligibleSet.has(lid)) {
      byKey[key].imV += Number(row.impressions) || 0;
      byKey[key].coV += Number(row.completes) || 0;
    }
  }
  return byKey;
}

export function aggregateConversion(conversions, liIdSet, liPlanForFlight, range) {
  const byKey = {};
  if (!Array.isArray(conversions) || liIdSet.size === 0) return byKey;
  for (const row of conversions) {
    const lid = String(row.line_item_id);
    if (!liIdSet.has(lid)) continue;
    if (liPlanForFlight) {
      const p = liPlanForFlight[lid];
      if (p && p.fs && p.fe && (row.date < p.fs || row.date > p.fe)) continue;
    }
    if (range && (row.date < range.from || row.date > range.to)) continue;
    const action = (row.conversion_action && String(row.conversion_action).trim()) || '';
    const key = action || '__unclassified__';
    if (!byKey[key]) byKey[key] = zeroBucket();
    const r = byKey[key];
    r.cv += +row.conversions || 0;
    r.pc += +row.post_click_conversions || 0;
    r.pv += +row.post_view_conversions || 0;
  }
  return byKey;
}

export function mergeSplitAcrossLIs(facts, effLIs, liPlan, effRange, eligibleSet) {
  if (!facts?.liSplitDaily || !effLIs?.length) {
    return { mergedSplit: {}, totalIm: 0, totals: { im: 0, cl: 0, co: 0 } };
  }

  const merged = {};
  // LI totals per unit type — the Breakdown "Others" remainder is computed in
  // the campaign's primary (rate-native) unit, so all three are carried.
  const totals = { im: 0, cl: 0, co: 0 };
  let tIm = 0;

  for (const id of effLIs) {
    const sd = facts.liSplitDaily[id];
    if (!sd) continue;
    const p = liPlan?.[id];
    const elig = !!(eligibleSet && eligibleSet.has(id));

    for (const [sk, dd] of Object.entries(sd)) {
      if (!merged[sk]) merged[sk] = {};
      for (const [date, v] of Object.entries(dd)) {
        if (p && p.fs && p.fe && (date < p.fs || date > p.fe)) continue;
        if (effRange && (date < effRange.from || date > effRange.to)) continue;
        if (!merged[sk][date]) merged[sk][date] = zeroBucket();
        addRow(merged[sk][date], v);
        if (elig) {
          merged[sk][date].imV += v.im || 0;
          merged[sk][date].coV += v.co || 0;
        }
      }
    }

    // Total impressions across all LIs (kept: only LIs WITH split data count,
    // matching the original CampaignBreakdown behavior).
    const ld = facts.liDaily?.[id];
    if (ld) {
      for (const [date, v] of Object.entries(ld)) {
        if (p && p.fs && p.fe && (date < p.fs || date > p.fe)) continue;
        if (effRange && (date < effRange.from || date > effRange.to)) continue;
        tIm += v.im || 0;
        totals.im += v.im || 0;
        totals.cl += v.cl || 0;
        totals.co += v.co || 0;
      }
    }
  }

  return { mergedSplit: merged, totalIm: tIm, totals };
}

/**
 * The campaign-mode merge, memoized OUTSIDE React — same shape and same reason as
 * `buildChartData`'s cache in selectors.js.
 *
 * A `useMemo` cannot hold this. React discards in-progress hook state when a
 * concurrent render is interrupted, so during the mount cascade of a big pacing
 * CampaignBreakdown's memo was cold on every one of ~78 render attempts (one
 * commit) and the full merge ran 55 times — 5.0 M addRow and 933 k zeroBucket per
 * dashboard open, 57 % of all its JS. A module-level cache survives a discarded
 * render; the caller's memo now costs a Map lookup when it misses.
 *
 * `eligibleSet` is computed HERE rather than taken as an argument: it is a pure
 * function of (facts, effLIs, liPlan), so a caller-built Set would be a fifth key
 * that says nothing the other four do not — and, being minted per render attempt,
 * would have missed the cache every time.
 */
const mergeCache = new WeakMap();     // facts → WeakMap<liPlan, Map<key, result>>

export function mergeSplitAcrossLIsMemo(facts, effLIs, liPlan, effRange) {
  const eligible = () => {
    const set = new Set();
    for (const id of (effLIs || [])) {
      if (isVcrEligible(liPlan?.[id], facts?.liDaily?.[id])) set.add(id);
    }
    return set;
  };
  if (!facts) return mergeSplitAcrossLIs(facts, effLIs, liPlan, effRange, eligible());
  const byKey = nested(mergeCache, facts, liPlan);
  const key = `${rangeKeyOf(effRange)}|${idsKeyOf(effLIs)}`;
  if (byKey.has(key)) return byKey.get(key);
  // Two: the window you are on and the one you came back from.
  return remember(byKey, key, mergeSplitAcrossLIs(facts, effLIs, liPlan, effRange, eligible()), 2);
}
