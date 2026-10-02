// currency-marker.js — the campaign-level "Converted" badge for the dashboard
// header. budget figures are already USD (converted in dash-gate, see ns-master-map);
// this surfaces the contract currency + rate so the user can verify against the
// CAD/etc. insertion order. Pure, no React.

const SYMBOL = { USD: "$", CAD: "CA$", AUD: "A$", GBP: "£", EUR: "€" };

// Short rate for display: N SIGNIFICANT figures, trailing zeros trimmed. Significant
// (not decimal) so a small rate keeps its value — 0.0067 stays "0.0067", not "0.007".
// e.g. fmtRate(0.717313803269516, 3) -> "0.717".
function fmtRate(rate, sig) {
  const n = Number(rate);
  if (!isFinite(n)) return String(rate);
  return String(parseFloat(n.toPrecision(sig)));
}

// The converted, non-USD line-item plans from an array or a {id: plan} map.
function convertedNonUsd(plans) {
  const list = Array.isArray(plans) ? plans : Object.values(plans || {});
  return list.filter((p) => p && p.converted && p.currency && p.currency !== "USD");
}

/**
 * Campaign-level "Converted" badge label for the dashboard header. Derives the
 * distinct non-USD contract currencies across the line-item plans (each plan
 * carries `converted` + `currency` from merge.buildPlanByLineItem). The dashboard
 * budget figures are USD; this badge flags that they were currency-converted.
 * Pure, no React.
 *
 * Shows the rate inline ("Converted · CAD @ 0.717") when the campaign has a single
 * non-USD currency at a single rate; otherwise just the currency list. Pair with
 * campaignCurrencyTitle for the hover detail.
 *
 * @param {Array|Object} plans  liPlan as an array or a {id: plan} map; each entry
 *                              carries { converted, currency, exchange_rate }.
 * @returns {string|null}  e.g. "Converted · CAD @ 0.717" / "Converted · AUD, CAD".
 */
export function campaignCurrencyLabel(plans, rate) {
  const conv = convertedNonUsd(plans);
  const currencies = Array.from(new Set(conv.map((p) => p.currency))).sort();
  if (!currencies.length) return null;
  if (currencies.length === 1) {
    // The authoritative campaign rate (option B) wins — it is what the user edits
    // and what the dashboard computes in. Fall back to the per-LI exchange_rate
    // only for legacy callers that pass no campaign rate.
    let r = (rate != null && isFinite(Number(rate))) ? Number(rate) : null;
    if (r == null) {
      const rates = Array.from(new Set(
        conv.filter((p) => p.currency === currencies[0] && p.exchange_rate != null).map((p) => p.exchange_rate),
      ));
      if (rates.length === 1) r = rates[0];
    }
    if (r != null) return "Converted · " + currencies[0] + " @ " + fmtRate(r, 3);
  }
  return "Converted · " + currencies.join(", ");
}

/**
 * Hover detail for the dashboard "Converted" badge: per-currency contract total
 * (sum of native_budget) @ rate (when that currency has a single rate). Pure.
 * @param {Array|Object} plans  liPlan array or {id: plan} map.
 * @returns {string|null}  e.g. "CA$16,000 contract @ 0.717313803269516" (FULL rate —
 *                         the hover detail is the precise figure), or null when none converted.
 */
export function campaignCurrencyTitle(plans, rate) {
  const conv = convertedNonUsd(plans);
  if (!conv.length) return null;
  const byCur = {};
  for (const p of conv) {
    const c = p.currency;
    if (!byCur[c]) byCur[c] = { native: 0, rates: new Set() };
    if (p.native_budget != null) byCur[c].native += Number(p.native_budget) || 0;
    if (p.exchange_rate != null) byCur[c].rates.add(p.exchange_rate);
  }
  const campRate = (rate != null && isFinite(Number(rate))) ? Number(rate) : null;
  return Object.keys(byCur).sort().map((c) => {
    const g = byCur[c];
    let s = (SYMBOL[c] || c + " ") + g.native.toLocaleString("en-US") + " contract";
    // Authoritative campaign rate (full precision) when supplied; else the per-LI rate.
    if (campRate != null) s += " @ " + String(campRate);
    else if (g.rates.size === 1) s += " @ " + String(Array.from(g.rates)[0]);
    return s;
  }).join(" · ");
}

/* ── net-cost mode ──────────────────────────────────────────────────────────
 * A net line item invoices client cost on a NET share of the plan: `k` is that
 * share (0 < k < 1), and a plain line item carries k = 1 (identity). `k` rides
 * on the plan entry from merge.buildPlanByLineItem, so the same plans passed to
 * campaignCurrencyLabel feed the "Net basis" badge below.
 */

/**
 * The net share as a display percent: up to two decimals, trailing zeros
 * trimmed — 0.8 -> "80%", 0.7692 -> "76.92%". Pure.
 *
 * A non-number answers the empty string rather than "NaN%": both call sites gate
 * on a real ratio today, but this string goes straight into a badge and a pill,
 * and "NaN%" on a line item card is worse than no percent at all.
 * @param {number} k  net share (0 < k < 1).
 * @returns {string}
 */
export function netPct(k) {
  const n = Number(k);
  if (!Number.isFinite(n)) return "";
  return String(parseFloat((n * 100).toFixed(2))) + "%";
}

// Net line items grouped by share -> count. Identity (k = 1) and anything
// outside (0, 1) is not a net basis, so it never reaches the badge.
function netGroups(plans) {
  const list = Array.isArray(plans) ? plans : Object.values(plans || {});
  const by = new Map();
  for (const p of list) {
    const k = p ? Number(p.k) : NaN;
    if (k > 0 && k < 1) by.set(k, (by.get(k) || 0) + 1);
  }
  return by;
}

/**
 * Campaign-level "Net basis" badge label for the dashboard header — the net
 * counterpart of campaignCurrencyLabel, sitting beside it in the same row.
 * One share across the net line items shows it inline; several shares collapse
 * to "mixed" (the per-share breakdown is the hover, netBasisTitle). Pure.
 *
 * @param {Array|Object} plans  liPlan as an array or a {id: plan} map.
 * @returns {string|null}  e.g. "Net basis · 80%" / "Net basis · mixed", or null
 *                         when no line item is on a net basis.
 */
export function netBasisLabel(plans) {
  const by = netGroups(plans);
  if (!by.size) return null;
  return "Net basis · " + (by.size === 1 ? netPct([...by.keys()][0]) : "mixed");
}

/**
 * Hover detail for the "Net basis" badge: how many line items sit on each net
 * share, commonest first (ties by the larger share). Pure.
 * @param {Array|Object} plans  liPlan array or {id: plan} map.
 * @returns {string|null}  e.g. "80%: 2 line items · 76.92%: 1 line item".
 */
export function netBasisTitle(plans) {
  const by = netGroups(plans);
  if (!by.size) return null;
  return [...by.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([k, n]) => `${netPct(k)}: ${n} line item${n === 1 ? "" : "s"}`).join(" · ");
}
