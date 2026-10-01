// workspace/src/pages/Dashboard/components/Widgets/Report/ReportWidget.jsx
//
// The v2 report TILE (widget-builder v2 spec 2026-08-19 §3/§5/§6; P2 plan Task 10) — the
// one place everything Tasks 3-9 built becomes a widget somebody can look at:
//
//   WidgetFrame (badge `report`, the widget's title, its scope badge — honest now, because
//               a v2 tile's data really does honour `widget.scope`)
//     controls row  metric switch · period chips · dimension chips · breakdown chips, and
//                   the notes that are true of the whole tile rather than of one view
//     views[]       in STORED ORDER, each exactly once, each drawing its own model
//
// The file is in two halves, and the split is deliberate:
//   · `ReportWidget` — the store-coupled shell. It resolves the period, calls
//     `useWidgetData(widget, rangeOverride)`, runs the CM360 lifecycle, and holds nothing
//     else. It cannot render outside a Router, and it has no opinions about looks.
//   · `ReportBody` / `ReportControls` — PROPS ONLY, the property the five view renderers
//     already stand on: the layout preview, the gallery miniature and the host tests all
//     render them, and a store hook inside would answer with the store's INITIAL state on
//     every surface that has no provider.
//
// Nothing here computes a number. Every model is report-render.js's, every CM360 number is
// the §8.5 seams', and the two states that belong to the TILE rather than to a view — a
// window with no delivered facts, and a dimension source that is gone — are answered by
// the canonical data-state helpers.
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { upgradeConversionDefaults } from '../standard-conversion-format.js';
import { useParams, useOutletContext } from 'react-router-dom';
import Currency from '@shared/currency';
import ValueLabels from '@shared/value-labels';
import WidgetFrame from './WidgetFrame.jsx';
import { useWidgetData } from './useWidgetData.js';
import { useDashboardStore } from '../store.js';
import { selectPrimaryCvOperative } from '../selectors.js';
import {
  useCampMetrics, useFullFlightMetrics, useEffLIs, useFacts, useCampaign, useLiPlan, useFilters,
} from '../store.js';
import { useApi } from '../useApi.js';
import { api } from '../store.js';
import { H_PX } from '../layout-grid.js';
import { coefModeOf, netModeOf } from '../brick-data.js';
import { sourceFilterReason } from '../widget-data.js';
import { buildFormulaPreview } from '../formula-preview.js';
import { dimSourceMissingReason } from '../dim-sources-norm.js';
import { V2_BADGE, specWantsCm } from '../report-v2.js';
import { flattenViews, leafViews, LIMITS } from '../report-v2.js';
import {
  scopedCampCtx, compositionContext, attachCmData, cmReaderFor, cmMetricOf, dimensionLabel, dimensionNote, reportDimKey,
  focusGenerationOf, focusTargetsOf,
  reportShowsEmptyWithoutFacts, reportWindowHasFacts, viewShown, autoLabel, pacingWording, resolveValue,
  buildReportChartModel, buildReportTableModel, buildReportKpiModel, buildReportPieModel,
} from '../report-render.js';
// The dimensions a `brk`/`brkf` pair can actually narrow: every one of them is a `dim:value`
// key on the facts. A cut whose values live in their own file (a dimension source, the DSP's
// creatives, the conversions mart) matches nothing AND demotes a live filter from Scope to
// Lens, which is why the legacy panel refuses a click on those tabs too.
import { FILTERABLE_DIMS, nextBrkfPairs } from '../breakdown-filter.js';
import { useUrlFilters } from '../store.js';
import { buildCm360ComparisonDataset } from '../compare-dataset.js';
import { projectCm360Comparison, selectComparisonDims } from '../compare-project.js';
import { resolveCm360ComparisonState, resolveMappingChoice } from '../compare-state.js';
import { cm360FilterReason } from '../compare-filters.js';
import { resolveAutoControls } from '../auto-controls.js';
import { useAutoInventory } from './useAutoInventory.js';
import { useReportControls } from './useReportControls.js';
import { applyReportHighlights } from '../report-highlights.js';
import ReportChart from './ReportChart.jsx';
import ReportTable from './ReportTable.jsx';
import ReportKpi from './ReportKpi.jsx';
import ReportPie from './ReportPie.jsx';
import ReportCompare, { compareMetaRuns, compareStateSentence } from './ReportCompare.jsx';
import ReportLayout from './ReportLayout.jsx';
import ReportComposition from './ReportComposition.jsx';
import ReportPieTable from './ReportPieTable.jsx';
import { pieTablePair } from './pie-table.js';

/**
 * How tall a view is, by the widget's PROFILE — decided here and not by the grid (P2 plan
 * Task 10). A `card` is a KPI-sized box whose height is content-driven (`hSteps` null in
 * KIND_CONSTRAINTS), so its chart has to bring its own; a `section` is a page-wide band and
 * takes the grid's own M/XL steps, which is what every built-in beside it is drawn at.
 */
const CHART_H = { card: 180, chart: H_PX.M, table: H_PX.M, section: H_PX.M };
// The SECTION profile's table is the page-wide band a legacy section is, and its box is that
// section's own 560 (DailyTable.jsx:401; section-widget parity 2026-09-04). At 440 the twelfth
// row was cut in half by the frame, which reads as a rendering fault rather than as a scroll.
const TABLE_MAX = { card: 260, chart: H_PX.L, table: H_PX.XL, section: H_PX.XXL };
const PIE_H = { card: 160, chart: H_PX.M, table: H_PX.M, section: 200 };

/** The period chips' words — shared with the Builder, whose Data row names the period this
 *  tile is drawing right under it. RANGE_VALUES keeps the stored keys honest. */
export const RANGE_LABEL = { auto: 'Auto', '1d': '1d', '3d': '3d', '7d': '7d', '14d': '14d', '30d': '30d', flight: 'Flight' };

/** The empty state a window with no delivered facts draws instead of every view's zeros. */
const NO_FACTS = 'No delivery data in this period yet';

/** …and the two a tile draws when every view it holds is out of scope. WHICH of them is true
 *  depends on why: the filter can have left no line items to read at all (the Targets band's
 *  own case — the legacy block hides itself there and a tile that is a real card says why
 *  instead), or the pacing can simply carry no reading for any cell the widget holds, which
 *  is a fact about the pacing that no filter change will fix. `basis` is a grammar key any
 *  KPI may carry, so blaming the filter for both would state something false the day a
 *  second preset mints an `audio` cell (fix round 1, 2026-09-04). */
const NO_LINES = 'No line items in the current filter';
const NO_BASIS = 'None of these metrics apply to this pacing';

/**
 * previewState({noFacts, missing, cm}) → `{zeroResult, sourceUnavailable}` — the two of §9's
 * states that are about the DATA behind a valid draft, in the only place that can answer
 * them (P3 T11). The builder's banner reads this off the preview tile through `onState`; it
 * has neither the fetch nor the §8.5 seams, and deriving it a second time from a different
 * input is how two surfaces come to disagree about one window.
 *
 * `sourceUnavailable` carries the SENTENCE, not a flag: §9 asks for the named source and its
 * repair route, and both already exist — `dimSourceMissingReason` for a dimension source
 * that is gone, `compareStateSentence` for the comparison. Nothing is minted here.
 *
 * The comparison counts as unavailable only when there is something the reader can DO about
 * it (`repairAction`) and the tile is drawing no numbers (`modelReady` false). A stale file
 * has a repair route and still draws — that is a note on the tile, not a disconnected
 * source — and a pull that is running is nobody's to fix yet.
 */
export function previewState({ noFacts, missing, cm }) {
  const status = cm && cm.status;
  const comparison = status && status.repairAction && !status.modelReady
    ? compareStateSentence(status)
    : null;
  return {
    zeroResult: !!noFacts,
    sourceUnavailable: (Array.isArray(missing) ? missing.find(Boolean) : null) || comparison || null,
  };
}

/**
 * Does this view carry anything that follows the metric switch? It is what the hover
 * highlight dims by (§6's blind-study condition: hovering the switch highlights exactly the
 * elements that will move), and it is read off the STORED spec rather than off a model,
 * because a model that failed to build still belongs to a view that would move.
 *
 * A compare view always does: §5.5 makes the metric switch part of what it IS, and the whole
 * comparison is cut on the selected field.
 */
function viewFollowsSwitch(view) {
  const bound = (v) => !!(v && v.kind === 'bound');
  if (!view) return false;
  if (view.kind === 'container') return leafViews(view.children).some(viewFollowsSwitch);
  if (view.kind === 'compare') return true;
  if (view.kind === 'chart') return (view.series || []).some((s) => bound(s.value));
  if (view.kind === 'table') return bound(view.share && view.share.value) || (view.columns || []).some((c) => bound(c.value));
  if (view.kind === 'kpi') return bound(view.value) || bound(view.target && view.target.value);
  if (view.kind === 'pie') return bound(view.value);
  return false;
}

/* ── the CM360 lifecycle (§8.5 seams 1-3, once per tile) ──────────────────── */

/**
 * maskCm360Filters(bundle, sources) → the bundle a dashboard dimension or platform filter
 * leaves a tile with.
 *
 * The mapping cannot apply those filters to both sides of the join, so a filtered tile reads
 * NO CM360 at all: the dataset and both projections go, and the state ladder is re-stamped
 * with the sentence that says which filter did it. The delivery half is untouched, because it
 * is filtered correctly and `data.sources` is where it comes from.
 *
 * It lives beside the hook, and the HOOK applies it, because three consumers read this bundle
 * (§2.7): the views, the Layout blocks through `layoutCtx.cmRead`, and the Builder preview. A
 * mask applied by one of them would leave the other two reading numbers the filter does not
 * govern. Idempotent by construction, so a caller that masks a bundle the hook already masked
 * gets the same answer back.
 *
 * The mapping's DIMENSIONS stay: they name the chips on the controls row, and a viewer who
 * clears the filter has to find the same chips there.
 */
export function maskCm360Filters(bundle, sources) {
  if (!bundle) return null;
  const filterReason = cm360FilterReason(sources);
  if (!filterReason) return bundle;
  return {
    ...bundle, dataset: null, projection: null, focusedProjection: null,
    status: { ...bundle.status, state: 'unsupportedFilters', modelReady: false, filterReason },
  };
}

/**
 * useReportCm360(spec, controlState, breakdownControl, data, focusedIn, selectedMappingId)
 * → everything the CM360 half of a tile needs, or null on a widget with no CM360 in it.
 *
 * WHICH widgets those are is `specWantsCm || datasetType === 'deliveryCm360'` (widget value
 * sources phase 1, spec 2026-08-25 §3): a CM360 widget always, because the dataset IS the
 * comparison, plus any ordinary delivery widget holding a `source:'cm'` value anywhere a value
 * lives — a series, a guide, a column, a KPI value or target, or a metric switch's option the
 * viewer can move onto. The predicate is the GRAMMAR's own Table I walk, read through the
 * door: the tile that fetches and the save that refuses an entity scope answer one question
 * once, rather than two readings of the same spec that can disagree.
 *
 * Everything below is then IDENTICAL on the two datasets, deliberately (§3, D1): the mapping is
 * resolved in runtime mode (a delivery dataset stores no binding, which is exactly what
 * `resolveMappingChoice` reads as runtime), the dataset is built from the pacing's own facts,
 * the projection is cut to the same window and the same default breakdown, and the state ladder
 * answers with the same fourteen states and the same sentences. A cm number on a delivery tile
 * is therefore the number the Compare view shows for the same field, and there is no second
 * read path to keep in step with this one.
 *
 * The ONE thing that is not identical lives in report-render's `cmFeedOf`, not here: on a
 * delivery widget only the cm half of a dual-source pair is adapter-fed and the bq twin stays
 * engine-fed.
 *
 * The fetch is `useApi` with the PANEL's own cache keys (`tp-data:<slug>`), so a tile and the
 * legacy panel on the same page are one request and one payload — the dedup is the cache's,
 * not something arranged here.
 *
 * Then the three seams, in the only order that works: the mapping CHOICE (a fixed binding is
 * honoured or named, never substituted — §7.7), the DATASET built once from it, the
 * PROJECTION cut per viewer state, and the STATE resolved over both.
 *
 * `selectedMappingId` is the viewer's pick out of useReportControls, and it goes into BOTH
 * calls: the choice the dataset is built from and the choice the state resolver judges have
 * to be one choice, or a picked mapping would be compared while the tile reported the first.
 * A `fixed` binding ignores it by construction — `resolveMappingChoice` never lets a runtime
 * pick reach that branch.
 *
 * TWO projections, and the second is the whole of §5.6: a focused tuple narrows the compare
 * view's own chart and the chart a `tupleFocus` DECLARES — and nothing else on the tile. A
 * Δ% column three views down is a reading of the whole window and may not silently become a
 * reading of one row because somebody clicked a table. The unfocused projection is therefore
 * the tile's default and the focused one is built only when there is a focus to build it for.
 *
 * `focusedIn` comes from useReportControls: the focused key is valid only inside the
 * comparison it was picked in, and that comparison's identity is computed here, where the
 * window, the dimensions and the mapping are all known.
 *
 * The delivery side of the comparison is the pacing's OWN facts, straight from the store —
 * the panel's inputs, deliberately, and not `data.sources`. Two reasons, and both are the
 * validator's: a widget that reads CM360 takes no ENTITY scope at all (a CM360 dataset takes
 * no widget scope, "its rows come from the mapping"; a delivery widget holding a cm value is
 * refused `lis`/`channels`/`dims` by CM_NO_ENTITY_SCOPE), so there is no per-tile narrowing to
 * honour on either dataset; and the comparison classifies over the MAPPING's dimensions, which
 * the dashboard's channel / LI / dim filters know nothing about. Narrowing one side of a
 * comparison and not the other is the one thing that would make every number on this view
 * wrong, and the panel below it would disagree with the tile.
 *
 * The dataset remains the whole mapping. THIS HOOK refuses its CM360 readings while a
 * dimension or platform filter is active, through `maskCm360Filters` below: the mapping
 * cannot reliably apply those filters to both sides. BQ-only readings still use the filtered
 * delivery in `data.sources`.
 *
 * The WINDOW is the exception, and it is not one of these: `data.range` is the widget's
 * EFFECTIVE window — the dashboard's range filter, and a Period control's `rangeOverride`
 * composed into it by `useWidgetData` — and it is handed to `projectCm360Comparison` as
 * `range`, which cuts the comparison's values to it. So a cm value honours exactly the window
 * the bq series beside it honours, chips included, through the projection's own windowing.
 */
function useReportCm360(spec, controlState, breakdownControl, data, focusedIn, selectedMappingId) {
  const { slug } = useParams();
  const isCm360Dataset = !!(spec && spec.dataset && spec.dataset.type === 'deliveryCm360');
  const wants = isCm360Dataset || specWantsCm(spec);
  // Configured means a 3rd-party source on the pacing (config third_party[]), which is
  // the condition the legacy section's visibility read. Unconfigured: no fetch, no probe,
  // and the state resolver answers `notConfigured` before it looks at anything else.
  const thirdParty = useDashboardStore((s) => s.thirdParty);
  const configured = Array.isArray(thirdParty) && thirdParty.length > 0;
  const fetchWanted = wants && configured;
  const factsDaily = useDashboardStore((s) => s.facts?.factsDaily);
  const types = useDashboardStore((s) => s.types);
  const liPlan = useDashboardStore((s) => s.liPlan);
  const mappingsV3 = useDashboardStore((s) => s.mappingsV3);
  const creatives = useDashboardStore((s) => s.creatives);
  const valueLabels = useDashboardStore((s) => s.dataConfig?.value_labels);

  // A widget with no CM360 in it asks for nothing: the fetcher answers `null` rather than
  // being skipped, because the hook count may not depend on the spec — an edit that added a
  // cm value, or a store adoption that flipped a dataset, would otherwise crash the tile it
  // changed.
  const { data: tpData, loading, error } = useApi(
    () => (fetchWanted ? api.thirdPartyData(slug) : Promise.resolve(null)),
    [slug, fetchWanted],
    { cacheKey: fetchWanted ? `tp-data:${slug}` : null },
  );
  // Keyed like the fetch above, and for the same reason: N report tiles on one dashboard
  // asked for the same stamp N times. Its OWN key — one key for two endpoints would serve
  // each the other's payload. (The panel's probe stays un-keyed; it is frozen, and the
  // 30s TTL is what a second reader of a cached stamp can be behind by.)
  const { data: statusData, loading: statusLoading } = useApi(
    () => (fetchWanted ? api.thirdPartyStatus(slug) : Promise.resolve(null)),
    [slug, fetchWanted],
    { cacheKey: fetchWanted ? `tp-status:${slug}` : null },
  );

  // Only a deliveryCm360 dataset carries a binding — the grammar gives a delivery dataset no
  // `mapping` key at all — and `null` is what `resolveMappingChoice` reads as RUNTIME mode.
  // So a delivery widget resolves its mapping exactly the way a CM360 widget in runtime mode
  // does (D1), with no branch to keep the two in step.
  const binding = isCm360Dataset ? (spec.dataset.mapping || null) : null;
  const choice = useMemo(
    () => resolveMappingChoice({ mappingEntities: mappingsV3, mappingBinding: binding, selectedMappingId }),
    [mappingsV3, binding, selectedMappingId],
  );

  // The pacing's display names for creatives (spec docs/2026-09-24-display-names.md): the
  // comparison's delivery member lines show them. null when the pacing names none.
  const creativeLabel = useMemo(() => {
    const map = ValueLabels.lookup(valueLabels, 'creative');
    return map ? (raw) => ValueLabels.labelOf(map, raw) : null;
  }, [valueLabels]);
  const dataset = useMemo(() => (wants ? buildCm360ComparisonDataset({
    factsDaily,
    types,
    liPlan,
    creatives,
    cm360Raw: (tpData && Array.isArray(tpData.rows)) ? tpData.rows : [],
    mapping: choice.mapping,
    creativeLabel,
  }) : null), [wants, factsDaily, types, liPlan, creatives, tpData, choice, creativeLabel]);

  const maxSelected = (breakdownControl && breakdownControl.maxSelected) || null;
  const metric = useMemo(() => (wants ? cmMetricOf(spec, controlState) : null), [wants, spec, controlState]);
  const range = (data && data.range) || null;
  const selectedDimIds = controlState.breakdownIds;

  // The dimension selection is resolved BEFORE the projection, by the seam's own rule, and
  // for one reason: the focus generation is made of it, and the projection is made of the
  // focus. One call each, no circle, and the same function answers for the chips.
  const selection = useMemo(
    () => (dataset ? selectComparisonDims(dataset.dims, { selectedDimIds, maxSelected }) : null),
    [dataset, selectedDimIds, maxSelected],
  );
  const gen = focusGenerationOf(
    range,
    selection ? selection.dims.map((d) => d.id) : [],
    choice.entity && choice.entity.id,
  );
  const focusedKey = wants ? focusedIn(gen) : null;

  const projection = useMemo(() => (dataset ? projectCm360Comparison(dataset, {
    selectedDimIds, maxSelected, metric, focusedKey: null, range,
  }) : null), [dataset, selectedDimIds, maxSelected, metric, range]);
  const focusedProjection = useMemo(() => ((dataset && focusedKey) ? projectCm360Comparison(dataset, {
    selectedDimIds, maxSelected, metric, focusedKey, range,
  }) : projection), [dataset, selectedDimIds, maxSelected, metric, focusedKey, range, projection]);

  // §8.3: freshness describes the SOURCE. Judged against the delivery it is compared to —
  // a CM360 file last read before the pacing's own `asOf` is behind the numbers beside it —
  // rather than against a wall clock: the pull is triggered from Settings and has no cadence
  // a threshold could be derived from, and a clock read is not a pure input.
  const fetchedAt = (tpData && tpData.fetched_at) || null;
  const asOf = (data && data.sources && data.sources.asOf) || null;
  const freshness = useMemo(() => ({
    fetchedAt,
    stale: !!(fetchedAt && asOf && String(fetchedAt).slice(0, 10) < asOf),
  }), [fetchedAt, asOf]);

  const status = useMemo(() => (wants ? resolveCm360ComparisonState({
    configured,
    data: tpData,
    loading,
    error,
    statusData,
    statusLoading,
    mappingEntities: mappingsV3,
    mappingBinding: binding,
    selectedMappingId,
    level: dataset ? dataset.level : 'placement',
    creatives,
    anyBridge: !!(dataset && dataset.anyBridge),
    cm360GroupCount: dataset ? dataset.cm360Rows.length : 0,
    freshness,
    projectionError: projection ? projection.projectionError : null,
  }) : null), [
    wants, configured, tpData, loading, error, statusData, statusLoading, mappingsV3, binding,
    selectedMappingId, dataset, creatives, freshness, projection,
  ]);

  // The mask is the LAST thing the lifecycle does, so nothing downstream can be handed an
  // unfiltered reading of a filtered tile (§2.7). `data.sources` is the same object the
  // delivery half was built from, which is what makes the two halves answer about one window
  // and one filter.
  const filterSources = data && data.sources;
  return useMemo(() => maskCm360Filters(wants ? {
    dims: dataset ? dataset.dims : [],
    maxSelected,
    metric,
    dataset,
    projection,
    focusedProjection,
    status,
    gen,
  } : null, filterSources),
  [wants, dataset, maxSelected, metric, projection, focusedProjection, status, gen, filterSources]);
}

/* ── the controls row ─────────────────────────────────────────────────────── */

/**
 * The row under the widget's title: the metric switch, the mapping picker, the period chips,
 * the dimension chips, the breakdown chips, the source meta at the right edge, and any note
 * that is true of the whole tile.
 *
 * PROPS ONLY and hook-free — each control arrives as `{options, value, onChange}` and this
 * component decides nothing about what any of them mean.
 *
 * The chips are the control's OPTIONS and nothing else: a v2 tile offers no `Auto`, because
 * the widget's own `spec.period` already fills that role and the ladder (decision 6) answers
 * for the rest. Two switches saying "follow something else" is what that ladder replaces.
 *
 * `meta` is the one item on this row that is not a control: short runs of text describing the
 * SOURCE the numbers came from, at the far edge (section-widget parity 2026-09-04). It takes
 * no handler and no pressed state for the reason the fixed-window note beside it does not —
 * a reader must never take a statement for something they can press.
 */
export function ReportControls({
  metric = null, mapping = null, period = null, dimension = null, breakdown = null,
  windowNote = null, projections = [], notes = [], meta = [], onSwitchHover = null, search = null,
}) {
  const dims = (breakdown && breakdown.dims) || [];
  const selected = (breakdown && breakdown.selectedIds) || [];
  const cap = (breakdown && breakdown.maxSelected) || null;
  const cuts = (dimension && dimension.options) || [];
  const cutLabels = new Set();
  const repeatedCutLabels = new Set();
  for (const cut of cuts) {
    if (cutLabels.has(cut.label)) repeatedCutLabels.add(cut.label);
    cutLabels.add(cut.label);
  }
  const activeCut = cuts.find((cut) => cut.key === dimension.value);
  const cutNote = activeCut?.note ? `${activeCut.label} · ${activeCut.note}` : '';
  const hasCutNotes = cuts.some((cut) => cut.note);
  const runs = Array.isArray(meta) ? meta.filter(Boolean) : [];
  const hasRow = !!(metric || mapping || period || windowNote
    || projections.length || cuts.length || dims.length || runs.length || search);
  if (!hasRow && !notes.length) return null;

  return (
    <div className="rpt-ctl">
      {/* The row exists only when it would HOLD a control: a widget with no switches but a
          note of its own would otherwise carry an empty flex row above it. */}
      {hasRow && (
      <div className="rpt-ctl-row">
        {metric && (
          <div
            className="rpt-pills"
            role="group"
            aria-label={metric.label || 'Metric'}
            // §6: hovering the switch highlights exactly the elements that will move. The
            // hover only sets a class on the widget root; which elements light up is a CSS
            // rule over the markers the views already carry.
            onMouseEnter={onSwitchHover ? () => onSwitchHover(true) : undefined}
            onMouseLeave={onSwitchHover ? () => onSwitchHover(false) : undefined}
          >
            {metric.options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={metric.value === o.id}
                className={`rpt-pill${metric.value === o.id ? ' on' : ''}`}
                onClick={() => metric.onChange(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {projections.map((projection) => (
          <div className="rpt-pills" role="group" aria-label={projection.label || 'Projection'} key={projection.id}>
            {projection.options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={projection.value === option.id}
                className={`rpt-pill${projection.value === option.id ? ' on' : ''}`}
                onClick={() => projection.onChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ))}
        {mapping && (
          // The panel's own control (ThirdPartyPanel.jsx:213-231) and its own class — a
          // native select, offered only where there is a choice to make. It is NOT a
          // switch in the §6 sense: it changes which mapping is compared, not which
          // number is read, so it takes no part in the hover highlight.
          <select
            className="tp-mapping-select"
            aria-label="Mapping"
            value={mapping.value || ''}
            onChange={(e) => mapping.onChange(e.target.value)}
          >
            {mapping.options.map((entity) => (
              <option key={entity.id} value={entity.id}>{entity.name || 'Untitled mapping'}</option>
            ))}
          </select>
        )}
        {period && (
          <span className="wgf-per rpt-per" title="Period for this widget only.">
            {period.options.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period.value === value}
                className={`rpt-chip${period.value === value ? ' on' : ''}`}
                onClick={(e) => { e.stopPropagation(); period.onChange(value); }}
              >
                {RANGE_LABEL[value] || value}
              </button>
            ))}
          </span>
        )}
        {windowNote && (
          // A widget pinned to a FIXED window says so, quietly (section view rows §4). It sits
          // where a period control would sit, and it is deliberately not one: a `span`, no
          // handler, no pressed state, no accent — a viewer must never read these numbers as
          // the dashboard's own window, and must never press this expecting to change it.
          // The two never appear together: §6 refuses a spec period beside a Period switch.
          <span className="rpt-win" title={windowNote.tip}>
            <span className="rpt-win-l">Window</span>
            {/* The space rides in the TEXT, the rule every chip on this row follows: the two
                spans are flex items, so the 6px gap draws the separation and a whitespace-only
                item is not rendered at all — while anything reading `textContent`, a screen
                reader included, gets «Window 7d» rather than «Window7d». */}
            {' '}
            <span className="rpt-win-v">{windowNote.label}</span>
          </span>
        )}
        {cuts.length > 0 && (
          // One dimension controls every bound view. Keep native toggle buttons: these
          // change the data grain rather than navigate between separate tab panels.
          <span
            className="rpt-dimension rpt-dims"
            role="group"
            aria-label={dimension.label || 'Break down by'}
          >
            <span className="rpt-dimension-label">{dimension.label || 'Break down by'}</span>
            {cuts.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`rpt-dim-tab${repeatedCutLabels.has(o.label) && o.note ? ' rpt-dim-tab--qualified' : ''}${dimension.value === o.key ? ' on' : ''}`}
                aria-pressed={dimension.value === o.key}
                aria-label={o.note ? `${o.label} ${o.note}` : o.label}
                title={o.note ? `${o.label} · ${o.note}` : o.label}
                onClick={() => dimension.onChange(o.key)}
              >
                <span>{o.label}</span>
                {/* Sources may give different axes the same label. Their qualifiers stay
                    visible before selection, including on touch screens without hover. */}
                {repeatedCutLabels.has(o.label) && o.note && (
                  <span className="rpt-dim-source">{` · ${o.note}`}</span>
                )}
              </button>
            ))}
          </span>
        )}
        {dims.length > 0 && (
          <span className="tp-dims-row rpt-dims">
            <span className="tp-dims-label">{breakdown.label || 'Break down by'}</span>
            {dims.map((d) => {
              const on = selected.indexOf(d.id) !== -1;
              // The N+1-th chip is DISABLED and says why (UX DNA §1.1.3 — never hidden,
              // never silently broken): the cap is the author's, and a viewer who cannot
              // press a chip is owed the reason.
              const full = !on && cap != null && selected.length >= cap;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`tp-dim-chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={full || undefined}
                  title={full
                    ? `This widget compares up to ${cap} ${cap === 1 ? 'dimension' : 'dimensions'} at a time. Turn one off first.`
                    : undefined}
                  onClick={() => breakdown.onToggle(d.id)}
                >
                  {d.name}
                </button>
              );
            })}
          </span>
        )}
        {runs.length > 0 && (
          // What the source covers, at the RIGHT edge of the row and above the numbers it
          // qualifies — the panel's own placement (ThirdPartyPanel.jsx:513-520). Each run is
          // its own span with a gap between them: the freshness and the scope are two
          // readings, and joining them makes one chain that reads as a single sentence.
          <span className="rpt-meta">
            {runs.map((run) => <span key={run} className="rpt-meta-run">{run}</span>)}
          </span>
        )}
        {search && <input type="text" className="text-11 rpt-find-in rpt-ctl-search"
          value={search.query} placeholder="Filter segments..." aria-label={`Filter ${search.rowLabel} rows`}
          onChange={(event) => search.onChange(event.target.value)} />}
      </div>
      )}
      {/* Reserve one quiet line only for switches with source hints. Changing the selected
          source, including to an option without a hint, must not move the views below. */}
      {hasCutNotes && <div className="rpt-dim-note" title={cutNote || undefined}
        aria-hidden={!cutNote || undefined}>{cutNote}</div>}
      {notes.map((n) => <div key={n} className="rpt-note">{n}</div>)}
    </div>
  );
}

/* ── rows (section view rows, spec 2026-08-27 §2) ─────────────────────────── */

/**
 * The views, grouped into the ROWS they are drawn on: `[[0], [1, 2], [3]]`.
 *
 * The grouping is the AUTHOR's, read straight off the stored marks and never guessed — a
 * `besideNext` on view i says i and i+1 share a line, and a chain of them is one row of
 * three. Nothing about the data, the kinds or the widths enters this: two pies sit side by
 * side because somebody said so, and two charts stack because nobody did.
 *
 * The `i + 1 < views.length` guard is what closes a row a hand-made spec could leave open.
 * `normReport` refuses that spec and the builder's mutators can never write one, so this is
 * belt rather than brace — but a renderer that trusted the mark would fall off the end of
 * the list, and a tile that cannot draw is worse than a tile that ignores one key.
 *
 * PRIVATE: the grouping is a fact about how this file draws, and the suite reads it off the
 * rendered tree. An export earns its line when a second surface needs the answer.
 */
function viewRows(views) {
  const rows = [];
  let row = [];
  for (let i = 0; i < views.length; i++) {
    row.push(i);
    if (views[i] && views[i].besideNext === true && i + 1 < views.length) continue;
    rows.push(row);
    row = [];
  }
  return rows;
}

/**
 * How a view behaves inside a shared row.
 *
 * A pie and a KPI are read at their OWN size: a donut has a diameter, a KPI is one number
 * and a caption, and stretching either across half a band only moves whitespace around. A
 * chart, a table, a comparison and a Layout are read ACROSS the width they are given, so
 * they take what is left (`flex: 1`, `min-width: 0`, and their own horizontal overflow —
 * a wide table scrolls inside its cell rather than pushing the tile sideways).
 */
const CELL_FIT_KINDS = ['pie', 'kpi'];
const cellClass = (view) => `rpt-cell rpt-cell--${CELL_FIT_KINDS.includes(view && view.kind) ? 'fit' : 'grow'}`;

/* ── the body ─────────────────────────────────────────────────────────────── */

/**
 * What the EDITOR prints in the slot of a view the dashboard omits — one sentence per reason,
 * because `viewShown` (report-render.js) drops a view for two different ones and «campaign
 * basis» names nothing the author set on a table: a KPI carries a `basis` the author chose
 * and the campaign has no line items for; the Breakdown's conversions TABLE is simply read
 * from a mart this pacing has no rows in.
 */
const hiddenWhy = (view) => (view && view.kind === 'table'
  ? 'Not shown: this pacing records no conversions'
  : 'Not shown for the current campaign basis');

/** A view that cannot draw, saying why in its own slot — the neighbours are untouched. It
 *  is NOT WidgetErrorState: that one opens with "Formula error:" and sends the reader to a
 *  formula, and a dimension source that was deleted is neither. */
function ViewProblem({ view, message }) {
  return (
    <div className="rpt-view">
      {view?.title ? <div className="text-11 rpt-view-title">{view.title}</div> : null}
      <div className="rpt-state">{message}</div>
    </div>
  );
}

/**
 * ReportBody — the tile without the store: the frame, the controls row and the views.
 *
 * Everything arrives on props (`data` is `useWidgetData`'s answer, `cm` is the CM360 bundle
 * or null, `controls` is useReportControls' return), which is what lets the layout preview,
 * the gallery miniature and the host suite render exactly what a dashboard renders.
 */
export function ReportBody({
  widget, spec, controls, data, cm = null, preview = false, menu = null, maxHeightPx = null,
  heightPx = null, journalHighlight = null, layoutCtx = null,
  onState = null, onOpenMapping = null, filterPick = null, editor = null,
}) {
  spec = upgradeConversionDefaults(spec);
  const [hovered, setHovered] = useState(false);
  const onSwitchHover = useCallback((on) => setHovered(!!on), []);
  // The bundle arrives MASKED: `useReportCm360` applies the dimension/platform filter itself,
  // so the views here, the Layout blocks reading `layoutCtx.cmRead` and the Builder preview
  // read one bundle rather than three maskings of it (§2.7). A caller that drives this body
  // directly masks its own fixture, through `maskCm360Filters`.
  const profile = ['card', 'chart', 'table', 'section'].includes(widget && widget.profile)
    ? widget.profile : 'section';
  const stored = useMemo(() => (spec && Array.isArray(spec.views) ? spec.views : []), [spec]);
  // The views this pacing HAS a reading for (§5.3's `basis`; section-widget parity). A KPI
  // cell that names a basis the campaign has nothing on is not drawn at all — the legacy
  // Targets band asks the same four questions on every render, which is how it grows an ACR
  // cell the day a pacing adds its first audio line.
  //
  // Filtered HERE, before `viewRows` groups them: the row marks are the author's and they are
  // read off the list that survives, so a dropped cell leaves no gap in the band. Everything
  // below indexes into this list — the models, the dimension-source states, the row marks —
  // so there is exactly one answer to «which views is this tile drawing».
  const composition = stored.some((view) => view?.kind === 'container' || view?.kind === 'atom');
  const visibleTree = useMemo(() => {
    let count = 0;
    const keep = (list, depth = 1) => depth > LIMITS.compositionDepth ? [] : (Array.isArray(list) ? list : []).slice(0, LIMITS.compositionNodes).flatMap((view) => {
      if (!view || typeof view !== 'object' || ++count > LIMITS.compositionNodes) return [];
      if (!viewShown(view, data)) {
        // The dashboard still omits an inapplicable basis-bearing KPI. In the editor the
        // authored node must remain selectable, so it travels only through this transient
        // render tree with the reason the canvas should show in its place.
        return preview && editor
          ? [{ ...view, editorHidden: hiddenWhy(view) }]
          : [];
      }
      if (view.kind !== 'container') return [view];
      const children = keep(view.children, depth + 1);
      return children.length || (preview && editor) ? [{ ...view, children }] : [];
    });
    return keep(stored);
  }, [stored, data, preview, editor]);
  const views = useMemo(() => leafViews(visibleTree), [visibleTree]);
  // …and, when that leaves nothing, which of the two sentences below is the true one. The
  // line-item set is the question a viewer can act on, so it is asked directly rather than
  // guessed from which basis dropped: with no lines in scope EVERY basis is empty, the
  // campaign one included.
  const noLinesInScope = !(data && data.sources && data.sources.effLIs
    && data.sources.effLIs.length);
  const { controlState, setBreakdown, focusedIn, toggleFocus, pickMapping } = controls;

  // The charts a declared `tupleFocus` points at (§5.6: never implicit — a view listens to
  // another only because the spec says so). `focusTargetsOf` is the one function report-render.js
  // exports for this, beside `attachCmData` — formula-preview.js reads the same one.
  const focusTargets = useMemo(() => focusTargetsOf(spec), [spec]);

  const campCtx = useMemo(
    () => (data ? scopedCampCtx(data.sources, data.sources && data.sources.asOf) : null),
    [data],
  );
  // The SAME question the tile asked to build the projection (`useReportCm360`), asked again
  // by the half that draws: one function, one focus state, one generation. A focus picked
  // inside a comparison that is no longer on screen is simply not a focus.
  const focusedKey = cm ? focusedIn(cm.gen) : null;

  const models = useMemo(() => views.map((view) => {
    if (!data || view.kind === 'compare') return null;
    let model = null;
    if (view.kind === 'chart') model = buildReportChartModel(view, spec, controlState, data, campCtx);
    else if (view.kind === 'table') model = buildReportTableModel(view, spec, controlState, data, campCtx);
    else if (view.kind === 'kpi') model = buildReportKpiModel(view, spec, controlState, data, campCtx);
    else if (view.kind === 'pie') model = buildReportPieModel(view, spec, controlState, data, campCtx);
    // The projection pick is the TILE's question, not the attach's, so it is asked ABOVE the
    // pending guard: a highlight on a model that never went pending — a BQ column with a
    // `cmIm` threshold — still needs the comparison this view is looking at.
    const ready = !!(cm && cm.status && cm.status.modelReady);
    const projection = ready
      ? ((focusedKey && focusTargets.has(view.id)) ? cm.focusedProjection : cm.projection)
      : null;
    // The CM360 half is attached only once the comparison is one: a projection built over a
    // mapping that classifies nothing, or over a file that never landed, has numbers of a
    // sort — all of them zero — and attaching those would print a measured 0 where the
    // model's own null prints the placeholder.
    if (model && model.cmPending && ready) {
      model = attachCmData(model, cm.dataset, projection, view);
    }
    // ONE reader instance per projection × dataset (`cmReaderFor`'s WeakMap), so the numbers
    // the attach drew and the numbers the rules compare against cannot come from two
    // different comparisons — a focused chart with an unfocused paint is the failure this
    // prevents, and it looks entirely plausible on screen.
    return applyReportHighlights(view, model, spec, controlState, data, campCtx,
      ready ? cmReaderFor(cm.dataset, projection) : null);
  }), [views, spec, controlState, data, campCtx, cm, focusedKey, focusTargets]);

  // A dimension SOURCE that is gone is this view's own state, named (dim-sources-norm.js).
  // Asked of the dimension the viewer is CURRENTLY on: a control-bound grain moves with the
  // switch, so a source that is gone has to be named for the cut on screen and not for the
  // one the author happened to store first.
  const missing = useMemo(() => views.map((view) => (data
    ? (dimSourceMissingReason(reportDimKey(view, spec, controlState), data.sources.dimSourceConfigs, data.sources.dimSources)
      || sourceFilterReason(data.sources, reportDimKey(view, spec, controlState), data.range))
    : null)), [views, spec, controlState, data]);

  const pairedPies = useMemo(() => {
    const pairs = new Map();
    const indices = new Map(views.map((view, index) => [view.id, index]));
    const readRow = (row) => {
      for (let i = 0; i + 1 < row.length; i++) {
        const a = indices.get(row[i].id), b = indices.get(row[i + 1].id);
        if (missing[a] || missing[b]) continue;
        const pair = pieTablePair(row[i], row[i + 1], spec, controlState, models[a], models[b]);
        if (pair) { pairs.set(pair.pieId, pair); i++; }
      }
    };
    if (!composition) viewRows(views).forEach((row) => readRow(row.map((i) => views[i])));
    else {
      const visit = (nodes) => nodes.forEach((node) => {
        if (node.kind !== 'container') return;
        if (node.direction === 'row' && node.distribution === 'content') readRow(node.children || []);
        visit(node.children || []);
      });
      visit(visibleTree);
    }
    return pairs;
  }, [composition, views, visibleTree, spec, controlState, models, missing]);

  // One coordinated pair uses the tile's existing controls row. Multiple pairs
  // retain independent searches beside their own tables.
  const onlyPair = pairedPies.size === 1 ? pairedPies.values().next().value : null;
  const sharedSearchKey = onlyPair?.tableModel.search
    ? `${onlyPair.pieId}:${onlyPair.tableId}:${onlyPair.tableModel.rowDimension}` : null;
  const [sharedQuery, setSharedQuery] = useState(() => ({ key: sharedSearchKey, query: '' }));
  useEffect(() => {
    setSharedQuery((current) => current.key === sharedSearchKey ? current : { key: sharedSearchKey, query: '' });
  }, [sharedSearchKey]);
  const sharedSearch = sharedSearchKey ? {
    query: sharedQuery.key === sharedSearchKey ? sharedQuery.query : '',
    rowLabel: onlyPair.tableModel.rowLabel,
    onChange: (query) => setSharedQuery({ key: sharedSearchKey, query }),
  } : null;

  const noFacts = useMemo(() => !!(data
    && reportShowsEmptyWithoutFacts(spec, controlState)
    && !reportWindowHasFacts(spec, data.sources, data.range)), [data, spec, controlState]);

  // The dimension switch's chips: the STORED options, each named the way the tile names a
  // dimension anywhere else. Nothing is derived from the DATA here, deliberately — that is
  // the legacy tab bar's own guard, carried over: its tabs are read off the unfiltered
  // aggregate so that clicking a row can never delete the tab it was clicked in. A stored
  // list is that guard taken all the way, and no filter can remove a chip.
  // …each with the second line the legacy tab bar carries, which is the one place a reader
  // learns that «Creative (tag)» and «Creative (asset)» read different data.
  const cutChips = useMemo(() => (controls.dimension && data ? {
    ...controls.dimension,
    options: controls.dimension.options.map((key) => ({
      key, label: dimensionLabel(key, data.sources), note: dimensionNote(key, data.sources),
    })),
  } : null), [controls.dimension, data]);

  // Which view can be clicked to FILTER, and by what (section-widget parity 2026-09-04). The
  // tile owns this, not the views: the URL is store-coupled and `ReportTable` / `ReportPie` are
  // props-only, which is the property they are built on. Per view, because a widget may hold a
  // table on one cut beside a ring on another.
  const picks = useMemo(() => views.map((view) => {
    if (!filterPick || !view.filterOnClick) return null;
    const dim = reportDimKey(view, spec, controlState);
    // A cut nothing on the facts carries cannot be filtered by: the pair would match nothing
    // and would quietly demote a live audience filter from Scope to Lens.
    if (!dim || FILTERABLE_DIMS.indexOf(dim) === -1) return null;
    const prefix = `${dim}:`;
    const active = new Set((filterPick.pairs || [])
      .filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)));
    return { dim, active, onPick: (label) => filterPick.onPick(dim, label) };
  }), [views, spec, controlState, filterPick]);

  // …and the metric switch's, on the same terms (fix round 1): the STORED options, each named
  // the way this tile names the number it will put in the header. An auto option label is §2's
  // caption, and on `cpm`/`dc`/`vcr` that caption follows the PACING — so a chip named without
  // the wording read «CPM» while the column it drives read «DSP CPM». A legend and a column
  // header on one dashboard may not call one number two things, and neither may a chip and the
  // column it moves. A typed label is the author's and is never re-derived.
  //
  // The memo hangs off the STORED options and not off `controls.metric`, which the hook mints
  // fresh every render: the pick moves with a click and the names do not.
  const storedOptions = controls.metric ? controls.metric.options : null;
  const switchOptions = useMemo(() => {
    if (!storedOptions) return null;
    const wording = pacingWording(data && data.sources, campCtx);
    return storedOptions.map((o) => ({
      id: o.id,
      label: o.labelAuto ? autoLabel(resolveValue(o.value, spec, null), null, wording) : o.label,
    }));
  }, [storedOptions, spec, data, campCtx]);
  const switchChips = controls.metric ? { ...controls.metric, options: switchOptions } : null;

  // WHICH dimensions the chips show as on: `selectComparisonDims` again, the same call the
  // tile made to build the projection (a null selection means "the runtime default", and the
  // chips have to light the same two dimensions the comparison actually ran over).
  const selectedDimIds = useMemo(() => (cm
    ? selectComparisonDims(cm.dims, { selectedDimIds: controlState.breakdownIds, maxSelected: cm.maxSelected })
      .dims.map((d) => d.id)
    : []), [cm, controlState.breakdownIds]);

  // A chip toggles against the EFFECTIVE selection, so the first click on a default-selected
  // dimension turns it off rather than adding it a second time. Turning the last one off
  // stores `[]` — an explicit "no breakdown", which is not the same as following the default.
  const toggleDim = useCallback((id) => {
    const on = selectedDimIds.indexOf(id) !== -1;
    setBreakdown(on ? selectedDimIds.filter((x) => x !== id) : [...selectedDimIds, id]);
    // The focus is not cleared here: the generation it was picked under carries the
    // breakdown, so a changed breakdown is already a different comparison (§5.6).
  }, [setBreakdown, selectedDimIds]);

  // WHETHER there is a mapping to pick at all, and out of what. Two conditions, both the
  // panel's (ThirdPartyPanel.jsx:213): the widget left the choice to the viewer — a `fixed`
  // binding is the author's decision and §7.7 does not let a viewer overrule it — and the
  // pacing carries more than one dimensions-kind mapping. One entity is not a choice.
  const mappingPicker = useMemo(() => {
    const choice = cm && cm.status && cm.status.mappingChoice;
    if (!choice || choice.mode !== 'runtime' || choice.available <= 1) return null;
    return {
      options: choice.entities,
      value: choice.entity ? choice.entity.id : '',
      onChange: pickMapping,
    };
  }, [cm, pickMapping]);

  // The comparison's own meta, drawn by the TILE (section-widget parity 2026-09-04): when the
  // CM360 file was read, how far it has common days, and how much of the pivot is two-sided.
  // The panel keeps these two runs in its header, ABOVE the numbers they qualify — «data
  // through Jul 9» is what explains the CM360 line diving to zero the day after, and at the
  // foot of a long comparison it is off screen and in the smallest type on the tile.
  //
  // The projection is the one on SCREEN, focus included: under a row focus «data through» has
  // always been that tuple's own last common day, and moving where the line is drawn may not
  // change what it says.
  //
  // Only on a tile that HOLDS a comparison. A delivery widget with a cm column has no pivot,
  // so «3 slices compared» would describe something it never draws; its CM360 state is the
  // `tileNote` further down.
  const compareMeta = useMemo(() => {
    if (!cm || !cm.status || !cm.status.modelReady) return [];
    if (!views.some((view) => view.kind === 'compare')) return [];
    return compareMetaRuns({
      dataset: cm.dataset,
      projection: focusedKey ? cm.focusedProjection : cm.projection,
      status: cm.status,
    });
  }, [cm, views, focusedKey]);

  // A comparison that cannot draw offers nothing to press — the panel's own rule
  // (ThirdPartyPanel.jsx:437-477): the sentence stands alone and only the mapping picker
  // survives, because switching to another mapping is how a viewer reaches a comparison that
  // CAN draw. Three live-looking pills over a tile with nothing to show change nothing when
  // pressed (third-party audit row 2).
  //
  // Scoped to a tile whose only view IS the comparison: where a delivery view sits beside it,
  // that same metric switch still moves the delivery numbers, and taking it away would break
  // a view that is perfectly fine.
  const cmDead = views.length === 1 && views[0].kind === 'compare'
    && !!cm && !(cm.status && cm.status.modelReady);

  // What this tile knows and the BUILDER above it cannot see (§9, P3 T11). Only under
  // `preview` — a dashboard tile has nobody listening, and firing there would be a callback
  // into whatever mounted it. It only REPORTS: nothing in this effect writes to the store,
  // to the widget or to the draft. The deps are the two primitives, so a report is sent when
  // the answer changes and not on every render.
  const pv = previewState({ noFacts, missing, cm });
  useEffect(() => {
    if (!preview || !onState) return;
    onState({ zeroResult: pv.zeroResult, sourceUnavailable: pv.sourceUnavailable });
  }, [preview, onState, pv.zeroResult, pv.sourceUnavailable]);

  // The legacy convention every widget tile follows: nothing is drawn until the store has
  // the campaign. A frame around a skeleton would only be a second empty box.
  if (!data) return null;

  const notes = [];
  // T9's join rule, said where the control that breaks it lives: a CM360 column on dimension
  // rows joins the tuple the breakdown prints, and a two-dimension tuple ("US · Video") is a
  // row no single-dimension table carries.
  const widerBreakdown = selectedDimIds.length > 1 && views.some((view, i) => {
    const model = models[i];
    if (!model) return false;
    // The RESOLVED grain, off the model: a control-bound one is a dimension at render time,
    // and it is the grain that was drawn that has nothing to join a two-dimension tuple to.
    if (view.kind === 'table') return model.rowType === 'dim' && model.columns.some((c) => c.cm);
    if (view.kind === 'chart') return model.xType === 'dim' && model.series.some((s) => s.cm);
    return false;
  });
  if (widerBreakdown) {
    notes.push('While more than one dimension is selected, CM360 columns on dimension rows have no single row to join and stay empty.');
  }

  // A comparison that is not ready says so ON THE TILE when no compare view is there to say
  // it — otherwise the delivery views' empty CM360 columns would have no explanation at all.
  const cmSentence = cm ? compareStateSentence(cm.status) : null;
  const hasCompareView = views.some((v) => v.kind === 'compare');
  const tileNote = (!hasCompareView && cmSentence)
    ? (cm?.status?.state === 'unsupportedFilters' ? cmSentence : `CM360: ${cmSentence}`) : null;

  // §4's honesty note: this widget reads its OWN window, and no control on it says which.
  // `spec.period` is a stored range and there is no Period switch — the grammar refuses that
  // pair (SWITCH_NO_SPEC_PERIOD), so the second conjunct is belt, and it is what keeps this
  // from ever appearing beside a chip row that contradicts it. A viewer who cannot see the
  // window reads a 7d number under a dashboard set to the flight and has no way to know.
  const windowWord = typeof (spec && spec.period) === 'string'
    ? (RANGE_LABEL[spec.period] || spec.period) : null;
  const fixedWindow = (windowWord && !controls.period)
    ? {
      label: windowWord,
      tip: `This widget always reads its own ${windowWord} window, whatever the dashboard filter is set to.`,
    }
    : null;

  // Only suppress an explanation already shown by the adjacent sibling. A populated
  // neighbor, another failure or a nested container cannot explain this empty view.
  const emptyReason = (view, i) => {
    if (missing[i]) return missing[i];
    const model = models[i];
    if (view?.kind === 'table' && model && !model.rows.length)
      return model.emptyNote || "No rows yet: nothing matches this table's scope";
    if (view?.kind === 'pie' && model && !model.slices.length)
      return Object.values(model.errors || {})[0] || model.emptyNote || 'No data for selected filters';
    return null;
  };
  const renderView = (view, i, previous = null, presentation = null) => {
    const reason = emptyReason(view, i);
    const previousIndex = previous ? views.findIndex((candidate) => candidate.id === previous.id) : -1;
    const quiet = !!reason && previousIndex >= 0 && emptyReason(previous, previousIndex) === reason;
    if (missing[i]) return <ViewProblem view={view} message={quiet ? '' : missing[i]} />;
    if (view.kind === 'compare') {
      return (
        <ReportCompare
          view={view}
          // No `dataset`: the one thing this view read it for was the coverage line, which
          // the control row draws now (`compareMeta` above).
          projection={cm && (focusedKey ? cm.focusedProjection : cm.projection)}
          status={cm && cm.status}
          metric={(cm && cm.metric) || 'impressions'}
          focusedKey={focusedKey}
          // Unreachable without a bundle (a compare view needs the CM360 dataset the
          // grammar demands), and it costs one guard to keep it that way.
          onFocusRow={cm ? (key) => toggleFocus(key, cm.gen) : null}
          // The Unmapped row's way out (CompareTable.jsx:293-315) — the tile's, because
          // opening the drawer is the dashboard's business and not a view's.
          onOpenMapping={onOpenMapping}
        />
      );
    }
    const model = models[i];
    if (view.kind === 'chart') return (
      <ReportChart
        view={view}
        model={model}
        heightPx={heightPx || CHART_H[profile]}
        journalHighlight={journalHighlight}
      />
    );
    if (view.kind === 'table') return (
      <ReportTable
        view={view}
        model={model}
        maxHeightPx={heightPx || TABLE_MAX[profile]}
        pick={picks[i]}
        quietEmpty={quiet}
        paired={presentation}
      />
    );
    if (view.kind === 'kpi') return <ReportKpi view={view} model={model} />;
    if (view.kind === 'pie') return (
      <ReportPie view={view} model={model} heightPx={presentation ? 180 : PIE_H[profile]} pick={picks[i]} quietEmpty={quiet}
        paired={!!presentation} hideNote={!!presentation && model.note === presentation.pair.tableModel.note} />
    );
    if (view.kind === 'layout') return <ReportLayout view={view} ctx={layoutCtx} compact={preview} />;
    return null;
  };

  const renderPair = (pie, table, renderNode) => {
    const pair = pairedPies.get(pie?.id);
    if (!pair || pair.tableId !== table?.id) return null;
    return <ReportPieTable key={pie.id} pair={pair} search={sharedSearch}>
      {(search) => <>
        {renderNode(pie, { ...search, pair, role: 'pie' })}
        {renderNode(table, { ...search, pair, role: 'table' })}
      </>}
    </ReportPieTable>;
  };

  // What the tile says under its own name: the window a date table covers, and how many line
  // items are in it (section-widget parity 2026-09-04). The legacy sections carry this in
  // their title band, and it is the first thing a reader checks against the filter bar. Off
  // the FIRST view that has one — a tile holding two tables says it once, about the table a
  // reader meets first, and every other grain answers null.
  const subtitle = models.reduce((found, m) => found || (m && m.rangeNote) || null, null);

  return (
    <WidgetFrame widget={widget} badge={V2_BADGE} preview={preview} menu={menu} flush note={tileNote} subtitle={subtitle}>
      <div
        className={`rpt rpt--${profile}${hovered ? ' rpt--hl' : ''}`}
        style={maxHeightPx ? { maxHeight: `${maxHeightPx}px`, overflow: 'hidden' } : undefined}
      >
        <ReportControls
          // Gone while the comparison cannot draw: on a tile that is only a comparison the
          // switch moves nothing, and a live-looking pill that answers nothing is worse than
          // no pill. The mapping picker below is deliberately not covered by this.
          metric={cmDead ? null : switchChips}
          projections={preview
            ? (controls.projections || []).map((control) => ({ ...control, onChange: () => {} }))
            : controls.projections}
          // Offered only where there is a choice: more than one dimensions-kind mapping on
          // the pacing, and a widget that left the choice to the viewer. A `fixed` binding
          // is the author's decision (§7.7) and a viewer control would overrule it.
          mapping={mappingPicker}
          // A PREVIEW surface may show the chips — they are part of what the tile looks
          // like — but it may not WRITE through them: the period lane persists for
          // everyone (WidgetFrame's own `preview` rule, and the 2026-07-28 incident it
          // was born from). The metric and the breakdown are ephemeral viewer state and
          // need no such guard. Layout mode's `inert` and the thumbnail's dead pointer
          // events are the belt; this is the brace, and it is the one that cannot be
          // undone by a CSS change.
          period={preview && controls.period ? { ...controls.period, onChange: () => {} } : controls.period}
          // Shown on EVERY surface, `preview` included: it is the honesty feature, and a
          // builder preview that hid the widget's own window would be the one screen where
          // the author cannot see what they pinned.
          windowNote={fixedWindow}
          // The stored option list, each key with the word this pacing calls it — the one
          // read of the config a chip row needs, made here where `data.sources` is, so
          // `ReportControls` stays as store-free as the views below it.
          dimension={cutChips}
          breakdown={!cmDead && controls.breakdownControl && cm ? {
            label: controls.breakdownControl.label,
            dims: cm.dims,
            selectedIds: selectedDimIds,
            maxSelected: cm.maxSelected,
            onToggle: toggleDim,
          } : null}
          // The source runs at the right edge. Empty on every state that draws no comparison,
          // so a tile saying «CM360 pull failed» carries no freshness stamp beside it.
          meta={compareMeta}
          notes={notes}
          onSwitchHover={onSwitchHover}
          search={sharedSearch}
        />
        {views.length === 0 && !(composition && preview && editor && visibleTree.length) ? (
          // Every view is out of scope — on the Targets band that usually means the filter
          // left no line items to read. The legacy block hides itself here; a tile cannot, so
          // it says the one thing there is to say instead of drawing a card of zeros.
          //
          // FIRST, ahead of the window's own empty state: with no line items in scope there
          // is no window question to answer, and «no delivery data in this period» would send
          // the reader looking at the wrong control.
          <div className="rpt-slot">
            <div className="rpt-state rpt-state--line">{noLinesInScope ? NO_LINES : NO_BASIS}</div>
          </div>
        ) : noFacts ? (
          <div className="chart-panel__body" style={{ height: CHART_H[profile] }}>
            <div className="chart-panel__empty">{NO_FACTS}</div>
          </div>
        ) : composition ? (
          <div className="rpt-slot cmp">
            <ReportComposition nodes={visibleTree} ctx={layoutCtx} editor={preview ? editor : null}
              nodeProps={(view) => view.kind === 'container' ? {} : ({ 'data-sw': viewFollowsSwitch(view) ? '1' : '0' })}
              renderPair={renderPair}
              renderLeaf={(view, { previous, presentation }) => renderView(view, views.findIndex((candidate) => candidate.id === view.id), previous, presentation)} />
          </div>
        ) : viewRows(views).map((row) => (
          // One SLOT per row, so the hairline between two bands is unchanged, and inside a
          // shared row one CELL per view. A row of one keeps exactly the markup a v2 tile
          // has always had — the switch-hover marker included, which is why `data-sw` sits
          // on the element that IS the view's box in both shapes.
          <div
            key={views[row[0]].id}
            className={row.length > 1 ? 'rpt-slot rpt-row' : 'rpt-slot'}
            data-sw={row.length > 1 ? undefined : (viewFollowsSwitch(views[row[0]]) ? '1' : '0')}
          >
            {row.length > 1
              ? row.flatMap((i, at) => {
                if (at > 0 && pairedPies.get(views[row[at - 1]].id)?.tableId === views[i].id) return [];
                const pair = renderPair(views[i], views[row[at + 1]], (view, presentation) => {
                  const index = view.id === views[i].id ? i : row[at + 1];
                  return <div key={view.id} className={cellClass(view)} data-pie-table={presentation.role}
                    data-sw={viewFollowsSwitch(view) ? '1' : '0'}>
                    {renderView(view, index, presentation.role === 'table' ? views[i] : null, presentation)}
                  </div>;
                });
                if (pair) return [pair];
                return [<div
                    key={views[i].id}
                    className={cellClass(views[i])}
                    data-sw={viewFollowsSwitch(views[i]) ? '1' : '0'}
                  >
                    {renderView(views[i], i, at > 0 ? views[row[at - 1]] : null)}
                  </div>];
              })
              : renderView(views[row[0]], row[0])}
          </div>
        ))}
      </div>
    </WidgetFrame>
  );
}

/**
 * ReportWidget — the tile as a dashboard renders it.
 *
 * `widget` is the RESOLVED widget (a linked instance arrives carrying its library entry's
 * spec), which is why the spec is read straight off it and nothing here resolves a ref.
 */
function ReportWidget({
  widget: storedWidget, preview = false, menu = null, maxHeightPx = null, heightPx = null, onState = null, editor = null,
  onFormulaRuntime = null,
}) {
  // The pre-step (sections cutover 2026-09-07, spec §4): a stored auto switch becomes a concrete
  // list HERE, once, before useReportControls, useWidgetData and every model read the spec.
  // `widget` below is the resolved one, so nothing further down learns a second spelling.
  const inventory = useAutoInventory(storedWidget && storedWidget.spec);
  const spec = useMemo(
    () => resolveAutoControls(upgradeConversionDefaults(storedWidget && storedWidget.spec), inventory),
    [storedWidget, inventory],
  );
  const widget = useMemo(
    () => (storedWidget && spec !== storedWidget.spec ? { ...storedWidget, spec } : storedWidget),
    [storedWidget, spec],
  );
  const controls = useReportControls(widget, spec);
  // Decision 6, plumbed: the resolved window is an ARGUMENT, so this tile never re-reads the
  // store for its period — which is also §6's normative preview plumbing.
  const data = useWidgetData(widget, controls.rangeOverride);
  // ABOVE `layoutCtx`, and the order IS the dependency: a Layout block reads CM360 through
  // `layoutCtx.cmRead`, so the bundle has to exist before the context memo is built (§2.7).
  // Both calls are unconditional, so moving one past the other moves nothing else: the hook
  // order a render walks is still fixed.
  const cm = useReportCm360(
    spec, controls.controlState, controls.breakdownControl, data, controls.focusedIn,
    controls.mappingPick,
  );
  // A non-composed Layout block reads its campaign metrics off the store selector, and they
  // must stand on the tile's OWN window: its Period switch moves `data` (the formula binds —
  // a progress bar's `planImpr` target), so `cm` (the same bar's tick, `imprExpected`) has to
  // move with it, plan rule included (2026-09-23). `data.campRange` is that window as a
  // filter patch; null follows the global filter, as before.
  const { filters: pageFilters } = useFilters();
  const layoutCmFilters = useMemo(
    () => (data && data.campRange ? { ...pageFilters, ...data.campRange } : null),
    [pageFilters, data],
  );
  const layoutCm = useCampMetrics(layoutCmFilters);
  const layoutFlCm = useFullFlightMetrics();
  const layoutEffLIs = useEffLIs();
  const layoutFacts = useFacts();
  const layoutCampaign = useCampaign();
  const layoutLiPlan = useLiPlan();
  // Primary conversions (spec 2026-09-13 §7): the rate rows note is drawn only while operative.
  const layoutPrimaryCv = useDashboardStore(selectPrimaryCvOperative);
  const layoutCtx = useMemo(() => {
    const currency = layoutCampaign?.currency || 'USD';
    const rate = layoutCampaign?.rate != null ? Number(layoutCampaign.rate) : 1;
    const composed = flattenViews(spec?.views).some((view) => view?.kind === 'atom' || view?.kind === 'container');
    // The UNFOCUSED projection, deliberately (§2.7): a block is a window number, and a row
    // focus picked inside a comparison two views up may not silently turn it into a reading
    // of one tuple. The reader is offered only once the comparison IS one, which is the gate
    // `models` takes before `attachCmData`: a projection over a file that never landed is all
    // zeros, and a block has to draw the dash instead. `cmPendingRead` is that fact said on
    // the context, for the block and the preview that have to explain the dash.
    const cmRead = (cm && cm.status && cm.status.modelReady) ? cmReaderFor(cm.dataset, cm.projection) : null;
    const cmPendingRead = !!cm && !cmRead;
    if (composed) return compositionContext(data, {
      currency, rate, converted: Currency.isConverted(currency, rate), compact: preview,
      cmRead, cmPendingRead,
      primaryCvOperative: layoutPrimaryCv,
    });
    return {
      cm: layoutCm,
      flCM: layoutFlCm,
      effLIs: layoutEffLIs,
      facts: layoutFacts,
      data,
      compact: preview,
      currency,
      rate,
      converted: Currency.isConverted(currency, rate),
      coefMode: coefModeOf(layoutLiPlan),
      netMode: netModeOf(layoutLiPlan),
      cmRead,
      cmPendingRead,
      primaryCvOperative: layoutPrimaryCv,
    };
  }, [layoutCm, layoutFlCm, layoutEffLIs, layoutFacts, data, preview, layoutCampaign, layoutLiPlan, spec, cm, layoutPrimaryCv]);
  const campCtx = useMemo(
    () => (data ? scopedCampCtx(data.sources, data.sources && data.sources.asOf) : null),
    [data],
  );
  // The builder's formula modal reads a transient candidate against this mounted tile's
  // prepared data. The function changes only when the runtime context changes, which lets
  // the relay update an open editor for URL filters or period/control changes without a
  // render-feedback loop.
  //
  // `cm` is the hook's own MASKED bundle (§2.7: the dimension/platform mask lives in the hook
  // now), so the preview, the views and the bricks read one comparison. It is in the deps for
  // the reason the rest of them are: the CM360 file lands asynchronously, and a memo that held
  // the pre-fetch bundle would leave an open editor printing dashes for a column the tile
  // behind it had already filled in.
  const formulaRuntime = useMemo(() => (
    candidateWidget, target,
  ) => buildFormulaPreview({
    widget: candidateWidget,
    target,
    controlState: controls.controlState,
    data,
    campCtx,
    layoutCtx,
    cm,
  }), [controls.controlState, data, campCtx, layoutCtx, cm]);
  useEffect(() => {
    if (!preview || !onFormulaRuntime) return;
    onFormulaRuntime(formulaRuntime);
  }, [preview, onFormulaRuntime, formulaRuntime]);
  const journalHighlight = useDashboardStore((state) => state.journalHighlight);

  // The Unmapped row's way into Settings → Mapping comes from the dashboard outlet, so
  // every canonical View opens the same tab through the same call.
  //
  // Not under `preview`, and the guard is deliberate rather than incidental: a preview is
  // drawn INSIDE the drawer, which is not inside the outlet, so `openDrawer` is undefined
  // there today anyway. Stating it keeps the answer from changing by accident — sending the
  // builder's own drawer to the Mapping tab would close the builder over an unsaved draft,
  // and an untouched newborn would be discarded with it.
  const { openDrawer } = useOutletContext() || {};
  const onOpenMapping = useMemo(
    () => (!preview && openDrawer ? () => openDrawer('mapping') : null),
    [preview, openDrawer],
  );

  // The dashboard's own breakdown filter, for the views that offer a click (§5.2/§5.4's
  // `filterOnClick`). It lives HERE, in the store-coupled half, for the reason every other
  // store read does: `ReportBody` and the five view renderers are props-only, and the layout
  // preview and the gallery miniature render them with no router state to write to.
  //
  // The write is the legacy panel's own, pair for pair (Breakdown.jsx:209): the clicked pair
  // toggles inside `brkf`, `brk` follows so both surfaces stand on the same cut, and the whole
  // thing rides a transition because the selectors downstream re-plan the campaign.
  //
  // Null under `preview`: a builder preview is a picture of a tile, and a click inside the
  // drawer that re-scoped the dashboard behind it would be a write nobody asked for — the
  // period chips one prop over are guarded for the same reason.
  const { filters, setFilters } = useUrlFilters();
  const brkf = filters.brkf;
  const filterPick = useMemo(() => (preview ? null : {
    pairs: brkf || [],
    onPick: (dim, value) => {
      startTransition(() => { setFilters({ brk: dim, brkf: nextBrkfPairs(brkf, dim, value) }); });
    },
  }), [preview, brkf, setFilters]);

  return (
    <ReportBody
      widget={widget}
      spec={spec}
      controls={controls}
      data={data}
      cm={cm}
      preview={preview}
      menu={menu}
      maxHeightPx={maxHeightPx}
      heightPx={heightPx}
      journalHighlight={journalHighlight}
      layoutCtx={layoutCtx}
      editor={preview ? editor : null}
      onState={onState}
      onOpenMapping={onOpenMapping}
      filterPick={filterPick}
    />
  );
}

/**
 * The tile is memoized on its props, and the props are the whole point: everything
 * this component reads that a PARENT re-render cannot change it reads from the store
 * itself, so a grid that re-renders around an untouched tile has nothing to tell it.
 *
 * Two surfaces re-render the tile list for reasons that are not about any tile:
 * Layout mode's marquee (LayoutMode.jsx:324 sets a rect per pointermove and re-renders
 * every cell around it — measured 344 tile renders and 1.5 s of script for one 40-move
 * drag) and DashGrid on a display-only save. Store-driven updates are unaffected —
 * useWidgetData and the six layout hooks subscribe on their own and re-render this
 * tile whether or not the parent did.
 *
 * The default export is the memo, so no call site has to remember. A caller that mints
 * a fresh element for a prop each render (DashGrid's `menu`) simply gets today's
 * behaviour back for that tile.
 */
export default memo(ReportWidget);
