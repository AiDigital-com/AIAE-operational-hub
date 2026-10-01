// workspace/src/lib/dashboard/normalize.js
import { sid } from './format.js';
import { zeroRow, addFact } from './row-utils.js';
import PacingCore from './pacing-core.js';
import { makeCvCtx, overlayLiDaily, overlayLiSplitDaily, purityIndex } from './primary-cv.js';

// { [id]: marginIndex } for coef-LIs only; {} when none (identity path). A missing
// entry ⇒ addFact takes the raw currencyToUsd(dynamic_cost, rate) branch unchanged.
function buildCoefIndexMap(planMap) {
  const out = {};
  for (const [id, p] of Object.entries(planMap || {})) {
    if (p && p.coef === true) out[id] = PacingCore.buildMarginIndex(p);
  }
  return out;
}

// Net cost mode: k = net/gross for one LI; 1 = identity (absent / null / out of range).
export function netK(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 1;
}

// Primary conversions (spec 2026-09-13 §2): a published name list, copied so the store
// never shares an array with the parsed blob. Anything that is not a list reads as absent.
function cvNames(v) {
  return Array.isArray(v) ? v.filter((name) => typeof name === 'string') : null;
}

// The LI's net ratio as addFact wants it: undefined when the plan has no entry,
// so a missing LI stays on the identity path instead of inventing a ratio.
const kOf = (planMap, id) => (planMap && planMap[id] ? planMap[id].k : undefined);

// Aggregates each impression independently across 8 namebuilder dimensions
// (audience + 7 per-position carve-outs) plus 2 first-class BQ fields
// (tactic, platform). Each LSD bucket key is `<dim_key>:<value>`. The 8
// namebuilder dims align with dim_child.dim_key (see PacingTab.jsx:18
// DIM_KEYS — container-level dim_children eligible). tactic + platform
// are Breakdown-only reporting axes; deliberately NOT in DIM_KEYS.
export const DIM_FIELDS = ['audience', 'tactic', 'platform', 'comment', 'geo', 'creative', 'message', 'keyword', 'flight', 'language'];

// Per-LI-per-day aggregate (LD) + asOf. Cheap, and the only fact aggregate the
// first-paint surfaces (KPIs, charts, alerts, LI cards) read. Split out from the
// per-dimension LSD build so the heavy carve-out runs only when a breakdown
// surface actually needs it (see dashboardStore.load lazy getter).
//
// `cvCtx` / `scope` (primary conversions, spec 2026-09-13 §3): with no context, or a
// context whose switch is not operative, the result is exactly today's. Otherwise the
// overlay rewrites cv / pc / pv of line items with a choice and registers the state
// readers consult on the returned LD. `scope` is null for an unfiltered build.
export function buildLiDaily(factsDaily, rate, planMap, cvCtx = null, scope = null) {
  const LD = {};
  const rows = Array.isArray(factsDaily) ? factsDaily : [];
  const coefIdx = buildCoefIndexMap(planMap);

  rows.forEach((f) => {
    const id = sid(f.line_item_id);
    if (!LD[id]) LD[id] = {};
    if (!LD[id][f.date]) LD[id][f.date] = zeroRow();
    addFact(LD[id][f.date], f, rate, coefIdx[id], kOf(planMap, id));
  });

  const asOf = rows.length
    ? rows.reduce((mx, f) => (f.date > mx ? f.date : mx), rows[0].date)
    : null;

  if (cvCtx && cvCtx.operative === true) overlayLiDaily(LD, asOf, planMap, cvCtx, scope);

  return { LD, asOf };
}

// Per-LI per-`<dim>:<value>` per-day aggregate (LSD). O(rows × DIM_FIELDS) plus
// one zeroRow allocation per distinct bucket — the dominant cost of the old
// combined builder. Only the Breakdown WIDGET (useAutoInventory → selectAvailDims) and
// SplitRow consume it, so it is materialized lazily on first access rather than on every
// dashboard load. `cvCtx` / `scope`: as buildLiDaily.
export function buildLiSplitDaily(factsDaily, rate, planMap, cvCtx = null, scope = null) {
  const LSD = {};
  const rows = Array.isArray(factsDaily) ? factsDaily : [];
  const coefIdx = buildCoefIndexMap(planMap);

  rows.forEach((f) => {
    const id = sid(f.line_item_id);
    const rowIdx = coefIdx[id];
    const rowK = kOf(planMap, id);
    for (const k of DIM_FIELDS) {
      const raw = f[k];
      const v = raw == null ? '' : String(raw).trim();
      if (!v) continue;
      const key = k + ':' + v;
      if (!LSD[id]) LSD[id] = {};
      if (!LSD[id][key]) LSD[id][key] = {};
      if (!LSD[id][key][f.date]) LSD[id][key][f.date] = zeroRow();
      addFact(LSD[id][key][f.date], f, rate, rowIdx, rowK);
    }
  });

  // Primary conversions (spec §4 "Breakdowns"). Purity is judged over THESE rows: the store's full
  // factsDaily for the lazy getters, the kept rows for buildBreakdownFacts. The local asOf is the
  // one buildLiDaily computes, the fallback cutoff when the context has none.
  if (cvCtx && cvCtx.operative === true) {
    const localAsOf = rows.length
      ? rows.reduce((mx, f) => (f.date > mx ? f.date : mx), rows[0].date)
      : null;
    overlayLiSplitDaily(LSD, planMap, cvCtx, scope, purityIndex(rows), localAsOf);
  }

  return LSD;
}

// Combined LD + LSD + asOf. Retained for the breakdown-filter re-aggregation
// path (which rebuilds both halves over a filtered subset) and the equivalence
// test. Equivalent to building both halves separately.
export function buildFactsAggregates(factsDaily, rate, planMap, cvCtx = null, scope = null) {
  const { LD, asOf } = buildLiDaily(factsDaily, rate, planMap, cvCtx, scope);
  return { LD, LSD: buildLiSplitDaily(factsDaily, rate, planMap, cvCtx, scope), asOf };
}

export function normalize(raw) {
  const n = (c, m) => { if (!c) throw new Error('Bad data: ' + m); };
  n(raw && typeof raw === 'object', 'root');
  n(raw.campaign, 'campaign');
  n(raw.campaign.startDate && raw.campaign.endDate, 'dates');
  n(Array.isArray(raw.factsDaily), 'factsDaily');

  const li2ch = {};
  if (Array.isArray(raw.types)) raw.types.forEach((t) => { li2ch[sid(t.line_item_id)] = t.type; });

  const LP = {};
  if (raw.planByLineItem && typeof raw.planByLineItem === 'object') {
    for (const [rid, p] of Object.entries(raw.planByLineItem)) {
      const id = sid(rid);
      LP[id] = {
        id, ch: p.channel || li2ch[id] || 'Unknown',
        dsp: p.dsp || null, rateType: p.rateType || 'CPM',
        budget: Number(p.clientBudget) || 0,
        planImpr: Number(p.plannedImpressions) || 0,
        mTgt: Number(p.marginTargetPct) || 0,
        coef: p.cost_coef === true,
        // Net cost mode (spec 2026-09-07 §3). `k` is the OPERATIVE ratio the blob
        // already resolved (a value only while the pacing switch is on) and the
        // only one the math reads; `kStored` is the ungated stored ratio the
        // Settings editor binds to, so a ratio stored while the switch was off
        // is still there when it comes back on; `nsK` is the raw NetSuite
        // reading kept for the settings UI, never for the math.
        k: netK(p.netRatio),
        kStored: netK(p.storedNetRatio),
        netLocked: p.netRatioLocked === true,
        nsK: (typeof p.nsNetRatio === 'number') ? p.nsNetRatio : null,
        ctrTgt: p.ctrTargetPct != null ? Number(p.ctrTargetPct) : null,
        vcrTgt: p.vcrTargetPct != null ? Number(p.vcrTargetPct) : null,
        fs: p.flightStart || raw.campaign.startDate,
        fe: p.flightEnd || raw.campaign.endDate,
        containers: Array.isArray(p.containers) ? p.containers : [],
        labels: Array.isArray(p.labels) ? p.labels : [],
        pause_intervals: Array.isArray(p.pauseIntervals) ? p.pauseIntervals : [],
        desc: p.description || null,
        // C3: carry campaign-derived contract-currency info for the "Converted"
        // badge (campaignCurrencyLabel). native_budget is the contract money truth.
        // Safe defaults for USD/legacy LIs. per-LI exchange_rate is no longer
        // stored/surfaced — campaign rate is authoritative.
        converted: !!p.converted,
        currency: p.currency || null,
        native_budget: p.native_budget != null ? Number(p.native_budget) : null,
        // Primary conversions (spec 2026-09-13 §2), the k / kStored pairing again:
        // `primaryCv` is the list the math reads (published only while the pacing switch
        // is on), `primaryCvStored` is what config_json holds and what the Settings editor
        // binds to, `conversionData` says whether this line item's own source fetches
        // conversion rows. Absent keys read as off. normalizePlan below must match, or
        // sharePlanIdentities sees no change after a choice-only save.
        primaryCv: cvNames(p.primaryConversions),
        primaryCvStored: cvNames(p.storedPrimaryConversions) || [],
        conversionData: p.conversionData === true,
      };
    }
  } else if (raw.planByType && typeof raw.planByType === 'object') {
    // M20: Legacy planByType fallback — iterate over channel-level plan entries
    for (const [ch, plan] of Object.entries(raw.planByType)) {
      if (plan.lineItems && plan.lineItems.length) {
        plan.lineItems.forEach((li) => {
          const id = sid(li.line_item_id);
          const nn = plan.lineItems.length;
          LP[id] = {
            id, ch,
            dsp: null, rateType: plan.rateType || 'CPM',
            budget: Number(li.target_spend) || (Number(plan.clientBudget) || 0) / nn,
            planImpr: Number(li.target_impressions) || (Number(plan.plannedImpressions) || 0) / nn,
            mTgt: Number(li.margin_percent) || Number(plan.marginTargetPct) || 0,
            ctrTgt: plan.ctrTargetPct != null ? Number(plan.ctrTargetPct) : null,
            vcrTgt: plan.vcrTargetPct != null ? Number(plan.vcrTargetPct) : null,
            fs: li.flight_start || plan.flightStart || raw.campaign.startDate,
            fe: li.flight_end || plan.flightEnd || raw.campaign.endDate,
            containers: Array.isArray(li.containers) ? li.containers : [],
            labels: [], desc: null,
          };
        });
      } else {
        // No explicit lineItems: derive IDs from types array or use the channel name
        const ids = (Array.isArray(raw.types) ? raw.types : [])
          .filter((t) => t.type === ch)
          .map((t) => sid(t.line_item_id));
        if (!ids.length) ids.push(ch);
        const nn = ids.length;
        ids.forEach((id) => {
          LP[id] = {
            id, ch,
            dsp: null, rateType: plan.rateType || 'CPM',
            budget: (Number(plan.clientBudget) || 0) / nn,
            planImpr: (Number(plan.plannedImpressions) || 0) / nn,
            mTgt: Number(plan.marginTargetPct) || 0,
            ctrTgt: plan.ctrTargetPct != null ? Number(plan.ctrTargetPct) : null,
            vcrTgt: plan.vcrTargetPct != null ? Number(plan.vcrTargetPct) : null,
            fs: plan.flightStart || raw.campaign.startDate,
            fe: plan.flightEnd || raw.campaign.endDate,
            containers: [],
            labels: [], desc: null,
          };
        });
      }
    }
  } else {
    throw new Error('No plan data found');
  }

  // Only LD is built eagerly here; LSD (per-dimension breakdown aggregate) is
  // materialized lazily by the store so it doesn't block first paint. LP is passed
  // so coef-LIs get the per-row dc override on first paint (LP already carries the
  // `coef` flag + mTgt/containers; non-coef LIs take the raw currencyToUsd path).
  // The blob's own `data` and `conversions` decide the primary-conversions overlay. An
  // unfiltered build needs no context asOf: its local asOf is the pacing's.
  const { LD, asOf } = buildLiDaily(raw.factsDaily, raw.campaign && raw.campaign.rate, LP,
    makeCvCtx(raw.data, raw.conversions, null));

  return { LP, LD, asOf };
}

// Normalize a raw planByLineItem API response (as returned by saveSettings)
// into the LP format expected by the store.
// `campaign` must have startDate and endDate.
export function normalizePlan(rawPlanByLineItem, campaign) {
  const LP = {};
  if (!rawPlanByLineItem || typeof rawPlanByLineItem !== 'object') return LP;
  for (const [rid, p] of Object.entries(rawPlanByLineItem)) {
    const id = sid(rid);
    LP[id] = {
      id,
      ch: p.channel || 'Unknown',
      dsp: p.dsp || null,
      rateType: p.rateType || 'CPM',
      budget: Number(p.clientBudget) || 0,
      planImpr: Number(p.plannedImpressions) || 0,
      mTgt: Number(p.marginTargetPct) || 0,
      coef: p.cost_coef === true,
      // Net cost mode — same mapping as normalize() above, so a saved plan
      // rebuilds the facts on the same `k` the first paint used and the drawer
      // re-hydrates on the same `kStored`.
      k: netK(p.netRatio),
      kStored: netK(p.storedNetRatio),
      netLocked: p.netRatioLocked === true,
      nsK: (typeof p.nsNetRatio === 'number') ? p.nsNetRatio : null,
      ctrTgt: p.ctrTargetPct != null ? Number(p.ctrTargetPct) : null,
      vcrTgt: p.vcrTargetPct != null ? Number(p.vcrTargetPct) : null,
      fs: p.flightStart || (campaign && campaign.startDate) || '',
      fe: p.flightEnd || (campaign && campaign.endDate) || '',
      containers: Array.isArray(p.containers) ? p.containers : [],
      labels: Array.isArray(p.labels) ? p.labels : [],
      pause_intervals: Array.isArray(p.pauseIntervals) ? p.pauseIntervals : [],
      desc: p.description || null,
      // C3: carry campaign-derived contract-currency info (see normalize() above).
      converted: !!p.converted,
      currency: p.currency || null,
      native_budget: p.native_budget != null ? Number(p.native_budget) : null,
      // Primary conversions: same mapping and key order as normalize() above.
      primaryCv: cvNames(p.primaryConversions),
      primaryCvStored: cvNames(p.storedPrimaryConversions) || [],
      conversionData: p.conversionData === true,
    };
  }
  return LP;
}
