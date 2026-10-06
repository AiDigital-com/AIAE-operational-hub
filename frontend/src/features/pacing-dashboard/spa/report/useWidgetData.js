// workspace/src/pages/Dashboard/components/Widgets/useWidgetData.js
//
// Assembles the pure widget-data `sources` from the store + URL filters, applying the
// widget's per-axis scope overrides (§0.8) and its active period chip (§0.7). Reuses
// the app's own primitives so numbers can never diverge: computeEffLIs + the canonical
// resolveDimScope for the LI set (dim-split Scope: eligible ids + VIRTUAL plans, round
// 6.1 — the widget path used raw liPlan targets before), buildBreakdownFacts for
// dim/platform fact filtering, getEffRange for every window INCLUDING the period chips
// (a chip is a range override fed to the same selector — so 'Flight' composes with an
// active period scope exactly like the global Flight filter, never discarding it).

import { useMemo } from 'react';
import { useDashboardStore } from '../store.js';
import { useFilters } from '../store.js';
import { computeEffLIs, getEffRange, getEffRangeInfo } from '../config.js';
import { makeDimScopeResolver, makeScopeFiltersSelector, makeDeliveryFactsSelector, makePeriodDailyResolver } from '../selectors.js';
import { periodContainerFilters } from '../container-scope.js';
import { groupIndexOf } from '../dim-value-groups.js';
import { memoWidgetSnapshot, widgetPlanMap } from '../widget-snapshot.js';
import { widgetEffFilters, widgetWindow, resolveTimeScope } from '../widget-data.js';
import PrimaryCvRule from '@shared/primary-cv-rule';
import ValueLabels from '@shared/value-labels';

// Widgets may mask period scope. Their synthetic states must never evict a
// selector subscribed to the real Zustand store, even when URL filters match.
// These readers run only inside the widget's data memo, outside store snapshots.
const widgetReaders = () => ({ scope: makeScopeFiltersSelector(), dim: makeDimScopeResolver(),
  delivery: makeDeliveryFactsSelector(), period: makePeriodDailyResolver() });
const followReaders = widgetReaders();
const absoluteReaders = widgetReaders();

// `rangeOverride` (a RangeValue string, or null) is the canonical Period control's
// resolved window. useReportControls owns the persisted display.widgetRanges choice;
// this data hook receives only the resolved answer. An explicit null means follow the
// global filter, including for Widgets with no Period control.
export function useWidgetData(widget, rangeOverride) {
  const { filters } = useFilters();
  const facts = useDashboardStore((s) => s.facts);
  const liPlan = useDashboardStore((s) => s.liPlan);
  const dimSources = useDashboardStore((s) => s.dimSources);
  // The two aux files. They change only on a data load, so a tile that names neither pays a
  // reference comparison per store write and nothing else.
  const creatives = useDashboardStore((s) => s.creatives);
  const conversions = useDashboardStore((s) => s.conversions);
  // The conversion file's tag state (primary conversions Stage 2): the Conversion Action cut's
  // refusal says what is true for this file.
  const conversionTags = useDashboardStore((s) => s.conversionTags);
  const availableSplits = useDashboardStore((s) => s.availableSplits);
  // The pacing's mart-metrics inventory (spec 2026-09-08 §3.6): what the FILE says its
  // delivery rows can carry, or null when it predates the change. It rides the identity list
  // below as well as the payload — equal scopes share one snapshot across mounts, and a
  // refresh that only widened the inventory must not hand back the cached one.
  const availableMetrics = useDashboardStore((s) => s.availableMetrics);
  const dataConfig = useDashboardStore((s) => s.dataConfig);
  const campaign = useDashboardStore((s) => s.campaign);
  // The pacing's alert config — the ONE consumer is a KPI target that names a corridor
  // (§5.3's `band`), which reads the same `notify` the legacy Targets band and dash-gate's
  // Overview sparklines read through shared/kpi-band.js. It changes on a settings save and
  // never on a filter, so it costs a tile nothing between saves.
  const notify = useDashboardStore((s) => s.notify);
  // `display.liNames` and nothing else. Subscribing to the whole `display` re-rendered
  // every tile on any display change — a note, a group, a switch, another tile's period
  // — even when this memo went on to hit.
  const liNames = useDashboardStore((s) => s.display?.liNames);
  const splitScopedMode = useDashboardStore((s) => s.splitScopedMode);
  const splitScopedPlans = useDashboardStore((s) => s.splitScopedPlans);
  const selectedPeriodKey = useDashboardStore((s) => s.selectedPeriodKey);

  const activeRange = rangeOverride;

  return useMemo(() => {
    if (!facts?.liDaily || !liPlan || !campaign) return null;

    const eff = widgetEffFilters(widget, filters);

    // Time scope pin (round 8, §0.8; extracted round 9): scope.time 'absolute' opts
    // this widget out of period scope WHOLESALE — always-current window on RAW
    // plans. resolveTimeScope is pure and unit-pinned: window and plans switch
    // together, never separately.
    const absTime = widget?.scope?.time === 'absolute';
    const { periodMode, periodPlans, periodKey } = resolveTimeScope(
      widget, { splitScopedMode, splitScopedPlans, selectedPeriodKey },
    );

    // View definitions and cosmetic URL state do not change data. Equal scopes
    // share the same snapshot even across different widgets and React mounts.
    const key = JSON.stringify([eff, filters.range, filters.customRange,
      absTime, activeRange, periodMode, periodKey]);
    return memoWidgetSnapshot(facts, [liPlan, dimSources, creatives, conversions, conversionTags,
      availableSplits, availableMetrics, dataConfig, campaign, liNames, notify, periodPlans], key, () => {
      // Canonical dim-split Scope (selectors.js): when the effective dim filter matches
      // a defined dim split, it narrows the LI set AND swaps in per-LI VIRTUAL plans
      // (split window + prorated target). The store-selector signature takes the state
      // object — the store refs here are the same ones it memoizes on (identity-stable
      // pass-through; the absolute pin feeds it the raw base instead).
      const state = { facts, liPlan, splitScopedMode: periodMode, splitScopedPlans: periodPlans, selectedPeriodKey: periodKey, campaign };
      const readers = absTime ? absoluteReaders : followReaders;
      const scopeFilters = readers.scope(state, eff);
      const dimScope = readers.dim(state, scopeFilters);

      let effLIs = computeEffLIs(liPlan, {
        channels: eff.channels, labels: eff.labels, selection: eff.selection,
      });
      if (dimScope.active) {
        const eligible = dimScope.eligibleIds;
        effLIs = effLIs.filter((id) => eligible.has ? eligible.has(id) : eligible.includes(id));
      }

      // Plan evaluation uses Scope facts. Analytical readings apply the entire Lens,
      // including platform, on the original rows so multiple cuts compose exactly.
      const campaignFacts = dimScope.active ? dimScope.facts : { liDaily: readers.period(state) };
      const factsEff = readers.delivery(state, eff);
      const liDaily = factsEff.liDaily;

      // Plans: dim-split virtual plans win; then period-scope virtual plans; else raw.
      const scopeMode = dimScope.active ? true : periodMode;
      const scopePlans = dimScope.active ? dimScope.plans : periodPlans;
      const planMap = widgetPlanMap(liPlan,
        dimScope.active ? dimScope.plans : null, periodMode, periodPlans);

      // Window: an active chip means "the last N days WITHIN the current scope" —
      // the scope bounds (active period window, else flight) anchor and clamp the chip
      // so a window function never sees zero-days outside the period (round 7).
      // 'flight' → range:'all' through getEffRange (period-scope aware by itself).
      let rangeFilters = filters;
      if (activeRange) {
        const scopeBounds = getEffRange(
          { ...filters, range: 'all', customRange: { from: '', to: '' } },
          campaign, facts.asOf, scopeMode, scopePlans,
        );
        const win = widgetWindow(activeRange, null, facts.asOf, campaign.startDate, campaign.endDate, scopeBounds);
        rangeFilters = win
          ? { ...filters, range: 'custom', customRange: { from: win.from, to: win.to } }
          : { ...filters, range: 'all', customRange: { from: '', to: '' } };
      }
      const { range, narrowed } = getEffRangeInfo(rangeFilters, campaign, facts.asOf, scopeMode, scopePlans);
      // Does the PLAN follow this window (2026-09-23)? Only when the viewer narrowed it: a
      // FilterBar preset, a full Custom range, or this widget's own period switch other than
      // Flight. The Flight chip resolves to a concrete custom window above, so it is excluded
      // by name. Period scope keeps the period's own plan; an 'absolute' time pin turns
      // periodMode off, so such a widget does follow a narrowed window.
      const planFollowsRange = narrowed && activeRange !== 'flight' && !periodMode;

      return {
        range,
        // The same window as a FILTER patch, for the one reader that takes its campaign
        // metrics from the store selector instead of from `sources`: a non-composed Layout
        // block's ctx.cm (ReportWidget → useCampMetrics). Null when this widget follows the
        // global filter. The Flight chip is spelled 'all' so the selector reads the flight
        // with the plan unmoved, exactly as `planFollowsRange` says for this snapshot.
        campRange: !activeRange ? null
          : activeRange === 'flight' ? { range: 'all', customRange: { from: '', to: '' } }
            : { range: rangeFilters.range, customRange: { ...rangeFilters.customRange } },
        sources: {
          liDaily,
          // The same aggregate a Lens chip has NOT cut — identical to `liDaily` above whenever
          // no Lens chip is on, so a widget with no basis-bearing view pays nothing for it.
          campaignLiDaily: campaignFacts.liDaily,
          // LSD is lazy — only dim-rowed widgets touch it. When a dim/platform filter is
          // active this is the FILTERED aggregate (buildBreakdownFacts), never the raw one.
          get liSplitDaily() { return factsEff.liSplitDaily ?? facts.liSplitDaily; },
          liPlan: planMap,
          effLIs,
          // Dimension sources are their own files, not part of factsDaily, so the
          // filter above does not reach them on its own — it is handed over here
          // instead. A source answers it through a library that declares which
          // dashboard dimension it is (`brk_dim`); one it cannot answer draws
          // nothing rather than showing an unfiltered total beside filtered
          // delivery, which is what this tile used to do.
          brkf: eff.brkf,
          platforms: eff.platforms,
          scopeBrkf: scopeFilters.brkf,
          containerFilters: periodContainerFilters(liPlan, periodMode ? periodKey : null, eff),
          rawLiPlan: liPlan,
          // Value groups (spec 2026-10-02): the rewrite index of the raw plans. The page has
          // already grouped every row slice; the one reader left is an additional-data source
          // that answers a naming dimension with its OWN column (widget-data.js `brk_dim`).
          dimGroupIndex: groupIndexOf(liPlan),
          // The active period, for the per-dimension plan (2026-09-12). It cannot be read back
          // off `containerFilters`: that list keeps only containers whose children cover
          // essentially the whole target, so a partial carve-out is absent from it while still
          // owning the period. And it must be the RAW plans this key is resolved against —
          // both virtual-plan builders strip `containers` to [].
          periodKey: periodMode ? periodKey : null,
          lensActive: !!(eff.platforms.length || eff.brkf.some((pair) => !scopeFilters.brkf.includes(pair))),
          // The refresh's own list of the dimensions this pacing carries — the blob-level
          // map, NOT a filtered reading. One consumer: a v2 dim view that drew nothing says
          // «This pacing has no Funnel values» instead of blaming the filters (M4, where a
          // dimension switch's stored options travel to a pacing that may lack one). It is
          // deliberately outside the filtered `factsEff` above: what it answers is a question
          // about the pacing, and a filter cannot change the answer.
          availableSplits,
          // …and the same kind of fact about the METRICS (spec 2026-09-08 §3.6): which of the
          // six new delivery keys this pacing's file was built to carry, or null when it
          // predates the change. A value naming one it lacks says so instead of printing the
          // engine's absence-is-zero 0.
          availableMetrics,
          dimSources,
          // The two AUX files, for the two cuts that read one instead of `liSplitDaily`
          // (section-widget parity 2026-09-04): the DSP's own creative and the conversions
          // mart's action. Null where the pacing does not fetch them, which is what
          // `auxBuckets` reads as «no rows» — the legacy panel's own presence-as-signal.
          // Their exact filter_context is read by the same filterSourceRows helper
          // in native Breakdown, report models and formula previews.
          creatives,
          conversions,
          // The pacing's display names for conversion actions and creatives (spec
          // docs/2026-09-24-display-names.md), as raw → name maps. They ride `dataConfig`, which
          // is in the identity list above, so a Save shows the new names without a reload.
          valueLabels: ValueLabels.lookups(dataConfig?.value_labels),
          // The stored source list — group dictionaries live there, keyed per
          // source AND per dimension, so two sources with a `city` column cannot
          // merge into one another's spellings.
          dimSourceConfigs: dataConfig?.dim_sources,
          // Which sentence a blocked creative/conversion cut shows (spec 2026-09-09
          // lens-context §3.3): off names the Data setting, on asks for a refresh.
          lensContext: dataConfig?.lens_context === true,
          // Conversion tags (primary conversions spec §4, §9): the rule, the file's state, and the
          // unfiltered rows a conversion row's own tags are checked against.
          conversionTagsOn: PrimaryCvRule.conversionTagsOn(dataConfig),
          conversionTags: conversionTags || null,
          cvTagFacts: facts.factsDaily,
          // Client cost in a dimension-source file is the mart's native currency —
          // the builder copies it unconverted, unlike the fact aggregates, which
          // normalize.js has already put in USD. dimSourceBuckets is the only
          // consumer that needs this.
          rate: campaign.rate,
          asOf: facts.asOf,
          // widget-data.js planWindowOf: the plan scalars follow `range` only when this is true.
          planFollowsRange,
          // The scope window with no asOf cap (formula chips P1): under period scope or dim
          // scope a chip's own window must stay inside it. `wideRange` (config.js) is the same
          // walk with the cap; null when nothing is scoped. Mirrors the keys it reads.
          scope: scopeMode && scopePlans ? (() => {
            let from = null, to = null;
            for (const vp of Object.values(scopePlans)) {
              if (!vp) continue;
              if (!from || vp.fs < from) from = vp.fs;
              if (!to || vp.fe > to) to = vp.fe;
            }
            return from && to ? { from, to } : null;
          })() : null,
          liNames: liNames || {},
          flightStart: campaign.startDate,
          flightEnd: campaign.endDate,
          // The alert corridor's bounds live here (`notify.alerts.*_below_target`), read only
          // by a KPI target that names one.
          notify,
        },
      };
    });
  }, [widget, filters, facts, liPlan, dimSources, creatives, conversions, availableSplits, availableMetrics, dataConfig, campaign, liNames, notify, splitScopedMode, splitScopedPlans, selectedPeriodKey, activeRange, rangeOverride]);
}
