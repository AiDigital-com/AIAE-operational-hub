/**
 * The seam between Pacing's moved renderer and this app's own state.
 *
 * The four files under `report/` that reach for state — `ReportWidget.jsx`, `useReportControls.js`,
 * `useAutoInventory.js`, `useWidgetData.js` — were written against the SPA's Zustand store, its
 * `useDashboard` hooks, its `useUrlFilters` and its `lib/api.js`. This module answers with the same
 * names and the same call shapes, over what the Hub actually has: one TanStack Query payload, the
 * feature's own URL-filter hook, and the generated API client.
 *
 * WHY A SHIM AND NOT A REWRITE. Those four files are 2 000 lines of the renderer. Rewriting their
 * state access would mean touching every line that reads a figure, in exactly the files whose value
 * is that nobody re-typed them. A seam is one file to read and one place for the next person to look
 * when a field is missing.
 *
 * WHY NO ZUSTAND. `useDashboardStore(selector)` is the only shape the callers use — no `set`, no
 * subscribe-outside-React, no middleware. That is a context read with a selector applied, which is
 * thirty lines here against a new dependency in a stack the project pins deliberately
 * (`CLAUDE.md`: React, TypeScript, Vite, TanStack Query, Clerk, openapi-fetch, plain CSS). What is
 * given up is Zustand's render bail-out when a selector returns an equal value: a component here
 * re-renders whenever the payload identity changes, rather than whenever its own slice does. That is
 * a performance property, not a correctness one, and the payload changes about once per refresh.
 */
import { createContext, createElement, useContext, useMemo } from 'react';
// Pacing's own stylesheet slice. Imported HERE rather than from each component, because this module
// is what every moved component reaches for anyway — a page that mounts one has the styles by
// construction, and there is no second place to remember.
import './pacing-spa.css';
import './tailwind-subset.css';

const DashboardStateContext = createContext(null);

/**
 * Feeds the moved renderer. `value` is the whole state object those files select out of — assembled
 * once by the page from its query payload, so every field below has a single origin.
 */
export function PacingStateProvider({ value, children }) {
  return createElement(DashboardStateContext.Provider, { value }, children);
}

/** Zustand's call shape: `useDashboardStore((s) => s.liPlan)`. */
export function useDashboardStore(selector) {
  const state = useContext(DashboardStateContext);
  if (state === null) {
    throw new Error(
      '[pacing-dashboard/spa] useDashboardStore outside <PacingStateProvider>. The moved renderer ' +
      'reads its figures from that provider; mounting a widget without it would draw zeros.'
    );
  }
  return typeof selector === 'function' ? selector(state) : state;
}

/** The SPA's `useDashboard.js` exported this beside the store; the renderer uses it for the
 *  line items a widget is scoped to. */
export function useEffLIs() {
  const { filters } = useUrlFilters();
  return useDashboardStore((s) => selectEffLIs(s, filters));
}

/**
 * The write half. The SPA's `saveSettings(slug, patch)` posted a settings patch and adopted the
 * server's answer; the renderer calls it for per-viewer preferences only — a tile's saved period
 * (`widgetRanges`) and a Projection control's mode (`projectionModes`).
 *
 * Supplied by the page rather than built here, because the revision check those saves ride under
 * belongs to whoever holds the payload they were read from.
 */
export function useStoreActions() {
  return useDashboardStore((s) => s.actions);
}

/** The dashboard's URL-driven filters, in the shape the renderer expects: `{ filters, setFilters }`.
 *  The Hub's own `filters/use-url-filters.ts` is the implementation; the page passes it through. */
export function useUrlFilters() {
  return useDashboardStore((s) => s.urlFilters);
}

/** Same object, under the second name the renderer imports it by. */
export function useFilters() {
  return useUrlFilters();
}

/**
 * The SPA's `lib/api.js`, narrowed to the two calls the renderer makes: a CM360 widget asks for the
 * third-party rows and their freshness. Both are supplied by the page, so this module opens no
 * network path of its own and stays importable from a test.
 */
export const api = {
  thirdPartyData: (slug) => currentApi().thirdPartyData(slug),
  thirdPartyStatus: (slug) => currentApi().thirdPartyStatus(slug),
};

let _api = null;
/** Set once by the page, before any widget mounts. */
export function setPacingApi(impl) {
  _api = impl;
}
function currentApi() {
  if (!_api) {
    throw new Error(
      '[pacing-dashboard/spa] setPacingApi() was never called. A CM360 widget asked for third-party ' +
      'rows and there is nothing to ask.'
    );
  }
  return _api;
}

/**
 * Assembles the state the moved renderer selects out of, from the Hub's dashboard payload.
 *
 * The payload is NOT that state: `planByLineItem` is `merge.mjs`'s camelCase wire shape
 * (`clientBudget`, `plannedImpressions`, `marginTargetPct`), while every reader below expects the
 * terse one the SPA's store held (`budget`, `planImpr`, `mTgt`). The step between them is
 * `normalize()` — the SPA's own, moved here — so this runs it rather than renaming fields by hand.
 * `buildFactsAggregates` is the second half: `useWidgetData` returns null without `facts.liDaily`,
 * which is a per-line-item per-day aggregate, not the flat `factsDaily` the wire carries.
 *
 * FIELDS THE HUB'S CONTRACT DOES NOT CARRY YET:
 *   `thirdParty` - CM360 widgets have no rows to compare against.
 *   `mappingsV3` - the CM360 mapping, same lane.
 * Both belong to the CM360 path, which is being rewritten; a delivery-data widget draws without
 * them. `types`, `availableSplits`, `availableMetrics` and `conversionTags` WERE on this list and
 * were added to the contract on 2026-10-01 — they are read below, and each is passed on exactly as
 * it arrives, including absent: `availableMetrics` missing means "built before the inventory
 * existed", not "nothing available", and `conversionTags` missing means the conversion rows were
 * never tagged, not that their tags were dropped.
 */
export function usePacingState({ data, urlFilters, actions, journalHighlight }) {
  return useMemo(() => {
    const raw = data ?? null;
    let LP = {};
    let facts = { factsDaily: [], liDaily: {}, liSplitDaily: {}, asOf: null, rate: 1, cvCtx: null };
    if (raw && raw.campaign && Array.isArray(raw.factsDaily)) {
      const rate = Number(raw.campaign.rate) || 1;
      // `normalize` throws on a blob it cannot read (no campaign dates, no factsDaily array). A
      // dashboard that fails to normalize must show no widgets rather than take the page down with
      // it — the figures above the board come from `metrics` and are unaffected.
      try {
        LP = normalize(raw).LP;
      } catch {
        LP = {};
      }
      const { LD, LSD, asOf } = buildFactsAggregates(raw.factsDaily, rate, LP);
      facts = { factsDaily: raw.factsDaily, liDaily: LD, liSplitDaily: LSD,
                asOf: raw.asOf ?? asOf, rate, cvCtx: null };
    }
    return {
      campaign: raw?.campaign ?? null,
      facts,
      liPlan: LP,
      types: raw?.types ?? [],
      creatives: raw?.creatives ?? null,
      conversions: raw?.conversions ?? null,
      conversionTags: raw?.conversionTags ?? null,
      availableSplits: raw?.availableSplits ?? null,
      availableMetrics: raw?.availableMetrics ?? null,
      dataConfig: raw?.data ?? null,
      dimSources: raw?.dimSources ?? null,
      mappingsV3: raw?.mappingsV3 ?? null,
      thirdParty: raw?.thirdParty ?? null,
      notify: raw?.notify ?? null,
      display: raw?.display ?? {},
      journalHighlight: journalHighlight ?? null,
      // Page state the SPA kept in the same store and the Hub has no equivalent for: the dimension
      // hand-off between a tile and the Breakdown panel, and period-scope mode.
      dimensionHandoff: null,
      selectedPeriodKey: null,
      splitScopedMode: false,
      splitScopedPlans: null,
      urlFilters, actions,
    };
  }, [data, urlFilters, actions, journalHighlight]);
}

// ── the SPA's `hooks/useDashboard.js`, the part the renderer uses ──────────────────────────────
//
// That file was a thin hook layer over `selectors.js` — which moved here whole — so it is restated
// here rather than copied as a second file: the renderer imports every one of these names from
// `../store.js` already, and a second module would mean a cycle (it would import the store, the
// store would re-export it) for no gain.
//
// `useMemo` on the selector factories is kept for the reason the original spells out: the selectors
// are memoized on their last inputs, so a fresh one per render would return a new array every time
// and defeat every `memo` below it.
import {
  selectCampaign, selectDisplay, selectFacts, selectLiPlan, selectEffLIs,
  makeCampMetricsSelector, makeFullFlightMetricsSelector,
  selectAvailableSplits, selectAvailDims,
} from './selectors.js';
import { normalize, buildFactsAggregates } from './normalize.js';

export const useCampaign = () => useDashboardStore(selectCampaign);
export const useDisplay = () => useDashboardStore(selectDisplay);
export const useFacts = () => useDashboardStore(selectFacts);
export const useLiPlan = () => useDashboardStore(selectLiPlan);
export const useDataConfig = () => useDashboardStore((s) => s.dataConfig);
/** The whole `{ [id]: { rows, fetched_at, coverage_hint } }` map, or null when no source resolved. */
export const useDimSources = () => useDashboardStore((s) => s.dimSources);
export const useAvailableSplits = () => useDashboardStore(selectAvailableSplits);
/** The dimensions this pacing earns a cut on — the Breakdown panel's rule over the WHOLE pacing.
 *  Takes no filters on purpose: which cuts a widget offers must not move with the filter bar. It
 *  does materialize the lazy breakdown aggregate, so it belongs to surfaces that already pay for
 *  that — the settings drawer, which is the only thing that calls it. */
export const useAvailDims = () => useDashboardStore(selectAvailDims);

/** `filtersOverride`: a chart's own period chip patches the DATA selector's filters, so a target
 *  value read from campM follows the same window as the series it annotates. */
export function useCampMetrics(filtersOverride) {
  const { filters } = useUrlFilters();
  const selector = useMemo(() => makeCampMetricsSelector(), []);
  const eff = filtersOverride || filters;
  return useDashboardStore((s) => selector(s, eff));
}

/** Full-flight metrics, ignoring the range filter — what plan targets are read against. */
export function useFullFlightMetrics() {
  const { filters } = useUrlFilters();
  const selector = useMemo(() => makeFullFlightMetricsSelector(), []);
  return useDashboardStore((s) => selector(s, filters));
}
