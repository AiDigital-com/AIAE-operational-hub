// Pure helpers for the coefficient-cost save-time facts rebuild (spec §3.4).
// No imports — host-testable under plain node.

export function anyCoef(liPlan) {
  return Object.values(liPlan || {}).some((p) => p && p.coef === true);
}

// Per-id fingerprint of everything the per-row resolver reads. Sorted UNION of
// ids by construction (JSON of sorted entries): deleting an LI changes the
// string, so removal of the last coef-LI registers as a change (round-5 S1).
export function coefFingerprint(liPlan) {
  const ids = Object.keys(liPlan || {}).sort();
  return JSON.stringify(ids.map((id) => {
    const p = liPlan[id] || {};
    return [id, p.coef === true, p.mTgt ?? null, p.containers || []];
  }));
}

// Same sorted-union shape, for the per-LI net ratio (net cost mode, spec
// 2026-09-07 §3). `k` scales dc on EVERY non-coef LI, so — unlike the coef
// fingerprint — a change here needs no coef anywhere to matter: it stands on
// its own in the gate below.
//
// Only line items that actually CARRY a ratio are listed: at k = 1 (or absent)
// the net multiplier is the identity, so adding or removing such a line item
// changes no number and must not cost a facts rebuild. A pacing that never used
// net cost mode fingerprints as the empty list, exactly as it did before the
// mode existed.
export function netFingerprint(liPlan) {
  const ids = Object.keys(liPlan || {}).sort();
  const out = [];
  for (const id of ids) {
    const k = (liPlan[id] && liPlan[id].k) ?? 1;
    if (k !== 1) out.push([id, k]);
  }
  return JSON.stringify(out);
}

// Primary conversions (spec docs/2026-09-13-primary-conversions.md §3, "Live update
// after save"). Same sorted-union shape. Every line item is listed while the switch
// is operative: a conversion-data flip on a line item with no choice changes its
// revenue group, so it is a change too. Names are trimmed and sorted, so the order a
// list was ticked in is not a change, and a null list reads as the empty one. Not
// operative → the empty string, so a pacing that never used the switch never rebuilds.
export function primaryCvFingerprint(liPlan, operative) {
  if (operative !== true) return '';
  const ids = Object.keys(liPlan || {}).sort();
  return JSON.stringify(ids.map((id) => {
    const p = liPlan[id] || {};
    const names = Array.isArray(p.primaryCv)
      ? p.primaryCv.filter((n) => typeof n === 'string').map((n) => n.trim()).filter(Boolean).sort()
      : [];
    return [id, p.conversionData === true, names];
  }));
}

// Value groups (spec 2026-10-02, kept outside git): the dictionary decides which value a row
// carries, so a change rebuilds the facts from the regrouped rows. Lines without groups are
// not listed: a pacing that never used them fingerprints as '' and never rebuilds.
export function dimGroupsFingerprint(liPlan) {
  const out = [];
  for (const id of Object.keys(liPlan || {}).sort()) {
    const g = liPlan[id] && liPlan[id].dimGroups;
    if (Array.isArray(g) && g.length) out.push([id, g]);
  }
  return out.length ? JSON.stringify(out) : '';
}

// Gate (spec §3.4): (coefOrMarginChanged && (hadAnyCoef || hasAnyCoef))
//                   || (rateChanged && hasAnyCoef)
//                   || netRatioChanged
//                   || primaryCvChanged
//                   || dimGroupsChanged
// `oldOn` / `newOn` are the published primary_cv_operative flag before and after the
// save. A flip either way rebuilds; operative on both sides compares the per-line-item
// fingerprint; off on both sides compares '' with '' and never rebuilds.
export function shouldRebuildFacts(oldLP, newLP, oldRate, newRate, oldOn = false, newOn = false) {
  const had = anyCoef(oldLP);
  const has = anyCoef(newLP);
  const marginChanged = coefFingerprint(oldLP) !== coefFingerprint(newLP);
  const rateChanged = (oldRate ?? 1) !== (newRate ?? 1);
  const netChanged = netFingerprint(oldLP) !== netFingerprint(newLP);
  const cvChanged = (oldOn === true) !== (newOn === true)
    || primaryCvFingerprint(oldLP, oldOn === true) !== primaryCvFingerprint(newLP, newOn === true);
  const groupsChanged = dimGroupsFingerprint(oldLP) !== dimGroupsFingerprint(newLP);
  return (marginChanged && (had || has)) || (rateChanged && has) || netChanged || cvChanged || groupsChanged;
}

// Does any LI in the plan bill the client net of a ratio? (net cost mode, spec
// 2026-09-07 §7.) `k` is the per-LI net ratio: 1 is the identity — the client's
// figure IS the gross one — and `0 < k < 1` is a net LI. Anything outside that
// band (missing, 0, ≥ 1) is not a ratio and reads as plain.
export function anyNet(liPlan) {
  return Object.values(liPlan || {}).some((p) => p && p.k > 0 && p.k < 1);
}

// The basis a money label states (net cost mode, spec §7). A client figure that
// draws the pair leads with gross and says net underneath, and margin is computed
// from net — in CAD the currency symbol tells the two apart, but in gross/net
// both are dollars, so the WORD has to. `netMode` is the CALLER's answer to "is
// this figure's basis worth naming": a label says what ITS OWN number is, so a
// lone figure with no twin beside it passes falsy and keeps its plain caption
// (fix round 1 — see `showsGrossPair`, dual-money.js). Off a net pacing the label
// is returned untouched, byte for byte; an empty label stays empty rather than
// becoming a bare « (gross)».
//
// Three kinds, one rule — the caption names its own number's basis:
//   'client'  the figure IS gross (it leads a drawn gross/net pair) → « (gross)»
//   'margin'  margin is computed from net → « (net)»
//   'net'     a CLIENT-money figure printed net with no gross twin beside it —
//             the standard Finance widget's statRow / kvRow cells and a client
//             moneyStat whose pair is not drawn → « (net)». Without it those
//             cells sit unlabelled next to «(gross)» ones and read as gross.
export function basisLabel(label, kind, netMode) {
  if (!netMode || !label) return label;
  return (kind === 'margin' || kind === 'net') ? `${label} (net)` : `${label} (gross)`;
}

// The client-money bindings (net cost mode, spec §7). Every one of these prints a
// number the client is billed for, which on a net pacing is the NET figure — so its
// caption has to say so. `sp` and the DSP-side rates are deliberately absent: media
// money is what the line item cost to BUY and has no client basis; so do units,
// percentages and every plan-side count.
export const CLIENT_MONEY_KEYS = new Set([
  'budget', 'budgetTotal', 'budgetToDate', 'dc', 'clientPr', 'budPr',
  'dynCpm', 'dynCpc', 'dynCpv', 'dynCpa',
  'clientPlanCpm', 'clientPlanCpc', 'clientPlanCpv',
]);

// The margin bindings (net cost mode, spec §7). `mA` is the achieved margin, `mTgt` the
// plan's target it is measured against, and both are computed FROM net wherever a ratio
// exists — so a caption naming either says «(net)».
export const MARGIN_KEYS = new Set(['mA', 'mTgt']);

// The canonical READINGS with a basis (net cost mode, spec §7; fix round 1, findings 1–2).
//
// This is a SECOND vocabulary, not more of the first. A binding names either a delivery
// field (`bind.expr` — the formula fields above) or a campaign reading (`bind.metric`, and
// a report's `kind: 'canonical'`): the widget metric catalogue's presets and canon metrics,
// resolved by brick-data's CANON table and `readingFor`. The same word can be two numbers
// across that line — `budget` as a FIELD is the client's budget in money, `budget` as a
// READING is spend-to-date as a percent of expected media cost — so one table over both
// namespaces would print « (net)» under a percentage of media spend.
//
// `margin` and `marginbar` are both `cm.mA`, computed FROM net. The client plan rates and
// the dynamic client CPM are client money printed net with no gross twin beside them. Every
// other reading — `budget`, `pacing`, `spend`, `cpm`, the delivery and needed-per-day ones —
// is media-side, a count or a percentage, and has no client basis to state.
export const READING_BASIS = new Map([
  ['margin', 'margin'], ['marginbar', 'margin'],
  ['clientPlanCpm', 'net'], ['clientPlanCpc', 'net'], ['clientPlanCpv', 'net'],
  ['dynCpm', 'net'],
]);

// The name a basis key goes by where the delivery-field catalogue has none. `mA` is campM's
// achieved margin — «Margin» on every surface that draws it — and `FIELD_LABELS`
// (metric-catalog.js) names only the stored formula fields. It lives beside the tables it
// names for rather than inline at one call site, so a second caption path gets the same word.
export const BASIS_NAMES = new Map([['mA', 'Margin']]);

// THE rule for a DELIVERY FIELD (spec §7: a label says what its own number is) — the
// vocabulary of `bind.expr` and of a report's `kind: 'metric'` / bare-field formula.
//
//   'net'     client money, printed net with no gross twin beside it
//   'margin'  a margin, computed from net
//   null      no client basis to state at all: media money, units, percentages, plan
//             counts. This is the answer that keeps a plain pacing byte-identical, and
//             it is also what `dc`'s and the dynamic rates' own callers override — those
//             two draw the gross figure and say so through `coefLabels`.
export function basisForKey(key) {
  if (CLIENT_MONEY_KEYS.has(key)) return 'net';
  if (MARGIN_KEYS.has(key)) return 'margin';
  return null;
}

// The same question asked of a canonical READING key, off the table above. Map lookups, so
// a key out of stored config reaches no answer through the prototype chain.
export function basisForReading(key) {
  return READING_BASIS.get(key) ?? null;
}

// …and asked of a brick binding, which carries one namespace or the other. `metric` WINS
// where both are present: brick-data resolves it first, so the metric is the number on
// screen and the expr never runs — answering off the expr there would caption a reading
// with a field's basis. Only an EXACT key counts either way: a formula that merely mentions
// `dc` ("dc - sp") is a different number, and guessing at its basis would put the wrong
// word under it.
export function basisForBind(bind) {
  if (!bind) return null;
  if (bind.metric != null) return basisForReading(bind.metric);
  return basisForKey(bind.expr);
}

// Task 12 — coef-gated relabels (spec §8). When any LI in the plan runs the
// coefficient-cost model, dc-based numbers are the client's REAL cost, not a
// dynamic estimate, so the UI swaps to client-facing wording. Zero-coef
// pacings render the legacy strings byte-identical (no visible change).
//
// `netMode` is the second, independent axis (spec 2026-09-07 §7, amended in fix
// round 1), and a label says what ITS OWN number is:
//   `dcCol`  names a COLUMN of dc — the daily table's dc cells and a report's `dc`
//            value are both already net (the ratio is applied at aggregation), and
//            no gross twin is drawn beside them, so the header says « (net)».
//   `dyn()`  names a dynamic rate ROW, which leads with the client's gross rate and
//            carries net underneath (brick-data.js `series === 'dynamic'`), so it
//            says « (gross)».
//   `cpmCol` takes no suffix either way — it is the DSP's own buying rate, which has
//            no client basis to state.
// The one-argument call shape is unchanged: `netMode` defaults falsy.
export function coefLabels(coefMode, netMode) {
  return {
    dcCol: (coefMode ? 'Client Cost' : 'Dynamic Cost') + (netMode ? ' (net)' : ''),
    cpmCol: coefMode ? 'DSP CPM' : 'CPM',
    dyn: (unit) => (coefMode ? `Client ${unit}` : `Dyn ${unit}`) + (netMode ? ' (gross)' : ''),
  };
}
