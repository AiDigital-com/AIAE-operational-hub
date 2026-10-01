// workspace/src/lib/dashboard/dim-scope.js
//
// Dim-split Scope engine (workspace-only; calls PacingCore.resolveDimAbs /
// containerSpendEff — NO pacing-core / GAS / n8n sync). A dim VALUE is "Scope"
// iff ≥1 line item carries a matching dim_child target: that target is a real
// plan for the value, so the headline can pace Σ delivered(dim slice) vs
// Σ target(dim split) instead of delivered-slice ÷ planned-whole-LI garbage.
//
// Three pure exports:
//   collectSplitKeys(liPlan)                         → Set<'<dim_key>:<dim_value>'>
//   buildVirtualPlanFromDimChild(plan, child, c)     → leaf virtual plan
//   matchDimSplits(liPlan, brkfPairs, opts)          → { active, dimKey, values,
//                                                        eligibleIds, plans }
//
// The virtual plan mirrors PacingCore.buildVirtualPlanFromContainer's shape so
// downstream getEffPlan / campM / buildChartData treat it identically (leaf:
// containers=[] so there is no nested proration — the dim slice is flat).
//
// Period-scope COMPOSE (Task 7): when matchDimSplits is given a `periodKey`, a
// dim split is resolved WITHIN the active period. A dim split lives inside a
// container (a date window = a period); "geo:TX within period P" = the geo:TX
// dim_child of the container that OWNS period P, scoped to P's window. The
// owning-container resolution mirrors PacingCore.buildScopedPlanForPeriodKey
// (date_child PRIMARY → standalone container SECONDARY), and the dim child's
// target is prorated to the period window by IMPRESSION-share (2026-06-15):
//   date_child period → dateChild.target_impressions / container.target_impressions
//   (day-share fallback only when container.target_impressions ≤ 0);
//   standalone container == the period → factor 1 (exact, no proration).
// Impression-share follows the plan's declared date curve (front/back-loaded),
// which is more faithful than uniform-by-days.
import PacingCore from './pacing-core.js';

/** Absolute impressions target of a dim child (percent → absolute). */
function dimAbs(child, container) {
  return PacingCore.resolveDimAbs(child, container);
}

/**
 * The dim child's share of the container spend, by impressions: explicit
 * child.target_spend wins; else a pro-rata slice of the container's effective
 * spend (PacingCore.containerSpendEff) by the child's impression share of the
 * container. Division by zero → 0 (project canon).
 *
 * NOTE (updated 2026-07-11, F4): dim children can now carry an EXPLICIT
 * target_spend (Settings dim-budget field) — the explicit-wins branch below is
 * the primary path for budgeted splits, and SplitRow shows the same spend
 * target. The impression-share fallback remains for splits without a budget.
 */
function dimChildSpend(plan, child, container) {
  const explicit = child.target_spend != null && child.target_spend !== ''
    ? Number(child.target_spend) : 0;
  if (explicit > 0) return explicit;
  const planImpr = dimAbs(child, container);
  const cti = Number(container.target_impressions) || planImpr;
  if (!(cti > 0)) return 0;
  return PacingCore.containerSpendEff(container, plan) * planImpr / cti;
}

/** Resolve a dim child's effective target margin: child → container → plan.mTgt. */
function dimChildMargin(plan, child, container) {
  if (child.margin_percent != null && child.margin_percent !== '') {
    return Number(child.margin_percent);
  }
  if (container && container.margin_percent != null && container.margin_percent !== '') {
    return Number(container.margin_percent);
  }
  return plan.mTgt;
}

/**
 * Resolve the container that OWNS `periodKey` ('fs|fe') for one LI, plus the
 * period window and the matched date_child (if any). Mirrors
 * PacingCore.buildScopedPlanForPeriodKey's resolution (so dim-scope composes
 * onto the SAME container period-scope uses):
 *   1. a date_child (target_impressions > 0) whose fs|fe === periodKey → its
 *      PARENT container, window = the date_child's [fs, fe], dateChild = the
 *      matched child  (PRIMARY)
 *   2. else a standalone non-full-flight container (no date_children,
 *      target_impressions > 0) whose fs|fe === periodKey, window = container
 *      [fs, fe], dateChild = null  (SECONDARY)
 *   3. else null (the LI does not own this period → not eligible for scope).
 *
 * @param {Object} li         one LI plan
 * @param {string} periodKey  'fs|fe'
 * @returns {{ container:Object, dateChild:(Object|null), periodFs:string, periodFe:string } | null}
 */
export function resolveOwningContainer(li, periodKey) {
  if (!li || !periodKey) return null;
  const idx = periodKey.indexOf('|');
  if (idx < 0) return null;
  const pfs = periodKey.slice(0, idx);
  const pfe = periodKey.slice(idx + 1);
  const containers = Array.isArray(li.containers) ? li.containers : [];
  // PRIMARY: a date_child whose window == the period → its parent container.
  for (const container of containers) {
    const dc = Array.isArray(container.date_children) ? container.date_children : [];
    for (const child of dc) {
      if (!child || !child.fs || !child.fe) continue;
      if (!(Number(child.target_impressions) > 0)) continue;
      if (child.fs === pfs && child.fe === pfe) {
        return { container, dateChild: child, periodFs: child.fs, periodFe: child.fe };
      }
    }
  }
  // SECONDARY: a standalone (childless), non-full-flight container == the period.
  for (const container of containers) {
    if (!container || !container.fs || !container.fe) continue;
    if (!(Number(container.target_impressions) > 0)) continue;
    const hasChildren = Array.isArray(container.date_children) && container.date_children.length > 0;
    if (hasChildren) continue;
    if (container.fs === li.fs && container.fe === li.fe) continue; // full-flight is never a period
    if (container.fs === pfs && container.fe === pfe) {
      return { container, dateChild: null, periodFs: container.fs, periodFe: container.fe };
    }
  }
  return null;
}

/**
 * Proration factor that scales a container-level dim target down to a period
 * window NESTED inside it.
 *
 * Architecture decision (2026-06-15): the date_child-period factor follows the
 * plan's DECLARED date curve via IMPRESSION-share — more faithful than uniform
 * by-days when a flight is front/back-loaded:
 *   - date_child case (dateChild != null):
 *       factor = dateChild.target_impressions / container.target_impressions
 *       (fall back to DAY-share only when container.target_impressions ≤ 0,
 *        per project div-by-zero canon).
 *   - standalone case (dateChild == null, period === container): factor = 1
 *     (exact, no proration).
 */
function periodFactor(container, dateChild, periodFs, periodFe) {
  if (!dateChild) return 1; // standalone container == the period → exact target
  const cti = Number(container.target_impressions) || 0;
  if (cti > 0) {
    return (Number(dateChild.target_impressions) || 0) / cti; // impression-share
  }
  // Fallback (container has no declared impression target): uniform by-days.
  const containerDays = Math.max(1, PacingCore.daysBetween(container.fs, container.fe));
  const periodDays = PacingCore.daysBetween(periodFs, periodFe);
  return periodDays / containerDays;
}

/**
 * Every '<dim_key>:<dim_value>' that has a declared dim split (positive target)
 * across ALL line items. Used to classify a dim value as Scope (≥1 LI has the
 * split) vs Lens.
 * @param {Object} liPlan  map id → LI plan
 * @returns {Set<string>}
 */
export function collectSplitKeys(liPlan) {
  const keys = new Set();
  if (!liPlan) return keys;
  for (const id of Object.keys(liPlan)) {
    const li = liPlan[id];
    if (!li) continue;
    const containers = Array.isArray(li.containers) ? li.containers : [];
    for (const container of containers) {
      const children = Array.isArray(container.dim_children) ? container.dim_children : [];
      for (const child of children) {
        if (!child || child.dim_key == null || child.dim_value == null) continue;
        if (!(dimAbs(child, container) > 0)) continue;
        keys.add(child.dim_key + ':' + child.dim_value);
      }
    }
  }
  return keys;
}

/**
 * The dates a dimension Scope chip judges each line item in (primary conversions, spec
 * 2026-09-13 §4; owner decision 2026-09-16): for a line item with containers declaring one of the
 * chip's values (a dim child with a positive target, as matchDimSplits counts it), the dates of
 * EVERY such container. A list, not mergeDimChildren's first-to-last span, so a value declared in
 * January and March does not take in February. Single-dim chips only, like matchDimSplits: a
 * cross-dim or Outside filter is a Lens and declares nothing. A line item declaring none of the
 * values is absent (judged over all of its rows).
 * @returns {Map<string, Array<{ from: string, to: string }>>}
 */
export function declaringWindows(liPlan, brkfPairs) {
  const out = new Map();
  if (!liPlan || !Array.isArray(brkfPairs) || brkfPairs.length === 0) return out;
  const dims = new Set();
  const values = new Set();
  for (const pair of brkfPairs) {
    const s = String(pair);
    const idx = s.indexOf(':');
    if (idx < 0) continue;
    if (s.slice(idx + 1).startsWith('__outside__')) return out;
    dims.add(s.slice(0, idx));
    values.add(s.slice(idx + 1));
  }
  if (dims.size !== 1) return out;
  const dimKey = [...dims][0];
  for (const id of Object.keys(liPlan)) {
    const containers = liPlan[id] && Array.isArray(liPlan[id].containers) ? liPlan[id].containers : [];
    const list = [];
    for (const container of containers) {
      if (!container || !container.fs || !container.fe) continue;
      const children = Array.isArray(container.dim_children) ? container.dim_children : [];
      if (children.some((child) => child && child.dim_key === dimKey && values.has(child.dim_value)
        && dimAbs(child, container) > 0)) list.push({ from: container.fs, to: container.fe });
    }
    if (list.length) out.set(String(id), list);
  }
  return out;
}

/**
 * Build a leaf virtual plan scoped to ONE dim child. Mirrors
 * PacingCore.buildVirtualPlanFromContainer's key set (so getEffPlan / campM /
 * buildChartData treat it identically), with:
 *   planImpr = resolveDimAbs(child, container) × factor
 *   budget   = (child.target_spend>0 ? target_spend : container-spend share) × factor
 *   fs/fe    = period window if scoped to a period; else container.fs/fe
 *   mTgt     = child.margin_percent ?? container.margin_percent ?? plan.mTgt
 *   containers: []  (leaf — no nested proration)
 *   _scopedFromDim: '<dim_key>:<dim_value>'
 *
 * `period` (optional) = { periodFs, periodFe, factor } when the dim split is
 * resolved WITHIN an active period (Task 7). factor prorates the
 * container-level target to the period window; window = the period. When
 * omitted (no period), this is byte-identical to the pre-Task-7 behaviour
 * (factor 1, window = container).
 */
export function buildVirtualPlanFromDimChild(plan, dimChild, container, period) {
  const factor = period ? period.factor : 1;
  return {
    id: plan.id,
    ch: plan.ch,
    dsp: plan.dsp || null,
    rateType: plan.rateType || 'CPM',
    fs: period ? period.periodFs : container.fs,
    fe: period ? period.periodFe : container.fe,
    budget: dimChildSpend(plan, dimChild, container) * factor,
    planImpr: dimAbs(dimChild, container) * factor,
    mTgt: dimChildMargin(plan, dimChild, container),
    ctrTgt: plan.ctrTgt,
    vcrTgt: plan.vcrTgt,
    period_scope: false,
    // Pauses live on the LI — a dim-scoped view must freeze on the same days
    // the parent LI is paused (mirrors buildVirtualPlanFromContainer).
    pause_intervals: Array.isArray(plan.pause_intervals) ? plan.pause_intervals : [],
    containers: [],
    _scopedFromDim: dimChild.dim_key + ':' + dimChild.dim_value,
  };
}

/**
 * Match the active dim filter against declared dim splits across line items.
 *
 * Single-dim rule: `brkfPairs` ('<dim>:<value>' strings) must span exactly ONE
 * distinct dim. A cross-dim filter (two different dim_keys) is a Lens (handled
 * elsewhere), so it returns inactive.
 *
 * Multi-value within one dim is OR-joined: an LI is eligible if ANY of its
 * dim_children matches dimKey + a selected value. All matching children on the
 * LI are summed into ONE leaf virtual plan (planImpr / budget summed).
 *
 * COMPOSE with period-scope (Task 7) — `opts.periodKey`:
 *   - null / absent: scan dim_children across ALL containers; window = union of
 *     contributing containers (today's behaviour, byte-identical).
 *   - set: for each LI resolve the container that OWNS the period
 *     (resolveOwningContainer); scan dim_children of THAT container ONLY; the
 *     virtual plan's window = the PERIOD window; planImpr/budget = the dim
 *     child's target prorated to the period window. An LI whose owning
 *     container has no matching dim_child (or that does not own the period) is
 *     NOT eligible (cut), consistent with the cut-outside-split rule.
 *
 * @param {Object} liPlan     map id → LI plan
 * @param {string[]} brkfPairs active brkf filter, e.g. ['geo:TX', 'geo:CA']
 * @param {{ periodKey?: (string|null) }} [opts]
 * @returns {{ active:boolean, dimKey:(string|null), values:Set<string>,
 *             eligibleIds:string[], plans:Object }}
 */
export function matchDimSplits(liPlan, brkfPairs, opts) {
  const empty = { active: false, dimKey: null, values: new Set(), eligibleIds: [], plans: {} };
  if (!liPlan || !Array.isArray(brkfPairs) || brkfPairs.length === 0) return empty;

  const periodKey = (opts && opts.periodKey) || null;

  const dims = new Set();
  const values = new Set();
  for (const pair of brkfPairs) {
    const s = String(pair);
    const idx = s.indexOf(':');
    if (idx < 0) continue;
    // `__outside__` is the complement of the declared values — there is no
    // declared plan for it, so it can never be Scope. One such pair demotes the
    // whole filter to Lens; without this, `geo:Kilgore` + `geo:__outside__`
    // would pace Kilgore's target against Kilgore + everything else.
    if (s.slice(idx + 1).startsWith('__outside__')) return empty;
    dims.add(s.slice(0, idx));
    values.add(s.slice(idx + 1));
  }
  // Single-dim only: cross-dim (or no parseable pair) is Lens, not Scope.
  if (dims.size !== 1) return empty;
  const dimKey = [...dims][0];

  const eligibleIds = [];
  const plans = {};
  for (const id of Object.keys(liPlan)) {
    const li = liPlan[id];
    if (!li) continue;

    // The set of containers to scan + the per-LI period window/factor:
    //   period active → ONLY the owning container, prorated to the period.
    //   no period     → ALL containers, window = container (factor 1).
    let owning = null;
    if (periodKey) {
      owning = resolveOwningContainer(li, periodKey);
      if (!owning) continue; // LI does not own this period → cut from scope
    }
    const containers = periodKey ? [owning.container] : (Array.isArray(li.containers) ? li.containers : []);
    const period = periodKey
      ? { periodFs: owning.periodFs, periodFe: owning.periodFe, factor: periodFactor(owning.container, owning.dateChild, owning.periodFs, owning.periodFe) }
      : null;

    const matched = []; // { child, container, period }
    for (const container of containers) {
      const children = Array.isArray(container.dim_children) ? container.dim_children : [];
      for (const child of children) {
        if (!child || child.dim_key !== dimKey) continue;
        if (!values.has(child.dim_value)) continue;
        if (!(dimAbs(child, container) > 0)) continue;
        matched.push({ child, container, period });
      }
    }
    if (matched.length === 0) continue; // split-less for this dim (in scope) → cut
    plans[id] = mergeDimChildren(li, matched, dimKey, values);
    eligibleIds.push(id);
  }

  return {
    active: eligibleIds.length > 0,
    dimKey,
    values,
    eligibleIds,
    plans,
  };
}

/**
 * Sum multiple matching dim children (multi-value OR and/or multi-container)
 * on one LI into a single leaf virtual plan. planImpr/budget are summed (each
 * prorated by its match's period factor when period-scoped); mTgt is the
 * budget-weighted blend; the window is the period window when period-scoped,
 * else the union of contributing containers' fs..fe.
 *
 * Each `matched` entry carries an optional `period` = { periodFs, periodFe,
 * factor }. In the period-scope path matchDimSplits scans a SINGLE owning
 * container, so all matched entries share one window; in the no-period path
 * `period` is null and the window is the container union (today's behaviour).
 */
function mergeDimChildren(plan, matched, dimKey, values) {
  if (matched.length === 1) {
    return buildVirtualPlanFromDimChild(plan, matched[0].child, matched[0].container, matched[0].period);
  }
  let planImpr = 0;
  let budget = 0;
  let mWeighted = 0; // Σ(childMargin × childBudget) — budget-weighted margin numerator
  let fs = null;
  let fe = null;
  const period = matched[0].period;
  for (const { child, container, period: p } of matched) {
    const factor = p ? p.factor : 1;
    planImpr += dimAbs(child, container) * factor;
    const childBudget = dimChildSpend(plan, child, container) * factor;
    budget += childBudget;
    mWeighted += dimChildMargin(plan, child, container) * childBudget;
    if (fs == null || container.fs < fs) fs = container.fs;
    if (fe == null || container.fe > fe) fe = container.fe;
  }
  const first = matched[0];
  // campM weights margin by budget (metrics.js: `mW += p.mTgt * p.budget`), so the
  // merged plan must carry the budget-weighted average child margin. Σbudget==0
  // (no spend basis) → fall back to the first matched child's margin.
  const mTgt = budget > 0
    ? mWeighted / budget
    : dimChildMargin(plan, first.child, first.container);
  return {
    id: plan.id,
    ch: plan.ch,
    dsp: plan.dsp || null,
    rateType: plan.rateType || 'CPM',
    // Period-scoped: every matched child shares the SINGLE owning container's
    // period window. No period: the union of contributing containers' fs..fe.
    fs: period ? period.periodFs : fs,
    fe: period ? period.periodFe : fe,
    budget,
    planImpr,
    mTgt,
    ctrTgt: plan.ctrTgt,
    vcrTgt: plan.vcrTgt,
    period_scope: false,
    containers: [],
    _scopedFromDim: dimKey + ':' + [...values].sort().join(','),
  };
}

/* ── declared dims, read per VALUE (plan metrics on dimension rows, 2026-09-12) ──
 *
 * matchDimSplits above answers the dashboard's question — "the viewer filtered to
 * these values, what is the plan" — and returns ONE plan per line item over the whole
 * selected set. A widget whose rows are a dimension asks the other question: every
 * value separately, each with its own plan, on a pacing where most values are not
 * declared at all.
 *
 * So this pair walks the containers ONCE per (pacing, dim key, period) and hands back a
 * map keyed by value. Calling matchDimSplits per row instead would multiply the
 * container walk by the row count inside dimBuckets, which already walks every line ×
 * every split key × every day.
 */

/** Every dim KEY some container declares a positive target on — the left halves of
 *  collectSplitKeys. This is the question a metric picker asks: may this grain carry a
 *  plan at all.
 *
 *  Memoised on plan-object identity, like everything else that walks the container tree: it
 *  is asked once per widget MODEL build, and the walk is every line × every container ×
 *  every dim child. Unmemoised it re-ran that on every render of every dim widget on the
 *  page — small per call, and exactly the shape of the accumulation that froze Period
 *  Scope once (pacing-calc.js's header). */
let _declKeyCache = new WeakMap();

export function collectDeclaredDimKeys(liPlan) {
  if (!liPlan || typeof liPlan !== 'object') return new Set();
  const hit = _declKeyCache.get(liPlan);
  if (hit) return hit;
  const keys = new Set();
  for (const pair of collectSplitKeys(liPlan)) {
    const idx = pair.indexOf(':');
    if (idx > 0) keys.add(pair.slice(0, idx));
  }
  _declKeyCache.set(liPlan, keys);
  return keys;
}

// Keyed by raw-plan object identity, exactly like pacing-calc.js's caches and for the
// same reason: a leaf plan built fresh on every render misses every WeakMap memo behind
// liExpUnits / prorate — the cache that fixed the Period Scope freeze. The inner key is
// (dim key, period), because both change the answer.
let _declCache = new WeakMap();

/** Drop every memoised declaration map. Mirrors invalidatePlanCalcCache's contract:
 *  needed only if a caller mutates a plan in place, which this product does not. */
export function invalidateDimDeclCache() {
  _declCache = new WeakMap();
  _declKeyCache = new WeakMap();
}

/** The facts write a split key as String(raw).trim() (normalize.js); a dim_child carries
 *  whatever Settings saved. Both sides pass through here, so a trailing space in the
 *  configuration cannot hide a declared target. */
export const normDimValue = (v) => String(v == null ? '' : v).trim();

/**
 * Every declared VALUE of one dimension, with the leaf virtual plans behind it.
 *
 * @param {Object} liPlan   the RAW plan map — never a scoped one. Both virtual-plan
 *                          builders strip `containers` to [], so a scoped map would
 *                          report every value as undeclared exactly when a period or a
 *                          dim chip is active.
 * @param {string} dimKey   a namebuilder dim key ('geo', 'comment', …)
 * @param {string|null} periodKey  'fs|fe' when period scope is on
 * @returns {Map<string, { liIds: string[], plans: Object[] }>}
 *          value → the lines that declare it, and one leaf plan per line.
 */
export function collectDimPlans(liPlan, dimKey, periodKey = null) {
  if (!liPlan || !dimKey) return new Map();
  let byPacing = _declCache.get(liPlan);
  if (!byPacing) { byPacing = new Map(); _declCache.set(liPlan, byPacing); }
  const cacheKey = dimKey + '\n' + (periodKey || '');
  const hit = byPacing.get(cacheKey);
  if (hit) return hit;

  // value → li id → the children of THAT line declaring THAT value. A line may declare
  // one value in two containers (two flights of the same audience); those merge into a
  // single leaf plan, the way matchDimSplits merges them.
  const staged = new Map();
  for (const id of Object.keys(liPlan)) {
    const li = liPlan[id];
    if (!li) continue;
    let owning = null;
    if (periodKey) {
      owning = resolveOwningContainer(li, periodKey);
      if (!owning) continue; // the line does not own this period → it declares nothing here
    }
    const containers = periodKey
      ? [owning.container]
      : (Array.isArray(li.containers) ? li.containers : []);
    const period = periodKey
      ? {
        periodFs: owning.periodFs,
        periodFe: owning.periodFe,
        factor: periodFactor(owning.container, owning.dateChild, owning.periodFs, owning.periodFe),
      }
      : null;
    for (const container of containers) {
      const children = Array.isArray(container.dim_children) ? container.dim_children : [];
      for (const child of children) {
        if (!child || child.dim_key !== dimKey) continue;
        if (!(dimAbs(child, container) > 0)) continue;
        const value = normDimValue(child.dim_value);
        if (!value) continue;
        if (!staged.has(value)) staged.set(value, new Map());
        const perLi = staged.get(value);
        if (!perLi.has(id)) perLi.set(id, []);
        perLi.get(id).push({ child, container, period });
      }
    }
  }

  const out = new Map();
  for (const [value, perLi] of staged) {
    const liIds = [];
    const plans = [];
    for (const [id, matched] of perLi) {
      liIds.push(id);
      plans.push(mergeDimChildren(liPlan[id], matched, dimKey, new Set([value])));
    }
    out.set(value, { liIds, plans });
  }
  byPacing.set(cacheKey, out);
  return out;
}
