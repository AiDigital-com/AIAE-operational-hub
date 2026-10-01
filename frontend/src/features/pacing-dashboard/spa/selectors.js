// workspace/src/lib/dashboard/selectors.js
import { createSelector } from './memo.js';
import { computeEffLIs, getEffRange, getEffRangeInfo } from './config.js';
import { campM, isVcrEligible, viewGoalUnits } from './metrics.js';
import { liExpImpr, liExpCost, liExpClicks } from './pacing-calc.js';
import { datePrev } from './date-utils.js';
import { buildBreakdownFacts } from './breakdown-filter.js';
import { detectAvailDims, dimTaggedDeliveryMemo, splitKeysFor } from './breakdown-aggregate.js';
import { matchDimSplits } from './dim-scope.js';
import { buildPeriodScopedDaily, periodContainerFilters } from './container-scope.js';
import { freezeDevArray } from './freeze-dev.js';
import { windowOfPeriodKey } from './primary-cv.js';

const DEFAULT_SCOPE_REF = {};
const chartDataCache = new WeakMap();

// SINGLETON inactive dim-scope. Returned BY REFERENCE every time no dim-split
// Scope is active (no brkf / cross-dim brkf / brkf with no matching split — the
// overwhelmingly common case). Identity stability is load-bearing: it keeps the
// dim-scope input to every downstream selector UNCHANGED across renders, so their
// memo + output stay byte/value-identical to the pre-dim-scope behavior. Frozen
// so an accidental mutation can never leak the shared object's state.
const INACTIVE_DIM_SCOPE = Object.freeze({
  active: false,
  eligibleIds: null,
  plans: null,
  facts: null,
});

// Intersect computeEffLIs output with the dim-scope eligible-id set, preserving
// computeEffLIs' order (the order effKey / chart aggregation rely on).
function intersectEligible(effLIs, eligibleIds) {
  const allow = new Set(eligibleIds);
  return effLIs.filter((id) => allow.has(id));
}

function getScopeRef(splitScopedMode, splitScopedPlans) {
  return splitScopedMode && splitScopedPlans ? splitScopedPlans : DEFAULT_SCOPE_REF;
}

function getScopedChartCache(liDaily, liPlan, splitScopedMode, splitScopedPlans) {
  let byDaily = chartDataCache.get(liDaily);
  if (!byDaily) {
    byDaily = new WeakMap();
    chartDataCache.set(liDaily, byDaily);
  }

  let byPlan = byDaily.get(liPlan);
  if (!byPlan) {
    byPlan = new WeakMap();
    byDaily.set(liPlan, byPlan);
  }

  const scopeRef = getScopeRef(splitScopedMode, splitScopedPlans);
  let scoped = byPlan.get(scopeRef);
  if (!scoped) {
    scoped = new Map();
    byPlan.set(scopeRef, scoped);
  }

  return scoped;
}

function rangeKey(range) {
  return range ? `${range.from}:${range.to}` : '__all__';
}

// Scalar filter keys: createSelector compares inputs by === (memo.js), and the
// filters object is rebuilt by useUrlFilters on EVERY URL change — feeding it
// in whole invalidates on unrelated params (cols, brk, platforms…). Join the
// slices each computation actually reads — same idiom as makeCardLIsSelector.
// Labels are authored text and can contain separators, so their key preserves
// array boundaries. Channels and LI ids have fixed vocabularies.
const channelsKeyOf = (f) => (f?.channels || []).join('|');
const labelsKeyOf = (f) => JSON.stringify(f?.labels || []);
const selectionKeyOf = (f) => (f?.selection || []).join('|');
const rangeKeyOf = (f) => `${f?.range || 'all'}|${f?.customRange?.from || ''}|${f?.customRange?.to || ''}`;

function effFiltersFromKeys(channelsKey, labelsKey, selectionKey, rangeKeyStr) {
  const [range, from, to] = (rangeKeyStr || 'all||').split('|');
  return {
    channels: channelsKey ? channelsKey.split('|') : [],
    labels: JSON.parse(labelsKey || '[]'),
    selection: selectionKey ? selectionKey.split('|') : [],
    range: range || 'all',
    customRange: { from: from || '', to: to || '' },
  };
}

// --- Lightweight selectors (no memoization needed) ---
export const selectCampaign = (s) => s.campaign;
export const selectDisplay = (s) => s.display;
export const selectJournal = (s) => s.journal;
export const selectLiPlan = (s) => s.liPlan;
export const selectAvailableSplits = (s) => s.availableSplits;
export const selectFacts = (s) => s.facts;
// Primary conversions (spec 2026-09-13 §1): the flag the server computed on read and
// published on the data namespace. Every "operative" check in the browser reads this,
// never a raw response. A missing key or a null namespace reads as off.
export const selectPrimaryCvOperative = (s) => s.dataConfig?.primary_cv_operative === true;

// Column availability is a property of the campaign's raw inventory. Computing
// it once per daily map also avoids scanning the same campaign for every LI.
// Primary conversions (spec 2026-09-13 §3 "Missing data"): on an operative pacing where a
// line item has a choice, the column stays even when every count is 0, so "0 of the chosen
// conversions" is shown as 0. Not operative: the first input is false and the answer is
// today's scan of the day rows.
export const selectHasConversions = createSelector(
  [(s) => s.facts?.liDaily, (s) => s.liPlan, selectPrimaryCvOperative],
  (liDaily, liPlan, operative) => (operative && Object.values(liPlan || {})
    .some((p) => Array.isArray(p?.primaryCv) && p.primaryCv.length > 0))
    || Object.values(liDaily || {}).some(days => Object.values(days).some(row => (row.cv || 0) > 0)),
);

/**
 * Which dimensions this pacing earns a cut on — the LEGACY Breakdown panel's own rule
 * (`detectAvailDims`: audience needs one value, every other dimension needs two, or one
 * that does not tag all the delivery), asked of the whole pacing.
 *
 * ONE rule, every surface. The panel computes it from the unfiltered facts for its tab bar;
 * the v2 surfaces used to ask a DIFFERENT question — "is there a key for it in
 * `availableSplits`" — and that is what lost Funnel and Platform: dimensions the facts have
 * always carried and that inventory never listed. Nothing decides availability off those
 * keys any more.
 *
 * UNFILTERED, and over ALL of the pacing's line items (`Object.keys(liPlan)`) rather than
 * `effLIs`: which cuts a widget offers is a property of the widget, and a chip list that
 * moved with the filter bar would rewrite itself under the reader — the same fault the
 * panel's own comment records for its tab bar.
 *
 * NOT in the set: `creative_asset` and `conversion_action`. The panel folds those in from
 * aux files for its own tab bar; neither is a v2 dimension key.
 *
 * Reading `facts.liSplitDaily` MATERIALIZES the store's lazy breakdown aggregate, so this
 * belongs to surfaces that already pay for it: the Settings drawer, and — since the sections
 * cutover — the Breakdown WIDGET, through `useAutoInventory`. The tile is a DEFERRED consumer:
 * DashGrid mounts it inside DeferredMount, so the aggregate is built when it scrolls into
 * view, exactly when the legacy Breakdown section built it. Nothing on the first-paint path.
 */
export const selectAvailDims = createSelector(
  [(s) => s.facts, (s) => s.liPlan],
  (facts, liPlan) => {
    const liIds = Object.keys(liPlan || {});
    const coverage = dimTaggedDeliveryMemo(facts, liIds, liPlan);
    return detectAvailDims(splitKeysFor(facts && facts.liSplitDaily, liIds), coverage);
  },
);

// brk is dropped from the inputs — the dim is embedded in each brkf pair, so
// breakdown-tab switches no longer invalidate the filtered facts. The brkf
// joiner is \x1f (unit separator), NOT comma/pipe: dim values may legitimately
// contain commas or pipes ("Austin, TX"), so a printable joiner would corrupt
// the round-trip on split.
export function makeBreakdownFactsSelector() {
  return createSelector(
  [
    (s) => s.facts,
    (_s, f) => (Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || '')),
    (_s, f) => (f?.platforms || []).join('|'),
    // Campaign rate scalar: a rate edit must recompute the converted facts (C4).
    (s) => s.campaign?.rate,
    // liPlan: stable store ref. Carries the per-LI coef override so the filtered
    // aggregate resolves `dc` identically to the unfiltered LD/LSD (spec §3.1).
    (s) => s.liPlan,
  ],
  (facts, brkfKey, platformsKey, rate, liPlan) => {
    const brkf = brkfKey ? brkfKey.split('\x1f') : [];
    const platforms = platformsKey ? platformsKey.split('|') : [];
    return buildBreakdownFacts(facts, { brkf, platforms }, rate, liPlan);
  }
  );
}

// resolveDimScope(s, filters) — memoized dim-split Scope resolver. Memo inputs
// mirror selectBreakdownFacts (stable store refs s.facts/s.liPlan + the scalar
// brkf/platform keys) PLUS the period-scope state (splitScopedMode +
// selectedPeriodKey) so the dim split composes WITHIN the active period; it
// recomputes ONLY when the dim filter, period, or underlying data actually
// changes; unrelated filter churn keeps the SAME reference.
//
//   inactive (no brkf / cross-dim / no matching split — the common case)
//       → the INACTIVE_DIM_SCOPE singleton, returned BY REFERENCE. Downstream
//         selectors therefore see an UNCHANGED dim-scope input and stay
//         byte/value-identical to the pre-dim-scope behavior. This holds
//         REGARDLESS of period state: an empty/cross-dim/no-split brkf is always
//         the singleton, so period-only renders are unaffected.
//   active → dim-filtered facts (same buildBreakdownFacts path selectBreakdownFacts
//         uses) + eligible ids + per-LI leaf virtual plans. COMPOSE: when a
//         period is selected, each plan is the dim split resolved WITHIN that
//         period's owning container, scoped (window + prorated target) to the
//         period; when no period, the dim split over its own container window.
export function makeDimScopeResolver() {
  return createSelector(
  [
    (s) => s.facts,
    (s) => s.liPlan,
    (_s, f) => (Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || '')),
    (_s, f) => (f?.platforms || []).join('|'),
    (s) => s.splitScopedMode,
    (s) => s.selectedPeriodKey,
    // Campaign rate scalar — keep the dim-scoped facts in step with rate edits (C4).
    (s) => s.campaign?.rate,
  ],
  (facts, liPlan, brkfKey, platformsKey, splitScopedMode, selectedPeriodKey, rate) => {
    const brkfPairs = brkfKey ? brkfKey.split('\x1f') : [];
    const periodKey = splitScopedMode ? selectedPeriodKey : null;
    const match = matchDimSplits(liPlan, brkfPairs, { periodKey });
    if (!match.active) return INACTIVE_DIM_SCOPE;
    const brkf = brkfKey ? brkfKey.split('\x1f') : [];
    const platforms = platformsKey ? platformsKey.split('|') : [];
    return {
      active: true,
      eligibleIds: match.eligibleIds,
      plans: match.plans,
      // liPlan (already a memo input) carries the per-LI coef override into the
      // dim-scoped facts, so scoped views match the unfiltered aggregate (spec §3.1).
      // Under a period, judge each line item's delivery inside that period's dates (primary
      // conversions, spec §4): a line item whose containers switch audience by month is then
      // exact in each month. `periodKey` is null outside period scope.
      facts: buildBreakdownFacts(facts, { brkf, platforms }, rate, liPlan, null, windowOfPeriodKey(periodKey)),
    };
  }
  );
}

// --- Memoized selectors ---
export function makeEffLIsSelector() {
  return createSelector(
    [
      (s) => s.liPlan,
      (_s, f) => channelsKeyOf(f),
      (_s, f) => labelsKeyOf(f),
      (_s, f) => selectionKeyOf(f),
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liPlan, channelsKey, labelsKey, selectionKey, dimScope) => {
      const effLIs = computeEffLIs(liPlan, effFiltersFromKeys(channelsKey, labelsKey, selectionKey, ''));
      // Dim-split Scope cuts everything outside the split.
      return dimScope.active ? intersectEligible(effLIs, dimScope.eligibleIds) : effLIs;
    }
  );
}

// ── shared, filter-keyed selectors ──────────────────────────────────────────
// A `createSelector` instance is ONE memo slot, and until 2026-09-02 every
// component minted its own through `useMemo(() => makeXSelector(), [])`. That
// looked like isolation and was not: React throws away in-progress hook state
// when a concurrent render is interrupted and restarted, so during a mount
// cascade the SAME component gets a fresh selector — and therefore a freshly
// allocated effLIs array — on every render attempt. Measured on the biggest
// pacing: one CampaignBreakdown, one mount, 78 render attempts, 78 different
// selector instances, and 55 full `mergeSplitAcrossLIs` runs off the churned
// identities (5.0 M addRow, 933 k zeroBucket per dashboard open).
//
// Module scope survives that. One naked singleton would not do, though: its
// single slot thrashes the moment two callers read with different filters —
// which happens for real during a filter change, when some components have
// already re-rendered with the new URL and others have not. So the shared
// selector keeps ONE INSTANCE PER FILTER KEY, most-recent 8, which is both
// identity-stable across render restarts and thrash-free across a transition.
const KEYED_LIMIT = 8;
const filtersKeyOf = (f) => [
  channelsKeyOf(f), labelsKeyOf(f), selectionKeyOf(f), rangeKeyOf(f),
  Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || ''),
  (f?.platforms || []).join('|'),
].join('\x1e');

export function keyedSelector(make, keyOf = filtersKeyOf) {
  const cache = new Map();
  return (state, filters) => {
    const key = keyOf(filters);
    let sel = cache.get(key);
    if (sel) cache.delete(key);            // re-insert = most recently used
    else sel = make();
    cache.set(key, sel);
    if (cache.size > KEYED_LIMIT) cache.delete(cache.keys().next().value);
    return sel(state, filters);
  };
}

// Widgets can pin a different Lens from the dashboard. Their filtered facts
// must remain stable while both readers are mounted, including upstream inputs
// of the delivery selector below.
export const selectBreakdownFacts = keyedSelector(makeBreakdownFactsSelector, (f) => [
  Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || ''),
  (f?.platforms || []).join('|'),
].join('\x1e'));

// Delivery reads the platform Lens while pacing reads the same Scope without
// it. Keep both snapshots stable: a single resolver slot invalidates the other
// read inside the same React render. Dates/channels do not change this scope.
export const resolveDimScope = keyedSelector(makeDimScopeResolver, (f) => [
  Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || ''),
  (f?.platforms || []).join('|'),
].join('\x1e'));

const EMPTY_SCOPE_FILTERS = Object.freeze({ brkf: Object.freeze([]), platforms: Object.freeze([]) });
const brkfKeyOf = (f) => Array.isArray(f?.brkf) ? f.brkf.join('\x1f') : (f?.brkf || '');

// A displayed chip is Scope only if the current period has its target. Outside
// and cross-dimension cuts have no combined plan. An unplanned value alongside
// a planned value must not enter that plan's pacing through the OR filter.
export function makeScopeFiltersSelector() { return createSelector(
  [(s) => s.liPlan, (s) => s.splitScopedMode, (s) => s.selectedPeriodKey, (_s, f) => brkfKeyOf(f)],
  (liPlan, periodMode, periodKey, key) => {
    const pairs = key ? key.split('\x1f') : [];
    const opts = { periodKey: periodMode ? periodKey : null };
    if (!matchDimSplits(liPlan, pairs, opts).active) return EMPTY_SCOPE_FILTERS;
    const brkf = pairs.length === 1 ? pairs : pairs.filter((pair) => matchDimSplits(liPlan, [pair], opts).active);
    return { brkf, platforms: EMPTY_SCOPE_FILTERS.platforms };
  },
); }
export const selectScopeFilters = keyedSelector(makeScopeFiltersSelector, brkfKeyOf);

export const resolvePlanningScope = (state, filters) => resolveDimScope(state, selectScopeFilters(state, filters));

// Actual delivery follows every Lens. Period container coverage still applies;
// buildPeriodScopedDaily alone cannot compose the Lens because factsDaily is
// deliberately the original raw row set even on a filtered facts object.
export function makeDeliveryFactsSelector() { return createSelector(
  [(s) => s.facts, (s) => s.liPlan, (s) => s.splitScopedMode,
    (s) => s.selectedPeriodKey, (s) => s.campaign?.rate, (_s, f) => brkfKeyOf(f),
    (_s, f) => (f?.platforms || []).join('|')],
  (facts, liPlan, periodMode, periodKey, rate, brkfKey, platformKey) => {
    const filters = { brkf: brkfKey ? brkfKey.split('\x1f') : [], platforms: platformKey ? platformKey.split('|') : [] };
    const containerFilters = periodMode ? periodContainerFilters(liPlan, periodKey, filters) : null;
    const judgeWindow = periodMode ? windowOfPeriodKey(periodKey) : null;
    // One raw-row pass feeds BOTH aggregates. Replacing only liDaily would
    // leave dimension tables on a broader delivery slice than cards/charts.
    return buildBreakdownFacts(facts, filters, rate ?? facts?.rate, liPlan, containerFilters, judgeWindow);
  },
); }
export const selectDeliveryFacts = keyedSelector(makeDeliveryFactsSelector,
  (f) => [brkfKeyOf(f), (f?.platforms || []).join('|')].join('\x1e'));

export const selectEffLIs = keyedSelector(makeEffLIsSelector);

// Card list selector: channels + labels only (no selection). Used by DashboardView
// to render the LI cards. Selection is a visual highlight, not a card-visibility
// filter — that responsibility belongs to effLIs.
//
// Filter inputs are scalar joined-string keys so createSelector's ref-equality
// check works correctly even when filters object identity changes per render.
export function makeCardLIsSelector() {
  return createSelector(
    [
      (s) => s.liPlan,
      (_s, f) => (f?.channels || []).join('|'),
      (_s, f) => labelsKeyOf(f),
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liPlan, channelsKey, labelsKey, dimScope) => {
      if (!liPlan) return [];
      const channels = channelsKey ? channelsKey.split('|') : [];
      const labels = JSON.parse(labelsKey || '[]');
      let ids = Object.keys(liPlan);
      if (channels.length) {
        ids = ids.filter((id) => channels.includes(liPlan[id].ch));
      }
      if (labels.length) {
        ids = ids.filter((id) => labels.some((l) => (liPlan[id].labels || []).includes(l)));
      }
      // Dim-split Scope cuts everything outside the split.
      return dimScope.active ? intersectEligible(ids, dimScope.eligibleIds) : ids;
    }
  );
}

export function makeEffRangeSelector() {
  return createSelector(
    [
      (s) => s.campaign,
      (s) => s.facts?.asOf,
      (_s, f) => rangeKeyOf(f),
      (s) => s.splitScopedMode,
      (s) => s.splitScopedPlans,
      (s, f) => resolvePlanningScope(s, f),
    ],
    (campaign, asOf, rangeKeyStr, splitScopedMode, splitScopedPlans, dimScope) => {
      if (!campaign) return null;
      // Dim-split Scope COMPOSES with period-scope: dimScope.plans already carry
      // each eligible LI's window (the period window when a period is active,
      // else the dim split's own container), so getEffRange's splitScopedMode
      // branch unions those windows, clamped to asOf. Period-only (no dim) falls
      // through to the store's splitScopedMode/Plans path unchanged.
      const scopeMode = dimScope.active ? true : splitScopedMode;
      const scopePlans = dimScope.active ? dimScope.plans : splitScopedPlans;
      return getEffRange(
        effFiltersFromKeys('', '', '', rangeKeyStr),
        campaign, asOf, scopeMode, scopePlans
      );
    }
  );
}

export const selectEffRange = keyedSelector(makeEffRangeSelector);

// Delivery source for every headline/chart/card selector. In period-scope mode
// an LI whose owning container is covered by its dim splits (spec
// 2026-08-14-container-dim-scope) reads that container's slice of the facts
// instead of every row in the window; everyone else — and every render outside
// period scope — gets `s.facts.liDaily` BY REFERENCE, so the memo inputs below
// are unchanged and the no-scope path stays value-identical.
export function makePeriodDailyResolver() {
  return createSelector(
    [
      (s) => s.facts,
      (s) => s.liPlan,
      (s) => s.splitScopedMode,
      (s) => s.selectedPeriodKey,
      (s) => s.campaign?.rate,
    ],
    (facts, liPlan, splitScopedMode, periodKey, rate) => {
      if (!facts) return null;
      if (!splitScopedMode || !periodKey) return facts.liDaily || null;
      return buildPeriodScopedDaily(facts, liPlan, rate ?? facts.rate ?? 1, periodKey);
    }
  );
}

export const selectPeriodDaily = makePeriodDailyResolver();

// The delivery + plan override a CAMPAIGN-level reading is taken over, as one object:
// exactly the pair `makeCampMetricsSelector` hands campM below. Dim-split Scope wins (its
// own filtered facts and the split's virtual plans), else the period-scoped daily and the
// period's plans.
//
// It exists because a component that asks a QUESTION about the facts — «does this pacing
// have a video reading?» — has to ask the same facts its numbers come from. Reading
// `s.facts.liDaily` beside a scoped campM is how the Targets band came to draw a VCR cell
// on a completion count of zero under a Scope chip (section-widget parity, 2026-09-04).
export function makeScopedFactsSelector() {
  return createSelector(
    [
      (s) => selectPeriodDaily(s),
      (s) => s.splitScopedMode,
      (s) => s.splitScopedPlans,
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liDaily, splitScopedMode, splitScopedPlans, dimScope) => (dimScope.active
      ? { liDaily: dimScope.facts.liDaily, mode: true, plans: dimScope.plans }
      : { liDaily, mode: splitScopedMode, plans: splitScopedPlans })
  );
}

export const selectScopedFacts = keyedSelector(makeScopedFactsSelector);

export function makeCampMetricsSelector() {
  return createSelector(
    [
      (s) => selectPeriodDaily(s), (s) => s.liPlan, (s) => s.facts?.asOf, (s) => s.campaign,
      (_s, f) => channelsKeyOf(f), (_s, f) => labelsKeyOf(f),
      (_s, f) => selectionKeyOf(f), (_s, f) => rangeKeyOf(f),
      (s) => s.splitScopedMode, (s) => s.splitScopedPlans,
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liDaily, liPlan, asOf, campaign, channelsKey, labelsKey, selectionKey, rangeKeyStr, splitScopedMode, splitScopedPlans, dimScope) => {
      if (!liDaily || !liPlan) return null;
      const f = effFiltersFromKeys(channelsKey, labelsKey, selectionKey, rangeKeyStr);
      if (dimScope.active) {
        // Dim-split Scope: delivery from the dim-filtered facts, plan from the
        // per-LI leaf virtual plans, LIs cut to the split's eligible set. The
        // plans COMPOSE with period-scope (dim split resolved within the active
        // period when one is selected — see resolveDimScope), so the period
        // window + prorated target are already baked into dimScope.plans.
        const effLIs = intersectEligible(computeEffLIs(liPlan, f), dimScope.eligibleIds);
        const scopedDaily = dimScope.facts.liDaily;
        const info = getEffRangeInfo(f, campaign || {}, asOf, true, dimScope.plans);
        // The plan follows a window the viewer NARROWED (2026-09-23) — never the period
        // window, which keeps the period's own plan (the store's period mode, not the dim
        // scope's forced `true`, is what says a period is on).
        return campM(scopedDaily, liPlan, asOf, effLIs, info.range, true, dimScope.plans,
          info.narrowed && !splitScopedMode);
      }
      const effLIs = computeEffLIs(liPlan, f);
      const info = getEffRangeInfo(f, campaign || {}, asOf, splitScopedMode, splitScopedPlans);
      return campM(liDaily, liPlan, asOf, effLIs, info.range, splitScopedMode, splitScopedPlans,
        info.narrowed && !splitScopedMode);
    }
  );
}

export const selectCampMetrics = makeCampMetricsSelector();

// Full-flight metrics (no range filter) — used by Block 1/2/4 for plan targets
export function makeFullFlightMetricsSelector() {
  return createSelector(
    [
      (s) => selectPeriodDaily(s), (s) => s.liPlan, (s) => s.facts?.asOf,
      (_s, f) => channelsKeyOf(f), (_s, f) => labelsKeyOf(f), (_s, f) => selectionKeyOf(f),
      (s) => s.splitScopedMode, (s) => s.splitScopedPlans,
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liDaily, liPlan, asOf, channelsKey, labelsKey, selectionKey, splitScopedMode, splitScopedPlans, dimScope) => {
      if (!liDaily || !liPlan) return null;
      const effLIs = computeEffLIs(liPlan, effFiltersFromKeys(channelsKey, labelsKey, selectionKey, ''));
      if (dimScope.active) {
        // Dim-split Scope: delivery from dim-filtered facts, plan from leaf
        // virtual plans, LIs cut to the eligible set. Plans COMPOSE with
        // period-scope (period window + prorated target baked in upstream).
        return campM(
          dimScope.facts.liDaily, liPlan, asOf,
          intersectEligible(effLIs, dimScope.eligibleIds), null, true, dimScope.plans
        );
      }
      return campM(liDaily, liPlan, asOf, effLIs, null, splitScopedMode, splitScopedPlans);
    }
  );
}

// Chart data selector factory
export function makeChartSelector(chartKey) {
  return createSelector(
    [
      (s, f) => selectDeliveryFacts(s, f)?.liDaily, (s) => s.liPlan, (s) => s.facts?.asOf, (s) => s.campaign,
      (_s, f) => channelsKeyOf(f), (_s, f) => labelsKeyOf(f),
      (_s, f) => selectionKeyOf(f), (_s, f) => rangeKeyOf(f),
      (s) => s.splitScopedMode, (s) => s.splitScopedPlans,
      (s, f) => resolvePlanningScope(s, f),
    ],
    (liDaily, liPlan, asOf, campaign, channelsKey, labelsKey, selectionKey, rangeKeyStr, splitScopedMode, splitScopedPlans, dimScope) => {
      if (!liDaily || !liPlan) return null;
      const f = effFiltersFromKeys(channelsKey, labelsKey, selectionKey, rangeKeyStr);
      if (dimScope.active) {
        // Dim-split Scope: delivery from dim-filtered facts, plan from leaf
        // virtual plans, LIs cut to the eligible set. Plans COMPOSE with
        // period-scope (period window + prorated target baked in upstream).
        const effLIs = intersectEligible(computeEffLIs(liPlan, f), dimScope.eligibleIds);
        const scopedDaily = liDaily;
        const range = getEffRange(f, campaign || {}, asOf, true, dimScope.plans);
        return buildChartData(chartKey, effLIs, scopedDaily, liPlan, range, asOf, true, dimScope.plans);
      }
      const effLIs = computeEffLIs(liPlan, f);
      const range = getEffRange(f, campaign || {}, asOf, splitScopedMode, splitScopedPlans);
      return buildChartData(chartKey, effLIs, liDaily, liPlan, range, asOf, splitScopedMode, splitScopedPlans);
    }
  );
}

// Chart data builder
export function buildChartData(chartKey, effLIs, liDaily, liPlan, range, asOf, splitScopedMode = false, splitScopedPlans = null) {
  const scopedCache = getScopedChartCache(liDaily, liPlan, splitScopedMode, splitScopedPlans);
  const cacheKey = `${asOf || ''}|${rangeKey(range)}`;
  let byMetric = scopedCache.get(cacheKey);
  if (!byMetric) {
    byMetric = new Map();
    scopedCache.set(cacheKey, byMetric);
  }

  const effKey = effLIs.join(',');
  if (byMetric.has(effKey)) return byMetric.get(effKey);

  const agg = {};
  // Separate aggregation bucket for VCR — only LI eligible for VCR contribute,
  // so display LIs don't dilute the video VCR average.
  const aggV = {};
  // CPV-scoped bucket — only CPV LIs contribute, so the Views delivery + CPV
  // cost charts pace against the CPV view plan, not mixed-in display completes.
  const aggCpv = {};
  // Views VOLUME bucket — drives the Cumulative/Daily Views chart actual. Same
  // set as aggCpv PLUS ALL audio completes (listen-throughs shown as views per
  // product intent). Kept separate from aggCpv so audio never pollutes
  // cost-per-view (cpv). Note: CPM audio has no expected-views plan, so its
  // actual runs above expVw — isolate per channel via the filter.
  const aggViews = {};
  // Actual delivered BEFORE the range window (within the flight). Reforecast
  // pace-to-goal needs the full cumulative actual, not just what's in-window —
  // otherwise a Range filter makes the target divide the whole plan by remaining
  // days as if nothing had been delivered. Seeds the canonical reforecast running total.
  const preRange = { im: 0, sp: 0, cl: 0, co: 0, coViews: 0 };
  for (const id of effLIs) {
    const dd = liDaily[id] || {};
    const p = splitScopedMode && splitScopedPlans?.[id] ? splitScopedPlans[id] : liPlan[id];
    const vcrEligible = isVcrEligible(p, dd);
    const isCpv = (p?.rateType) === 'CPV';
    const isAudio = (p?.ch || '').toLowerCase() === 'audio';
    for (const [d, v] of Object.entries(dd)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      // Days inside the flight but before the visible window → baseline only.
      if (range && d < range.from) {
        preRange.im += v.im; preRange.sp += v.sp; preRange.cl += v.cl; preRange.co += v.co;
        // Views reforecast seeds from preRange.coViews — gate to the SAME BROAD
        // basis as aggViews/coViews (CPV OR VCR-eligible OR audio completes) so the
        // pre-window cumulative matches the in-window actual line across the Range
        // boundary. coViews stays broad; only the views/CPV charts' visibility is
        // CPV-gated (in dashboardStore), not this raw actual-completes aggregate.
        if (isCpv || vcrEligible || isAudio) preRange.coViews += v.co;
        continue;
      }
      if (range && d > range.to) continue;
      if (!agg[d]) agg[d] = { im: 0, sp: 0, cl: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0 };
      agg[d].im += v.im; agg[d].sp += v.sp; agg[d].cl += v.cl; agg[d].co += v.co;
      agg[d].cv += (v.cv || 0); agg[d].pc += (v.pc || 0); agg[d].pv += (v.pv || 0); agg[d].dc += (v.dc || 0);
      if (vcrEligible) {
        if (!aggV[d]) aggV[d] = { im: 0, co: 0 };
        aggV[d].im += v.im;
        aggV[d].co += v.co;
      }
      if ((isCpv || vcrEligible) && !isAudio) {
        if (!aggCpv[d]) aggCpv[d] = { sp: 0, co: 0 };
        aggCpv[d].sp += v.sp;
        aggCpv[d].co += v.co;
      }
      // Views VOLUME actual (coViews) is BROAD by design — it takes ALL completes
      // from any view-completing line: CPV, VCR-eligible video, AND audio. This is
      // the one aggregate NOT restricted to CPV: the views/CPV charts only render
      // when a CPV LI exists (gated in dashboardStore), but when they do, the raw
      // actual-completes line shows the full delivered volume.
      if (isCpv || vcrEligible || isAudio) {
        if (!aggViews[d]) aggViews[d] = { co: 0 };
        aggViews[d].co += v.co;
      }
    }
  }
  const dates = Object.keys(agg).sort();
  if (!dates.length) {
    const empty = freezeDevArray([]);
    byMetric.set(effKey, empty);
    return empty;
  }

  const rangeBaseline = range?.from ? datePrev(range.from) : null;
  const planEntries = effLIs
    .map((id) => {
      const plan = splitScopedMode && splitScopedPlans?.[id] ? splitScopedPlans[id] : liPlan[id];
      if (!plan) return null;
      const useBaseline = !!(rangeBaseline && range && range.from > plan.fs);
      return {
        plan,
        isCpv: plan.rateType === 'CPV',
        isAudio: (plan.ch || '').toLowerCase() === 'audio',
        // ACR target as a fraction (vcrTgt is stored as a percent). Drives the
        // synthesized expected-listens for CPM audio (which has no view plan).
        acr: Number(plan.vcrTgt) > 0 ? Number(plan.vcrTgt) / 100 : 0,
        expImBase: useBaseline ? liExpImpr(plan, rangeBaseline) : 0,
        expCoBase: useBaseline ? liExpCost(plan, rangeBaseline) : 0,
        expClBase: useBaseline ? liExpClicks(plan, rangeBaseline) : 0,
      };
    })
    .filter(Boolean);

  const rows = dates.map((d) => {
    let expIm = 0;
    let expCo = 0;
    let expCl = 0;
    let expVw = 0;   // expected views (CPV-only basis, viewGoalUnits): only CPV LIs (planImpr = view goal) contribute a plan line. Non-CPV (CPM video VCR / CPM audio ACR / CPC) add nothing — views/CPV is per-CPV-LI only.

    for (const entry of planEntries) {
      expIm += liExpImpr(entry.plan, d) - entry.expImBase;
      expCo += liExpCost(entry.plan, d) - entry.expCoBase;
      expCl += liExpClicks(entry.plan, d) - entry.expClBase;
      if (viewGoalUnits(entry.plan) > 0) {
        // viewGoalUnits is CPV-only → only CPV entries here; planImpr IS the view
        // goal, so expected views = expected impressions for the CPV line.
        expVw += liExpImpr(entry.plan, d) - entry.expImBase;
      }
    }

    const cpvCo = aggCpv[d] ? aggCpv[d].co : 0;
    const cpvSp = aggCpv[d] ? aggCpv[d].sp : 0;

    return {
      date: d,
      im: agg[d].im,
      sp: agg[d].sp,
      cl: agg[d].cl,
      co: agg[d].co,
      // Conversion/cost fields were always accumulated in agg[] but never returned;
      // custom-widget formulas (2026-07-12) read them. Additive — existing consumers
      // see extra keys only.
      cv: agg[d].cv,
      pc: agg[d].pc,
      pv: agg[d].pv,
      dc: agg[d].dc,
      coViews: aggViews[d] ? aggViews[d].co : 0,
      expIm: Math.round(expIm),
      expCo,
      expCl: Math.round(expCl),
      expVw: Math.round(expVw),
      ctr: agg[d].im > 0 ? (agg[d].cl / agg[d].im) * 100 : 0,
      vcr: aggV[d] && aggV[d].im > 0 ? (aggV[d].co / aggV[d].im) * 100 : null,
      cpm: agg[d].im > 0 ? (agg[d].sp / agg[d].im) * 1000 : 0,
      cpc: agg[d].cl > 0 ? agg[d].sp / agg[d].cl : 0,
      cpv: cpvCo > 0 ? cpvSp / cpvCo : null,
    };
  });
  // Carry the pre-window delivered actuals as a non-enumerable prop so the
  // reforecast pace-to-goal can seed its running total (Range-filter aware)
  // without polluting the row shape. Set before freezing.
  Object.defineProperty(rows, 'preRange', { value: preRange, enumerable: false });

  const result = freezeDevArray(rows);
  byMetric.set(effKey, result);
  return result;
}
