// workspace/src/lib/dashboard/row-utils.js
import Currency from '@shared/currency';
import PacingCore from '@shared/pacing-core';

export const zeroRow = () => ({
  im: 0, cl: 0, sp: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0,
  st: 0, q1: 0, q2: 0, q3: 0, rc: 0, lc: 0,
});

/** The per-day row's keys, in order. Pinned to the registry by the tests: the row above and the
 *  two adders below are unrolled on purpose — keyed stores in a loop cost 25–40× on this hot
 *  path (measured 2026-09-09: 500k addRow calls, 2.6 ms unrolled vs 107 ms in a loop). */
export const DAY_ROW_KEYS = Object.freeze(Object.keys(zeroRow()));

// `rate` (campaign USD-per-native) converts the client-facing dynamic_cost to USD
// at the EARLIEST aggregation, so every margin/dyn consumer downstream is
// currency-consistent (Slice 6 / C4). rate falsy/1 => identity (USD campaign).
// Only `dc` is converted; all DSP-side + count fields are currency-neutral.
//
// `coefIdx` (optional): a precomputed PacingCore margin index for a coefficient-cost
// LI. When present, `dc` is DERIVED from spend + the row's resolved margin
// (PacingCore.coefDcForRow — spend is already USD, never re-converted) instead of the
// reported dynamic_cost. Absent (undefined) → the EXACT current float path unchanged.
//
// `k` (optional): the LI's net ratio in net cost mode (net / gross). Applied at the
// SAME earliest site as `rate` and in a FIXED order — currency first, then net — so
// every downstream consumer reads net USD. Absent / 1 / out of range ⇒ identity
// (PacingCore.netDc). A coef row never takes it: spend/(1-margin) is already net.
export function addFact(r, f, rate, coefIdx, k) {
  r.im += Number(f.impressions) || 0;
  r.cl += Number(f.clicks) || 0;
  r.sp += Number(f.spend) || 0;
  r.co += Number(f.completes) || 0;
  r.cv += Number(f.conversions) || 0;
  r.pc += Number(f.post_click_conversions) || 0;
  r.pv += Number(f.post_view_conversions) || 0;
  r.dc += coefIdx
    ? PacingCore.coefDcForRow(coefIdx, f)
    : PacingCore.netDc(Currency.currencyToUsd(Number(f.dynamic_cost) || 0, rate), k);
  // The six mart metrics added 2026-09-08 (registry ADDED_DELIVERY_KEYS), sparse on the fact row.
  r.st += Number(f.starts) || 0;
  r.q1 += Number(f.first_quartiles) || 0;
  r.q2 += Number(f.midpoints) || 0;
  r.q3 += Number(f.third_quartiles) || 0;
  r.rc += Number(f.reach) || 0;
  r.lc += Number(f.link_clicks) || 0;
}

export function addRow(t, v) {
  t.im += Number(v.im) || 0;
  t.cl += Number(v.cl) || 0;
  t.sp += Number(v.sp) || 0;
  t.co += Number(v.co) || 0;
  t.cv += Number(v.cv) || 0;
  t.pc += Number(v.pc) || 0;
  t.pv += Number(v.pv) || 0;
  t.dc += Number(v.dc) || 0;
  // …and the same six here.
  t.st += Number(v.st) || 0;
  t.q1 += Number(v.q1) || 0;
  t.q2 += Number(v.q2) || 0;
  t.q3 += Number(v.q3) || 0;
  t.rc += Number(v.rc) || 0;
  t.lc += Number(v.lc) || 0;
}

/**
 * Line items grouped by channel, biggest first, for the Line Items list.
 *
 * The list has only ever been flat with a search box, though every line item
 * carries `ch` (normalize.js:97) and the search has always matched on it. On a
 * pacing with four channels and forty lines, "show me the CTV ones" meant
 * typing and hoping.
 *
 * Groups are ordered by delivered impressions rather than by name, so the
 * channel doing the work is at the top — the same reason every other list in
 * this product ranks rather than alphabetises.
 */
export function groupLineItemsByChannel(ids, liPlan, liDaily) {
  const groups = new Map();
  for (const id of Array.isArray(ids) ? ids : []) {
    const p = (liPlan || {})[id];
    const ch = (p && p.ch) || 'Unknown';
    if (!groups.has(ch)) groups.set(ch, { channel: ch, ids: [], impressions: 0 });
    const g = groups.get(ch);
    g.ids.push(id);
    const days = (liDaily || {})[id] || {};
    for (const d of Object.keys(days)) g.impressions += (days[d] && days[d].im) || 0;
  }
  return [...groups.values()].sort((a, b) => (b.impressions - a.impressions)
    || a.channel.localeCompare(b.channel));
}
