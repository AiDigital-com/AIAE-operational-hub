// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/ReportBuilder.jsx
//
// THE BUILDER WINDOW (widget-builder v2 spec 2026-08-19 §3): one screen, top to
// bottom — head, banner slot, Data, Controls, Views, Preview — inside the Settings drawer.
//
// Three rules shape everything below, and each of them is a rule about who owns what:
//
//   1. IT NEVER SAVES. Every edit is `onPatch((w) => ({ ...w, spec: mutate(toCompositionSpec(upgradeConversionDefaults(w.spec))) }))`
//      onto the drawer's DRAFT, with the pure mutators from `report-draft.js`. The
//      drawer owns Save, its Reset and its v2 Save gate; nothing here writes to the
//      store or the API. The object SPREAD is not a style choice: the gallery discards
//      an untouched newborn by comparing `JSON.stringify(cur)` against the snapshot it
//      took, so a rebuilt wrapper — same keys, different order — would leave a
//      "New widget" on the dashboard for everyone after the next Save.
//
//   2. IT READS THE DRAFT, NOT THE STORE. `ReportBuilderBody` takes every input as a
//      prop, exactly as `PopoverPanel` and `SpotlightPanel` do, and the default export
//      is the thin store seam above it. That is what lets the host suite drive the real
//      component — chips, cards, patches and all — instead of describing it in text.
//
//   3. THE PREVIEW IS THE TILE. `<ReportWidget widget={draft} preview />` — the same
//      renderer a dashboard mounts, on the in-memory draft. `preview` is load-bearing
//      rather than cosmetic: it is what makes the period pills inert, and the period
//      lane is the one thing on that tile that persists for everyone.
//
// P3 lands task by task; every view kind has its own card now (T6-T8, T10). The cards
// take ONE interface, and the Compare card is the only one that reads its tenth prop —
// `onRemoveControl`, because removing a control is a question about the WHOLE report and
// this window is the only place that can ask it (see `cards/CompareCard.jsx`).
//
// THE TWO CHIP ROWS ARE T9's, and they carry one rule the Views list does not: three of the
// grammar's refusals live BESIDE the spec, on the widget's `scope` and its `datasetType`.
// So the Data row asks `refusalOn` with a candidate WIDGET where the grammar can answer
// (the absolute-scope half), and prints the validator's own exported constant where it
// cannot (`normReport` is fail-fast, and the caller rules run after it). Either way the
// words are the validator's, never a second wording of them — and a CM360 report says why
// it has no period and no scope of its own instead of quietly doing nothing.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { upgradeConversionDefaults } from '../standard-conversion-format.js';
import ConfirmModal from '../ConfirmModal.jsx';
import CompactPicker from './CompactPicker.jsx';
import ContentRow from './ContentRow.jsx';
import ControlSetup from './ControlSetup.jsx';
import { ControlNavigationProvider } from './ControlNavigation.jsx';
import { controlConnections, metricControlSummary } from './control-connections.js';
import './ReportBuilder.css';
import { useFocusOnOpen } from '../PopupCoordinator.jsx';
import { useAvailDims, useAvailableSplits, useDataConfig, useDimSources, useLiPlan } from '../store.js';
import { useDashboardStore } from '../store.js';
import {
  CM_NO_SPEC_PERIOD, LIMITS, RANGE_VALUES, leafViews,
  LAYOUT_DELIVERY_ONLY, LAYOUT_GLOBAL_PERIOD_ONLY, LAYOUT_NO_PERIOD_CONTROL, LAYOUT_NO_SCOPE,
} from '../report-v2.js';
import {
  boundElements, CM_NO_SCOPE, cmElements, contextDiff, datasetTypeOf, dimensionGrains,
  draftState, dropCmElements, moveView, remintForDelivery, removeControl, removeView,
  setControl, setDataset, setPeriod, validateReportDraft,
} from '../report-draft.js';
import { dimensionEntries } from '../metric-catalog.js';
// The tile's OWN pre-step (sections cutover 2026-09-07, spec §4). An auto dimension switch
// stores no list, so every surface that has to NAME what it offers — the Controls chip, the
// panel's sentence, the confirm that removes it — reads the list this resolves on the open
// pacing. Resolved ONCE, in the store seam at the bottom of this file, and handed down as
// `env.autoDims`: the body takes everything on props, and a store read inside it would be a
// second answer to a question the seam already asks.
import { autoDimensionOptions } from '../auto-controls.js';
import { collectDeclaredDimKeys } from '../dim-scope.js';
import { useAutoInventory } from '../report/useAutoInventory.js';
import { autoLabel, resolveValue } from '../report-render.js';
import { channelOptions, liOptions, makeDimValues } from '../scope-options.js';
import { scopeText } from '../scope-text.js';
// The preview tile, and the words its own period chips wear: the chip in the Data row
// names the period the preview under it is drawing, so a second spelling of `7d`/`Flight`
// here would be a second answer to one question. The module is already imported for the
// preview, so this costs no coupling that was not there.
import ReportWidget, { RANGE_LABEL } from '../report/ReportWidget.jsx';
import { cmRefusal, sourceEnv, spotlightItems } from '../spotlight-items.js';
import { PacingCm360Provider } from './PacingCm360.jsx';
import {
  ADD_FIRST, conflictSay, elementName, incompleteSay, pausedSay, skipSay,
} from './draft-states.js';
import ChartCard from './ChartCard.jsx';
import TableCard from './TableCard.jsx';
import KpiCard from './KpiCard.jsx';
import PieCard from './PieCard.jsx';
import CompareCard from './CompareCard.jsx';
import LayoutCard from './LayoutCard.jsx';
import useWidgetHistory from './useWidgetHistory.js';
import CompositionEditor from './CompositionEditor.jsx';
import { toCompositionSpec } from './composition-model.js';
import ViewFrame from './ViewFrame.jsx';
import { grainName, viewName } from './view-text.js';
import { refusalOn } from './ask-grammar.js';
import {
  BreakdownPopover, CONTROL_LABEL, DimensionSwitchPopover, MetricSwitchPopover,
  PeriodSwitchPopover, ProjectionPopover,
} from './ControlPopovers.jsx';
import PeriodChipPopover, { FOLLOWS } from './PeriodChipPopover.jsx';
import ScopePopover from './ScopePopover.jsx';
import SourcePopover from './SourcePopover.jsx';

/**
 * The card each view kind gets — the props are ONE interface (see `ChartCard.jsx`'s header),
 * so a new card is an entry here and nothing else. All six stored kinds have one, including
 * Layout: canonical seeds must never land in the bare frame. The bare shell below is only
 * the forward-compatible fallback for a kind this build does not draw.
 *
 * Null-prototype: the key is a stored view KIND, and on a plain object `VIEW_CARDS.constructor`
 * would answer the Function constructor and be handed to React as a component.
 */
const VIEW_CARDS = {
  __proto__: null,
  chart: ChartCard, table: TableCard, kpi: KpiCard, pie: PieCard, compare: CompareCard,
  layout: LayoutCard,
};

// `availableMetrics: undefined` is deliberate, not a placeholder for null: the key is PRESENT
// so `sourceEnv` carries it, and `undefined` is what the catalog reads as «nothing known», so
// a builder opened before the pacing loads refuses none of the six new metrics (spec §3.6).
const EMPTY_ENV = { dims: [], mappings: null, sourceFacts: null, scopeOptions: null, autoDims: [], availableMetrics: undefined };
const NO_ITEMS = [];
/** No control refusals asked for yet — a frozen literal so the `items` memo below keeps its
 *  identity while the map is closed. */
const NO_REFUSALS = Object.freeze({ __proto__: null });
/** The context pill each Spotlight door wears — the mockup's own words for §4's two rows. */
const SPOT_LABEL = { __proto__: null, source: 'Add source', control: 'Add control' };
/**
 * How a confirm NAMES one element. `boundElements` and `cmElements` answer WHICH elements
 * (report-draft, beside the mutator that removes them); these are the words for the KIND,
 * which is copy and belongs with the screen that prints it.
 *
 * ONE map for both questions: the five slots a bound value can sit in are the same five a
 * `cm` value can, so two maps would be one table written twice and one of them to drift.
 */
const ELEMENT_WORD = {
  __proto__: null,
  series: (n) => `the “${n}” series`,
  guide: (n) => `the guide on “${n}”`,
  column: (n) => `the “${n}” column`,
  value: (n) => `the “${n}” value`,
  target: (n) => `the target on “${n}”`,
  share: (n) => `the row share of “${n}”`,
  delta: (n) => `the “${n}” Δ% column`,
  deltaKpi: (n) => `the Δ vs CM360 line on “${n}”`,
  option: (n) => `the “${n}” option on the Metric switch`,
  // A highlight PAINTS a number it does not own (§2.8), so the phrase names the OWNER and
  // says the rule is what leaves. «the “Impressions” column» here would read as the column
  // going with it, which is exactly what `dropCmElements` does not do.
  highlight: (n) => `the highlight on “${n}”`,
  compare: (n) => `the “${n}” Compare view`,
  breakdown: (n) => `the “${n}” Breakdown switch`,
  // A Layout block, a stat-row cell and a mini-chart line are all «a block» to a reader, and
  // the name is the one it wears on the tile (§2.7). Without this the label would be printed
  // bare in a list of phrases, which reads as a missing word rather than as a name.
  brick: (n) => `the “${n}” block`,
};

/** What the banner row wears in front of its sentence, per tone. A refusal takes the amber
 *  warning this product already uses for one (PacingTab, the composite editor's `.cmp-ed-bad`);
 *  an instruction and a note take the informational mark. Decoration in both cases — the
 *  sentence beside it is what an AT reads. */
const BANNER_ICON = { __proto__: null, warn: '⚠', quiet: 'ⓘ' };
/** No answer from the preview yet — a frozen literal, so the state machine's `preview` input
 *  keeps its identity while nothing has been reported. */
const NO_PREVIEW = Object.freeze({ zeroResult: false, sourceUnavailable: null });

const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (list) => [...new Set(list)];
const controlOf = (spec, type) => arr(spec && spec.controls).find((c) => c && c.type === type) || null;
/** An element the confirm has to name, in one phrase. A kind nobody worded, or an element
 *  whose own name is blank, still reads as something rather than as an empty quote. */
const phrase = (e, fallback) => (ELEMENT_WORD[e.kind] || ((n) => n))(e.label || fallback);
const sentence = (list) => list.join(', ');
/** The compare views that name one control BY ID (§5.5). Both references are asked the same
 *  way, so the two confirms below cannot answer differently about the same fact. */
const comparesNaming = (list, key, id) => list.filter((v) => v && v.kind === 'compare' && v[key] === id);

/**
 * What this widget's SCOPE pins, in one phrase — the tile's own words, from the module
 * both surfaces read (`scope-text.js`), because it is one fact and two wordings for it
 * would read as two different pins.
 *
 * The chip adds the one thing the tile's badge has no use for: the UNPINNED case. The
 * frame hides the badge when nothing is pinned; a chip in a row of chips has to say
 * something, and "all line items" is that widget's actual scope.
 *
 * It prints the phrase WHOLE. The badge caps it because it shares a line with the tile's
 * name; this row wraps, and the chip is the only place that says what the report is
 * pinned to.
 */
export function scopeSummary(scope) {
  return scopeText(scope) || 'all line items';
}

/** The mapping a CM360 dataset is bound to, as the chip says it. A fixed binding whose
 *  entity is gone names the ID rather than printing nothing: this chip is the only place
 *  that says WHICH mapping the widget is pinned to, and «Fixed:» with a blank after it
 *  would read as a mapping with no name. */
function mappingLabel(dataset, mappings) {
  const m = dataset && dataset.mapping;
  if (!m || m.mode !== 'fixed') return 'Runtime';
  const hit = arr(mappings).find((x) => x && x.id === m.id);
  return `Fixed: ${(hit && hit.name) || m.id}`;
}

/** Does this view hold anything a Remove would take with it? A view with nothing in it
 *  has nothing to lose, so it goes without a question. */
const holdsElements = (view) => (
  arr(view.series).length > 0 || arr(view.columns).length > 0 || !!view.value || view.kind === 'compare'
  || arr(view.rows).some((row) => arr(row && row.cols).some((col) => arr(col && col.bricks).length > 0))
);

/* ── the view card ────────────────────────────────────────────────────────── */

/**
 * A view whose KIND this build has no card for — the shared frame and nothing under it.
 *
 * Every kind the grammar has (VIEW_KINDS) is in the map above, so nothing reaches this
 * today. It stays because §3's «legible at rest» is a condition on the whole window: a
 * stored view this build cannot draw the settings of still has to appear, with its kind, its
 * name and the three controls that act on the view itself — the same rule the tile follows
 * when it meets a field it does not know.
 */
export function ViewCard({ view, spec, first, last, onMove, onDropAt, onRemove }) {
  // `spec` forwarded like every other card's: without it this frame would say «Chart»
  // beside siblings saying «Chart 1» and «Chart 2» — the one place the numbering could
  // still disagree with itself.
  return (
    <ViewFrame
      view={view} spec={spec} first={first} last={last}
      onMove={onMove} onDropAt={onDropAt} onRemove={onRemove}
    />
  );
}

/* ── the window ───────────────────────────────────────────────────────────── */

/**
 * ReportBuilderBody — the builder with no store under it.
 *
 *   widget            the draft widget (the WRAPPER: id, title, profile, datasetType, spec)
 *   titlePlaceholder  the name this tile wears on screen when it carries none of its own
 *   isNewborn         has this widget ever been saved? It decides only where focus lands
 *   env               `{dims, mappings, sourceFacts, scopeOptions}` — what the store knows and
 *                     the draft does not: the pacing's dimensions, its CM360 mapping entities,
 *                     what each per-pacing source can serve today (spec 2026-08-25 §4), and the
 *                     three lists a scope pin is picked from (`{channels, lis, dimValuesFor}`)
 *   onPatch/onBack/onDelete   the gallery's own three handles
 *   onDraftInvalidChange      a formula somewhere in this window is half typed. The DRAWER
 *                     owns what that means (Save blocked, Back asks first), and this is the
 *                     same handle every FormulaField reports through.
 */
export function ReportBuilderBody({
  widget: storedWidget, titlePlaceholder = '', isNewborn = false, env = EMPTY_ENV,
  onPatch, onBack, onDelete, onDraftInvalidChange,
}) {
  // One id space for this window's `aria-describedby` links: three refused controls point
  // at the sentence that refuses them, and two builders on one page must not collide.
  const widget = useMemo(() => ({ ...storedWidget, spec: toCompositionSpec(upgradeConversionDefaults(storedWidget.spec)) }), [storedWidget]);
  const history = useWidgetHistory(storedWidget, onPatch);
  const uid = useId();
  const rootRef = useRef(null);
  const historyGuardRef = useRef((action) => action());
  const backRef = useRef(null);
  const titleRef = useRef(null);
  // One anchor per chip that opens a panel, and ONE `firstRef`: §3 allows a single popover
  // open at a time, so the panel that is open is the only one asking for focus.
  const chipRefs = {
    source: useRef(null), period: useRef(null), scope: useRef(null),
    'ctl:metric': useRef(null), 'ctl:period': useRef(null), 'ctl:breakdown': useRef(null),
    'ctl:dimension': useRef(null), 'ctl:projection': useRef(null),
  };
  const firstRef = useRef(null);
  const sourceAddRef = useRef(null);
  const controlAddRef = useRef(null);
  const [setup, setSetup] = useState(null);
  const [selectionRequest, setSelectionRequest] = useState(null);
  const [contentInvalid, setContentInvalid] = useState(false);
  const invalidReporter = useRef(onDraftInvalidChange);
  invalidReporter.current = onDraftInvalidChange;
  useEffect(() => {
    onDraftInvalidChange?.(contentInvalid || !!setup);
  }, [contentInvalid, setup, onDraftInvalidChange]);
  useEffect(() => () => invalidReporter.current?.(false), []);
  // One compact Add menu: source or control.
  const [spot, setSpot] = useState(null);
  const [pop, setPop] = useState(null);
  // Every question this window asks before it takes something away, in one place: a view, a
  // switch that elements follow, the source a Δ% reads. `{title, message, confirmLabel,
  // cancelLabel, onConfirm}`.
  const [ask, setAsk] = useState(null);
  // The grain change that just skipped or broke something, and the spec it happened TO —
  // §9's context conflict is a refusal plus a history, and this is the history (see
  // `contextDiff`). Every write to the SPEC clears it, whether or not it fixed anything,
  // because Undo puts that spec back and a later edit would go with it (see `addCm`).
  const [conflict, setConflict] = useState(null);
  // What the preview tile under this window actually drew: `{zeroResult, sourceUnavailable}`,
  // reported by the tile itself (it owns the fetch and the §8.5 seams — `previewState`).
  const [preview, setPreview] = useState(NO_PREVIEW);
  const onPreviewState = useCallback((next) => setPreview((cur) => (
    cur.zeroResult === next.zeroResult && cur.sourceUnavailable === next.sourceUnavailable
      ? cur           // the same answer, by value: a new object here would re-render for nothing
      : next
  )), []);
  const [formulaRuntime, setFormulaRuntime] = useState(null);
  const onFormulaRuntime = useCallback((next) => {
    setFormulaRuntime((current) => (current === next ? current : next));
  }, []);
  const formulaPreview = useCallback((candidateWidget, target) => (
    formulaRuntime
      ? formulaRuntime(candidateWidget, target)
      : { status: 'loading', shape: 'scalar', message: 'Waiting for current report data.' }
  ), [formulaRuntime]);

  const spec = widget.spec;
  const views = leafViews(spec?.views);
  const dataset = (spec && spec.dataset) || null;
  const isCm = !!dataset && dataset.type === 'deliveryCm360';
  const hasLayout = views.some((view) => view && view.kind === 'layout');

  // THE one write path. Every mutation below goes through it, so the wrapper is spread
  // and never rebuilt (see rule 1 in this file's header).
  //
  // Through a REF because one caller is memoized: the Spotlight's `step` has to keep its
  // identity across renders (below), so the closure inside it is the one from the render
  // that built it — and the gallery hands down a fresh `onPatch` arrow on every render.
  // The ref is what keeps "the one write path" true for a callback that outlives its render.
  const onPatchRef = useRef(history.write);
  onPatchRef.current = history.write;
  // The draft this render is showing, for the same reason: the diff below is asked BESIDE
  // the write, and a memoized caller would otherwise diff the draft as it was two renders
  // ago. The write itself stays functional, so two patches in one batch still compose.
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const patch = (mutate) => {
    const cur = widgetRef.current;
    // Asked before the write and thrown away if it says nothing: `mutate` is pure (every
    // mutator returns a new spec and touches nothing), so running it twice costs one small
    // object and buys the one fact `draftState` cannot read off a spec.
    const d = contextDiff(cur, { ...cur, spec: mutate(cur.spec) });
    setConflict(d && { ...d, prevSpec: cur.spec });
    onPatchRef.current((w) => ({ ...w, spec: mutate(toCompositionSpec(upgradeConversionDefaults(w.spec))) }));
  };
  /** Put back the draft the grain change was made ON — through the same write path, so the
   *  spec that returns is the object that was already there and no key is re-ordered. The
   *  diff runs again on the way back and comes up empty, which is what clears the banner. */
  const undoContext = () => patch(() => conflict.prevSpec);
  const closeAdd = () => { setSpot(null); };
  /** Open a panel, and close whatever else was open — §3's one-at-a-time rule, in one place. */
  const openPop = (which) => { setSetup(null); setSpot(null); setPop(which); };
  const openSpot = (anchor) => { setSetup(null); setPop(null); setSpot(anchor); };

  /* ── what the grammar says about the two chips that live BESIDE the spec ──── */

  // «May this report carry a period of its own?» On CM360 the answer is fixed and the
  // sentence is the grammar's own constant — `normReport` is fail-fast and the caller rules
  // run after it, so on a draft broken anywhere else the question cannot be ASKED, and a chip
  // dimmed with no reason is not a reason (§1.1.3). Everywhere else it is asked by TRYING, on
  // a range the draft is not already on: a candidate identical to the draft would produce no
  // new problem and read as «allowed». That is what answers the `scope.time: "absolute"`
  // half, whose sentence names both the Period control and this chip.
  //
  // Both this and `controlWhy` below are LAZY — a `refusalOn` is two `normReport` runs, and
  // these would otherwise be four of them on every keystroke in the window, for a sentence
  // nothing is showing. The CM360 half needs no run at all.
  const periodWhy = useMemo(() => {
    if (isCm) return CM_NO_SPEC_PERIOD;
    if (hasLayout) return LAYOUT_GLOBAL_PERIOD_ONLY;
    if (pop !== 'period') return null;
    // The draft may ALREADY carry the very refusal this panel exists to undo: pin the scope
    // to «Always current» while a period is set, and `/spec/period` is refused as it stands.
    // Asking by TRYING cannot see that — `refusalOn` keeps only what is NEW, and a problem
    // the draft already has is by definition not new — so the panel that is the way out of
    // that draft printed the ordinary precedence note and left every range enabled. A
    // problem already at this pointer IS this chip's refusal, so it is read rather than
    // diffed. The detail names no range, which is what lets it stand for all of them.
    const own = validateReportDraft(widget).problems.find((p) => p.pointer === '/spec/period');
    if (own) return own.detail;
    const other = RANGE_VALUES.find((r) => r !== (spec && spec.period));
    // The candidate has to be what the PICK actually does, or the panel reads its own
    // transaction back as a refusal. With a Period switch on this widget a range is no longer
    // a plain write: §6's precedence makes the switch beat the window, the grammar refuses the
    // pair outright, and this panel's pick is the ONE patch that pins the range AND takes the
    // switch (`askPinPeriod`). Asked with the switch left in, every range would come back
    // refused by a rule the click was never going to break.
    const cand = controlOf(spec, 'period')
      ? setPeriod(removeControl(spec, 'period', {}), other)
      : setPeriod(spec, other);
    return refusalOn(widget, { ...widget, spec: cand }, '/spec/period');
  }, [isCm, hasLayout, pop, widget, spec]);
  // …and «may it be pinned to a slice of the pacing?» — one fact, the dataset, and the
  // validator's own constant for the same reason: that rule is a CALLER rule and never runs
  // on a spec `normReport` has already refused.
  const scopeWhy = isCm ? CM_NO_SCOPE : (hasLayout ? LAYOUT_NO_SCOPE : null);
  // The two control types the DATASET or the views can refuse, each asked the same way. The
  // metric switch is not among them: nothing about the dataset or the scope forbids one, and
  // the only thing the grammar would answer is «it needs two options», which is the state
  // adding it deliberately creates (§9's `incomplete`, one edit from finished).
  const controlWhy = useMemo(() => (spot !== 'control' ? NO_REFUSALS : {
    metric: null,
    // The candidate is the whole TRANSACTION the pick performs, not half of it: over a fixed
    // window the mint also resets the window to «follows the dashboard» (`addControl` asks
    // first and then writes both in one patch), because §6's precedence would otherwise leave
    // a range no viewer can be shown and the grammar refuses that pair. Probed with the window
    // left in, this row would grey itself out on the very draft the confirm exists to fix.
    period: hasLayout ? LAYOUT_NO_PERIOD_CONTROL
      : refusalOn(widget, { ...widget, spec: setPeriod(setControl(spec, { type: 'period', label: CONTROL_LABEL.period, options: ['7d', '30d'], defaultOption: '7d' }), null) }, '/spec'),
    breakdown: refusalOn(widget, { ...widget, spec: setControl(spec, { type: 'breakdown', label: CONTROL_LABEL.breakdown, maxSelected: 1 }) }, '/spec'),
    // Not among them either, for the metric switch's own reason: nothing about the dataset
    // or the scope forbids a dimension switch, and the only thing the grammar would answer
    // is «nothing reaches it» — which is the state adding one deliberately creates (§9's
    // `incomplete`, one edit from finished: pick two dimensions, then point a card at it).
    dimension: null,
    projection: null,
  }), [spot, widget, spec, hasLayout]);

  const items = useMemo(() => {
    if (spot === 'source') return spotlightItems('source', {
      datasetType: datasetTypeOf(spec), mappings: env.mappings,
      sourceRefusal: hasLayout ? LAYOUT_DELIVERY_ONLY : null,
    });
    if (spot === 'control') return spotlightItems('control', { controls: arr(spec && spec.controls), refusals: controlWhy });
    return NO_ITEMS;
  }, [spot, env, spec, controlWhy, hasLayout]);
  // Ruling (controller): the drawer's own useFocusOnOpen stays drawer-level and lands on
  // the head; the builder is the screen that knows which of ITS controls is the first
  // thing to touch. A newborn is NAMED before anything else about it is decided; an
  // existing widget opens on the way back out.
  useFocusOnOpen(rootRef, true, isNewborn ? titleRef : backRef);

  /** One shell, two anchors — the pick is routed by the id's own namespace, which is what
   *  the ids were prefixed for (`spotlight-items.js`: one id space, one prefix per thing). */
  const onSpotPick = (item) => {
    const id = String(item.id);
    if (id === 'source:cm360') { closeAdd(); askAddCm(); return; }
    if (id.startsWith('control:')) { closeAdd(); addControl(id.slice('control:'.length)); }
  };
  const askRemove = (view) => {
    // A view with nothing in it has nothing to lose, so it goes without a question.
    if (!holdsElements(view)) { patch((s) => removeView(s, view.id)); return; }
    setAsk({
      title: 'Remove this view?',
      message: `“${viewName(view, spec)}” and everything in it leave this Widget. Nothing is stored until you press Save.`,
      confirmLabel: 'Remove',
      onConfirm: () => patch((s) => removeView(s, view.id)),
    });
  };

  const metric = controlOf(spec, 'metric');
  const period = controlOf(spec, 'period');
  const breakdown = controlOf(spec, 'breakdown');
  const dimension = controlOf(spec, 'dimension');
  const projection = controlOf(spec, 'projection');
  // The list an AUTO dimension switch offers on the open pacing (sections cutover
  // 2026-09-07). Resolved by the store seam at the bottom of this file with the tile's own
  // pre-step, so the chip, the panel and the removal confirm all name what the viewer would
  // see. Empty for a stored-list switch — nothing below reads it then.
  const autoOptions = arr(env.autoDims);

  /* ── the Data row's two writes: the source comes and the source goes ─────── */

  /** What a CM360 dataset takes with it (the couplings of §6 and the caller's scope rule),
   *  read off THIS draft — so the confirm names what this author is actually losing and
   *  nothing they never had. */
  const cmTakes = () => {
    const out = [];
    if (widget.scope != null && scopeText(widget.scope)) out.push(`the scope pin (${scopeText(widget.scope)})`);
    if (spec && spec.period) out.push(`the Data period (${RANGE_LABEL[spec.period] || spec.period})`);
    if (controlOf(spec, 'period')) out.push('the Period switch');
    return out;
  };

  /**
   * The two writers below reach `onPatchRef` DIRECTLY rather than through `patch`, because
   * they move keys that sit beside the spec (`datasetType`, and `scope`, which is deleted
   * rather than nulled). That puts them outside the one place a standing conflict is
   * cleared — and a conflict's Undo restores the spec from BEFORE the grain change, which
   * after one of these would take the dataset with it, silently. So each clears it.
   *
   * A patch that touches only the WRAPPER — the title, the profile, the scope pin — does
   * NOT, and that is deliberate: the spec has not moved, so the Undo still puts back exactly
   * the grain the banner names and loses nothing.
   */
  const addCm = () => {
    setConflict(null);
    onPatchRef.current((w) => {
      let s = setDataset(toCompositionSpec(upgradeConversionDefaults(w.spec)), { type: 'deliveryCm360', mapping: { mode: 'runtime' } });
      s = setPeriod(s, null);
      s = removeControl(s, 'period', {});
      // The KEY goes, not a null: `widgets-validate` stores no `scope` for a widget that has
      // none, so a stored null would come back absent and read as dirty for ever. The
      // discriminator is re-derived in the SAME patch — the server's own rule is
      // `widget.datasetType === derivedDatasetType(spec)`.
      const { scope, ...rest } = w;   // eslint-disable-line no-unused-vars
      return { ...rest, datasetType: datasetTypeOf(s), spec: s };
    });
    // The re-open idiom (§3): the pick lands on a chip, and the chip's own panel comes back
    // on it so the mapping is one field away.
    openPop('source');
  };

  /**
   * It ALWAYS asks, and there is no branch where it does not. Two things are true of every
   * report this door is reachable from — it is a delivery report, so nothing in it can be
   * reading CM360 yet — and the grammar refuses a widget that fetches the source and shows
   * none of it. So the pick always has a consequence worth naming, and sometimes two.
   */
  const askAddCm = () => {
    const takes = cmTakes();
    setAsk({
      title: 'Add the CM360 source?',
      message: 'A CM360 Widget reads its rows through the mapping, so it carries no period and no scope of its own. '
        + (takes.length ? `Adding it removes ${sentence(takes)}. ` : '')
        + 'Nothing in this Widget reads CM360 yet, so Save stays blocked until something does: a Compare view, '
        + 'a CM value, a formula naming cmIm, cmCl or cmCo, a Δ% column or a Δ vs CM360 line. '
        + 'Nothing is stored until you press Save.',
      confirmLabel: 'Add CM360',
      onConfirm: addCm,
    });
  };

  const dropSource = (alsoElements) => {
    setConflict(null);          // see addCm above
    onPatchRef.current((w) => {
      // `remintForDelivery` on BOTH ways out, and after the drop: a dual-source field is
      // stored under its CM name (`impressions`) on a CM360 widget, and off that dataset the
      // engine has no such field — the tile would print «Unknown field» under a card still
      // calling the row Impressions, on a draft the grammar accepts. The confirm promised to
      // remove what READS CM360; an impression count is not that, so it comes back instead.
      const s = setDataset(remintForDelivery(alsoElements ? dropCmElements(toCompositionSpec(upgradeConversionDefaults(w.spec))) : toCompositionSpec(upgradeConversionDefaults(w.spec))), { type: 'delivery' });
      return { ...w, datasetType: datasetTypeOf(s), spec: s };
    });
    setPop(null);
  };

  const askDropSource = () => {
    const reads = cmElements(spec);
    if (!reads.length) { dropSource(false); return; }
    const named = sentence(reads.map((e) => phrase(e, 'Compare')));
    setAsk({
      title: 'Remove the CM360 source?',
      message: `${reads.length === 1 ? 'One thing reads' : `${reads.length} things read`} CM360: ${named}. `
        + 'Remove them takes each of them out of this Widget along with the source; Keep source changes nothing. '
        + 'Nothing is stored until you press Save.',
      confirmLabel: 'Remove them',
      cancelLabel: 'Keep source',
      onConfirm: () => dropSource(true),
    });
  };

  /* ── the two halves of §6's period precedence, and the one patch between them ──
     A Period switch beats the widget's own window, which beats the dashboard filter — so the
     two together are a stored range no viewer can ever be shown, and the grammar refuses the
     pair (SWITCH_NO_SPEC_PERIOD). Both doors that could create it therefore NAME both halves
     first and then write them in ONE patch: a mint over a fixed window (below) and a range
     picked under a switch (`askPinPeriod`). Cancel writes nothing at either door. */

  /** ONE patch, both halves: the widget's own window is written and the switch that would
   *  override it goes. `removeControl` takes the switch rather than a filter typed here — it
   *  is the mutator that owns what a removed control leaves behind, and a period switch is the
   *  one type nothing in the spec follows, so there is nothing to re-fix and nothing to name. */
  const pinWindow = (range) => patch((s) => setPeriod(removeControl(s, 'period', {}), range));

  /**
   * The Window panel's write. «Follows the dashboard» is always legal and never asks: it is
   * the answer that takes nothing away, and it is the way out of every draft this panel
   * exists to undo. A RANGE under a switch is the named transaction above.
   */
  const askPinPeriod = (value) => {
    if (value == null || !controlOf(spec, 'period')) { patch((s) => setPeriod(s, value)); return; }
    const word = RANGE_LABEL[value] || value;
    setAsk({
      title: 'Pin this window?',
      message: 'A Period switch is on this Widget and overrides the window. '
        + `Pinning ${word} removes the switch, and every view reads that one window. `
        + 'Nothing is stored until you press Save.',
      confirmLabel: `Pin ${word}`,
      // A conversion, not a destruction — the .sp-pop-rm--go rule, worn by the modal too.
      confirmColor: 'var(--accent)',
      onConfirm: () => pinWindow(value),
    });
  };

  /* ── the Controls row's two writes ───────────────────────────────────────── */

  // Setup starts without invented options. It stays local until Create commits it.
  const mint = (s, type) => setControl(s, {
    type,
    label: CONTROL_LABEL[type],
    ...(type === 'breakdown' ? { maxSelected: 1 } : null),
  });

  const beginControl = (type) => {
    setPop(null);
    setSetup({ type, spec: type === 'period' ? setPeriod(mint(spec, type), null) : mint(spec, type) });
  };
  const addControl = (type) => {
    // The one mint with a consequence: over a fixed window the switch would override it, so
    // the window goes back to «follows the dashboard» IN THE SAME PATCH. Named first, because
    // the author set that window on purpose and §9 allows nothing silent.
    if (type === 'period' && spec && spec.period !== null) {
      setAsk({
        title: 'Add the Period switch?',
        message: `This Widget reads a fixed ${RANGE_LABEL[spec.period] || spec.period} window. `
          + 'A Period switch overrides it, so adding the switch sets the window back to '
          + `“${FOLLOWS}” and the viewer picks the window instead. `
          + 'Nothing is stored until you press Save.',
        confirmLabel: 'Add the switch',
        // A conversion, not a destruction — the .sp-pop-rm--go rule, worn by the modal too.
        confirmColor: 'var(--accent)',
        onConfirm: () => {
          beginControl('period');
        },
      });
      return;
    }
    beginControl(type);
  };

  /**
   * The dimension panel's ONE destructive direction, asked before it happens.
   *
   * Auto stores no list, so choosing it drops the dimensions the author picked — and Pick
   * does not give them back: it stores whatever the pacing carries today, and on a pacing
   * with fewer than two it is closed altogether. Every other write in this builder that
   * loses an authored list asks first, and this one is reached by a radio, which a keyboard
   * answers with one press. The other direction takes nothing away and goes straight through
   * the panel.
   */
  const askAutoDimensions = () => {
    const ctl = controlOf(spec, 'dimension');
    if (!ctl) return;
    const go = () => patch((s) => setControl(s, { type: 'dimension', optionsAuto: true }));
    const said = arr(ctl.options).map((key) => `“${grainName(env, { type: 'dim', key })}”`);
    if (ctl.optionsAuto === true || !said.length) { go(); return; }
    setAsk({
      title: 'Follow the pacing?',
      message: `Auto offers whatever the pacing carries, so ${sentence(said)} `
        + `${said.length === 1 ? 'leaves' : 'leave'} this switch and picking again does not bring `
        + 'them back. Nothing is stored until you press Save.',
      confirmLabel: 'Use Auto',
      // A conversion, not a destruction — the .sp-pop-rm--go rule, worn by the modal too: the
      // switch stays and keeps every view it cuts; what moves is who answers it.
      confirmColor: 'var(--accent)',
      onConfirm: go,
    });
  };

  const askRemoveControl = (type) => {
    const ctl = controlOf(spec, type);
    if (!ctl) return;
    // The pick the viewer would have been on when an AUTO dimension switch goes: the builder
    // runs the same pre-step the tile does, so the grains it leaves behind are fixed to the
    // cut the tile is drawing rather than to `removeControl`'s bare seed.
    const gone = type === 'dimension' && ctl.optionsAuto === true ? { currentOption: autoOptions[0] } : {};
    const done = () => { setPop(null); patch((s) => removeControl(s, type, gone)); };
    if (type === 'metric') {
      // TWO things can follow a metric switch, and they follow it in different ways: a bound
      // VALUE follows it by type and is re-fixed, and a COMPARE VIEW names it by id and
      // cannot be stored without one. The confirm carries whichever halves apply.
      const bound = boundElements(spec);
      const named = comparesNaming(views, 'metricControlId', ctl.id);
      if (!bound.length && !named.length) { done(); return; }
      // §6: «Deleting the switch re-fixes bound elements to the currently selected option».
      // The builder holds no viewer selection — the preview's own switch is the tile's
      // state, not the draft's — so the option they are fixed to is the switch's DEFAULT,
      // which is what a viewer opening this widget would have been on. The confirm says so.
      const opt = arr(ctl.options).find((o) => o && o.id === ctl.defaultOptionId) || arr(ctl.options)[0] || null;
      const to = opt ? autoLabel(resolveValue(opt.value, spec, null)) || 'its first option' : null;
      const parts = [];
      if (bound.length) {
        parts.push(`${bound.length === 1 ? 'One element follows' : `${bound.length} elements follow`} it: `
          + `${sentence(bound.map((e) => phrase(e, 'this view')))}.`);
        parts.push(to
          ? `Each of them is fixed to “${to}”, the option the switch starts on.`
          : 'The switch carries no option to fix them to, so each of them is left naming a switch that is gone.');
      }
      if (named.length) {
        parts.push(`${sentence(named.map((v) => `“${viewName(v, spec)}”`))} names it, and a Compare view `
          + 'without a metric switch cannot be stored.');
      }
      parts.push('Nothing is stored until you press Save.');
      setAsk({
        title: 'Remove the metric switch?',
        message: parts.join(' '),
        confirmLabel: 'Remove',
        onConfirm: done,
      });
      return;
    }
    if (type === 'breakdown') {
      const named = comparesNaming(views, 'breakdownControlId', ctl.id);
      if (named.length) {
        setAsk({
          title: 'Remove the breakdown switch?',
          message: `${sentence(named.map((v) => `“${viewName(v, spec)}”`))} names it, and a Compare view without one `
            + 'cannot be stored. Nothing is stored until you press Save.',
          confirmLabel: 'Remove',
          onConfirm: done,
        });
        return;
      }
    }
    if (type === 'dimension') {
      // The metric switch's question, one slot over: the views that FOLLOW this switch keep
      // their cut, fixed to the dimension the switch starts on, and the confirm names both
      // the views and the dimension before it happens.
      const cut = dimensionGrains(spec);
      if (cut.length) {
        // …and for an auto switch, the cut the pacing resolves to — `removeControl`'s own
        // answer, said before it happens rather than after.
        const to = ctl.optionsAuto === true ? (autoOptions[0] || 'audience')
          : (arr(ctl.options).includes(ctl.defaultOption) ? ctl.defaultOption : arr(ctl.options)[0]);
        const word = to ? (grainName(env, { type: 'dim', key: to }) || to) : null;
        const parts = [
          `${cut.length === 1 ? 'One view is' : `${cut.length} views are`} cut by it: `
            + `${sentence(cut.map((e) => `“${viewName(views.find((v) => v.id === e.viewId), spec)}”`))}.`,
          word
            ? `Each of them is fixed to “${word}”, the dimension the switch starts on.`
            : 'The switch carries no dimension to fix them to, so each of them is left naming a switch that is gone.',
          'Nothing is stored until you press Save.',
        ];
        setAsk({
          title: 'Remove the dimension switch?',
          message: parts.join(' '),
          confirmLabel: 'Remove',
          onConfirm: done,
        });
        return;
      }
    }
    if (type === 'projection') {
      const follows = controlConnections(spec, ctl.id);
      if (follows.length) {
        const charts = uniq(follows.map((connection) => `“${connection.viewLabel}”`));
        setAsk({
          title: 'Remove the projection switch?',
          message: `${follows.length === 1 ? 'One projection follows' : `${follows.length} projections follow`} it in ${sentence(charts)}. `
            + 'Removing the switch fixes each one to Plan. Nothing is stored until you press Save.',
          confirmLabel: 'Remove',
          onConfirm: done,
        });
        return;
      }
    }
    done();
  };

  /* ── which of §9's ten states this draft is in, and what the row under the head says ── */

  // The three inputs the DRAWER owns — a save in flight, a save that came back refused, and
  // whether the draft differs from what is stored — are deliberately not passed. The footer
  // carries all three already (`Saving…`, the server's own sentence, «Unsaved changes»), and
  // every state this window CAN reach draws the same banner whether the draft is dirty or
  // not. What the builder knows, it answers; what it does not know, it does not guess.
  const validation = useMemo(() => validateReportDraft(widget), [widget]);

  // Memoized so it keeps its identity while nothing about the DRAFT moved — the window
  // re-renders on every popover open and every Spotlight keystroke, and the banner below
  // is derived from this.
  const state = useMemo(() => draftState(widget, {
    validation,
    // Only an edit that actually BROKE the draft is a conflict. A grain change that merely
    // skipped a calculation leaves a draft the server stores (§3's amendment), and one that
    // landed on a draft already refused for something else would offer an Undo that fixes
    // nothing — both of those are answered by the banners below on their own terms.
    contextChange: !!(conflict && conflict.broken.length),
    preview,
    isNewborn,
  }), [widget, validation, conflict, preview, isNewborn]);

  // ONE banner, and the state picks it — in the state machine's own order, so the thing
  // that most needs saying is the thing that is said.
  const banner = useMemo(() => {
    const paused = { tone: 'warn', text: pausedSay(validation.problems[0], spec) };
    if (state.state === 'contextConflict') {
      const names = uniq([
        ...conflict.broken.map((p) => elementName(p.element, spec)),
        ...conflict.skipped.map((s) => s.label),
      ].filter(Boolean));
      // A refusal that belongs to no element on screen has nothing to name, and a count of
      // zero is not a sentence — so that draft reads as what it also is: paused.
      return names.length
        ? { tone: 'warn', text: conflictSay(names, conflict.grain), undo: true }
        : paused;
    }
    if (state.state === 'incomplete') {
      // An instruction where there is one; the grammar's own sentence where the missing
      // piece is a cap, which is not a piece anybody can see missing.
      const say = incompleteSay(spec);
      return say ? { tone: 'quiet', text: say } : paused;
    }
    if (state.state === 'invalidLocal') return paused;
    // A window with no rows is the TILE's own empty state, inside the preview (P2's
    // NO_FACTS) — a banner repeating it would be one fact said twice, a box apart. A source
    // that is GONE is the recoverable state, and §9 asks for it by name and repair route.
    if (state.state === 'sourceUnavailable') return { tone: 'warn', text: preview.sourceUnavailable };
    // …and §3's third state at rest: stored, skipped, named here so Save is not a surprise.
    if (state.skipped.length) return { tone: 'quiet', text: skipSay(state.skipped.map((s) => s.label)) };
    return null;
  }, [state, validation, conflict, spec, preview]);

  // Card/Chart/Table are geometry profiles for a single View, not alternate editors. The
  // same Widget can move among them; Section is the multi-View and CM360 shape.
  const noSingletonProfile = arr(spec?.views).length !== 1
    ? `Card, Chart and Table profiles hold exactly one View; this Widget has ${views.length}`
    : isCm ? 'CM360 widgets use a full row' : null;
  const layoutProfileWhy = (profile) => (hasLayout
    ? `a Layout uses the card or section profile, not "${profile}"`
    : noSingletonProfile);

  const revealConnection = (connection) => {
    if (!connection.viewId) return;
    setPop(null); setSpot(null);
    setSelectionRequest((previous) => ({ ...connection, token: (previous?.token || 0) + 1 }));
  };
  const openControl = (controlId) => {
    const control = spec.controls.find((item) => item.id === controlId);
    if (!control) return;
    chipRefs[`ctl:${control.type}`]?.current?.scrollIntoView?.({ block: 'nearest' });
    openPop(`ctl:${control.type}`);
  };
  const controlSummary = (control) => {
    if (control.type === 'metric') return metricControlSummary(control, spec);
    if (control.type === 'period') return `${arr(control.options).length} windows · Starts with ${RANGE_LABEL[control.defaultOption] || control.defaultOption || '—'}`;
    if (control.type === 'dimension') return control.optionsAuto
      ? `Auto · ${autoOptions.length} dimensions`
      : `${arr(control.options).length} dimensions · Starts with ${control.defaultOption ? grainName(env, { type: 'dim', key: control.defaultOption }) : '—'}`;
    if (control.type === 'breakdown') return control.maxSelected == null
      ? 'Breakdowns' : `Breakdowns · Up to ${control.maxSelected} selected`;
    return 'Projection · Reforecast / Plan';
  };
  const usedBy = (control) => {
    const connections = controlConnections(spec, control.id);
    return <div className="sp-control-connections">
      <div className="sp-control-connections-title">{control.type === 'period' ? 'Applies to' : 'Used by'}</div>
      {connections.length ? connections.map((connection) => connection.viewId
        ? <button type="button" className="sp-control-connection" key={connection.key}
            aria-label={`Show ${connection.viewLabel}: ${connection.label}`}
            onClick={() => revealConnection(connection)}>
            {connection.viewLabel}<span>· {connection.label}</span><span aria-hidden="true">↗</span>
          </button>
        : <div key={connection.key} className="sp-control-connection">{connection.label}</div>)
        : <p className="sp-pop-note">No elements connected yet.</p>}
    </div>;
  };

  return (
    <ControlNavigationProvider value={{ openControl, revealConnection }}>
    <div className="wgf-editor sp-rb" ref={rootRef} onKeyDown={(event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey
        || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      setPop(null); setSpot(null); setAsk(null); setConflict(null);
      historyGuardRef.current(() => { if (key === 'y' || event.shiftKey) history.redo(); else history.undo(); });
    }}>
      <div className="wgf-ed-head">
        <button type="button" className="wgf-back" title="Back to widgets" ref={backRef} onClick={onBack}>‹</button>
        <input
          className="sp-inp sp-inp--sans sp-rb-title"
          ref={titleRef}
          value={widget.title || ''}
          placeholder={titlePlaceholder || 'Widget title'}
          maxLength={80}
          aria-label="Widget title"
          onChange={(e) => history.write((w) => ({ ...w, title: e.target.value.slice(0, 80) }))}
        />
        <span className="wgf-kind">WIDGET</span>
        <span className="sp-rb-prof" role="group" aria-label="Widget footprint">
          {[
            ['section', 'Full row', null],
            ['card', 'Compact', noSingletonProfile],
            ['chart', 'Resizable', layoutProfileWhy('chart')],
            ['table', 'Resizable · tall', layoutProfileWhy('table')],
          ].map(([value, label, why]) => (
            <button
              key={value}
              type="button"
              className={`blib-pill sp-rb-prof-b${widget.profile === value ? ' blib-pill--on' : ''}`}
              aria-pressed={widget.profile === value}
              // aria-disabled and NOT disabled (§10.3): the sentence below is the reason,
              // and a control nobody can put focus on cannot deliver one. The handler is
              // what keeps the promise — a refused pill writes nothing.
              aria-disabled={why ? true : undefined}
              aria-describedby={why ? `${uid}-noprof` : undefined}
              onClick={() => { if (!why) history.write((w) => ({ ...w, profile: value })); }}
            >
              {label}
            </button>
          ))}
        </span>
        {onDelete && (
          <button type="button" className="wgf-x ui-tip" data-tip="Delete this widget (asks first)" onClick={onDelete}>🗑</button>
        )}
        {/* WHY the Card pill is refused, on screen (§1.1.3: a reason nobody can see is not a
            reason). It used to be a clipped span — a sighted reader got a pill at 45% opacity
            that answered a press with nothing, while a screen reader was told exactly why.
            The same node serves both now, which is what the `aria-describedby` above points
            at. LAST in the head and `flex: 1 1 100%` (`.sp-rb-why`, the pattern the Data row
            already uses): the head wraps, so the sentence takes a line of its own under the
            pills instead of pushing 🗑 onto one. */}
        {noSingletonProfile && <span id={`${uid}-noprof`} className="sp-rb-why">{noSingletonProfile}</span>}
      </div>

      {/* The banner row (§3/§9): one line under the head saying which state this draft is
          in and what to do next. A tinted row with a full border and a leading glyph —
          never a rail (the project's hard ban), and never colour alone: each of them says
          its state in words. */}
      {banner && (
        <div className={`sp-rb-banner sp-rb-banner--${banner.tone}`}>
          <span className="sp-rb-banner-i" aria-hidden="true">{BANNER_ICON[banner.tone]}</span>
          <span className="sp-rb-banner-t">{banner.text}</span>
          {banner.undo && (
            <>
              {/* The separator rides in the TEXT, the rule every chip in this window
                  follows: these are flex items, so the row's gap draws the spacing while
                  anything reading the row gets a sentence. */}
              <span className="sp-rb-banner-sep" aria-hidden="true">{' · '}</span>
              {/* The window's own chip shape, not the drawer's 33px base button: this row
                  is the 22px tier every control beside it wears, and a footer-sized button
                  in it would stand proud of the sentence it belongs to. */}
              <button
                type="button" className="sp-rb-chip sp-rb-chip--act sp-rb-banner-b"
                onClick={undoContext}
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}

      <div className="sp-builder-context">
      <details className="sp-composition-data">
        <summary>Data <span>{isCm ? 'Delivery + CM360' : 'Delivery'}</span></summary>
        <div className="sp-builder-data-list">
          <div className="sp-builder-data-fact"><span className="sp-rb-src">BQ</span> Delivery facts</div>
          {isCm && <ContentRow label="CM360" summary={`Mapping: ${mappingLabel(dataset, env.mappings)}`}
            buttonRef={chipRefs.source} onOpen={() => openPop('source')} open={pop === 'source'}
            marker={<span className="sp-rb-src sp-rb-src--cm">CM</span>} />}
          <ContentRow label="Period" summary={spec.period ? RANGE_LABEL[spec.period] || spec.period : 'Follows dashboard'}
            buttonRef={chipRefs.period} onOpen={() => { if (!isCm && !hasLayout) openPop('period'); }} open={pop === 'period'}
            buttonProps={{ 'aria-disabled': isCm || hasLayout || undefined,
              'aria-describedby': isCm || hasLayout ? `${uid}-noperiod` : undefined }} />
          {(isCm || hasLayout) && <span className="sp-rb-why" id={`${uid}-noperiod`}>{periodWhy}</span>}
          <ContentRow label="Scope" summary={scopeSummary(widget.scope)} buttonRef={chipRefs.scope}
            onOpen={() => { if (!scopeWhy) openPop('scope'); }} open={pop === 'scope'}
            buttonProps={{ 'aria-disabled': scopeWhy ? true : undefined,
              'aria-describedby': scopeWhy ? `${uid}-noscope` : undefined }} />
          {scopeWhy && <span className="sp-rb-why" id={`${uid}-noscope`}>{scopeWhy}</span>}
          <button type="button" className="sp-builder-add" ref={sourceAddRef}
            aria-haspopup="dialog" aria-expanded={spot === 'source'} onClick={() => openSpot('source')}>+ Add source</button>
        </div>
      </details>
      <section className="sp-builder-controls" aria-label="Controls">
        <div className="sp-builder-controls-head"><span>Controls</span>
          <button type="button" className="sp-builder-add" ref={controlAddRef}
            aria-haspopup="dialog" aria-expanded={spot === 'control' || !!setup}
            onClick={() => openSpot('control')}>+ Add control</button>
        </div>
        <div className="sp-builder-control-list">
          {arr(spec.controls).map((control) => <ContentRow key={control.id}
            label={control.label || CONTROL_LABEL[control.type]} summary={controlSummary(control)}
            buttonRef={chipRefs[`ctl:${control.type}`]} open={pop === `ctl:${control.type}`}
            onOpen={() => openPop(`ctl:${control.type}`)} />)}
        </div>
      </section>
      </div>

      <div className="sp-comp-history" role="group" aria-label="Edit history">
        <span>Widget content</span>
        <button type="button" className="sp-rb-btn" disabled={!history.canUndo} onClick={() => {
          setPop(null); setSpot(null); setAsk(null); setConflict(null); historyGuardRef.current(history.undo);
        }}>↶ Undo</button>
        <button type="button" className="sp-rb-btn" disabled={!history.canRedo} onClick={() => {
          setPop(null); setSpot(null); setAsk(null); setConflict(null); historyGuardRef.current(history.redo);
        }}>↷ Redo</button>
      </div>
      {/* The pacing's CM360 sentence, said once for every inline formula field below: the same
          `cmRefusal` call the three view cards make for their own palette, so a Layout block,
          a mini-chart line and a highlight rule cannot explain a CM360 field differently from
          the column beside them. A string or null, so the provider never re-renders on its own. */}
      <PacingCm360Provider value={cmRefusal({ ...sourceEnv(env), datasetType: datasetTypeOf(spec) })}>
      {spec.views[0]?.kind === 'container' ? <CompositionEditor
        selectionRequest={selectionRequest}
        historyRevision={history.revision}
        historyGuardRef={historyGuardRef}
        onHistoryBoundary={history.boundary}
        view={spec.views[0]}
        spec={spec}
        widget={widget}
        env={env}
        patch={patch}
        first last
        onRemoveControl={askRemoveControl}
        onDraftInvalid={setContentInvalid}
        formulaPreview={formulaPreview}
        renderPreview={(editor) => (
          <ReportWidget widget={widget} preview editor={editor} onState={onPreviewState}
            onFormulaRuntime={onFormulaRuntime} />
        )}
      /> : <section className="sp-sect">
        {arr(spec.views).map((view, index) => {
          const Card = VIEW_CARDS[view.kind] || ViewCard;
          return <Card key={view.id} view={view} spec={spec} widget={widget} env={env} patch={patch}
            formulaPreview={formulaPreview}
            first={index === 0} last={index === spec.views.length - 1}
            onMove={(dir) => patch((current) => moveView(current, view.id, dir))}
            onRemove={() => askRemove(view)} onDraftInvalid={setContentInvalid} />;
        })}
        <ReportWidget widget={widget} preview onState={onPreviewState} onFormulaRuntime={onFormulaRuntime} />
      </section>}
      </PacingCm360Provider>

      {pop === 'source' && isCm && (
        <SourcePopover
          dataset={dataset}
          mappings={env.mappings}
          anchorRef={chipRefs.source}
          firstRef={firstRef}
          onPick={(mapping) => patch((s) => setDataset(s, { type: 'deliveryCm360', mapping }))}
          onRemove={askDropSource}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'period' && (
        <PeriodChipPopover
          widget={widget}
          anchorRef={chipRefs.period}
          rangeWhy={periodWhy}
          // The panel says the precedence CONCRETELY while a switch is on the widget, so the
          // state is legible before any click — and the pick that follows is the named
          // transaction, not a plain write (`askPinPeriod`).
          hasSwitch={!!period}
          onPick={askPinPeriod}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'scope' && (
        <ScopePopover
          scope={widget.scope}
          options={env.scopeOptions}
          anchorRef={chipRefs.scope}
          // The WRAPPER, spread and never rebuilt: `scope` sits beside the spec, and the
          // gallery's newborn-discard compares the wrapper's JSON against its snapshot.
          onScope={(next) => onPatchRef.current((w) => ({ ...w, scope: next }))}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'ctl:metric' && metric && (
        <MetricSwitchPopover
          footer={usedBy(metric)}
          widget={widget} control={metric}
          anchorRef={chipRefs['ctl:metric']} firstRef={firstRef} patch={patch}
          onRemove={() => askRemoveControl('metric')}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'ctl:period' && period && (
        <PeriodSwitchPopover
          footer={usedBy(period)}
          widget={widget} control={period}
          anchorRef={chipRefs['ctl:period']} firstRef={firstRef} patch={patch}
          onRemove={() => askRemoveControl('period')}
          // The way OUT of «a period switch needs at least 2 choices» when the author only
          // ever wanted one window: the same one patch the Window panel makes, reached from
          // the panel that is refusing them. It reaches beyond this control — it writes
          // `spec.period` — so like `onRemove` it is the builder's, not the panel's.
          onPinWindow={pinWindow}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'ctl:breakdown' && breakdown && (
        <BreakdownPopover
          footer={usedBy(breakdown)}
          widget={widget} control={breakdown}
          anchorRef={chipRefs['ctl:breakdown']} firstRef={firstRef} patch={patch}
          onRemove={() => askRemoveControl('breakdown')}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'ctl:dimension' && dimension && (
        <DimensionSwitchPopover
          footer={usedBy(dimension)}
          widget={widget} control={dimension} dims={env.dims} autoOptions={autoOptions}
          anchorRef={chipRefs['ctl:dimension']} firstRef={firstRef} patch={patch}
          onRemove={() => askRemoveControl('dimension')}
          // The panel keeps its place under the question: the switch is not going anywhere,
          // and the answer is the mode row it was asked from (the Popover stands back for an
          // open modal, for the pointer and for Escape).
          onAskAuto={askAutoDimensions}
          onClose={() => setPop(null)}
        />
      )}
      {pop === 'ctl:projection' && projection && (
        <ProjectionPopover
          footer={usedBy(projection)}
          widget={widget} control={projection}
          anchorRef={chipRefs['ctl:projection']} firstRef={firstRef} patch={patch}
          onRemove={() => askRemoveControl('projection')}
          onClose={() => setPop(null)}
        />
      )}

      <CompactPicker open={!!spot} title={SPOT_LABEL[spot] || ''}
        anchorRef={spot === 'source' ? sourceAddRef : controlAddRef}
        items={items} onPick={onSpotPick} onClose={closeAdd} />
      {setup && <ControlSetup key={setup.type} widget={widget} setup={setup} env={env}
        anchorRef={controlAddRef} onClose={() => { setSetup(null); controlAddRef.current?.focus(); }}
        onCreate={(control) => {
          patch((current) => control.type === 'period'
            ? setPeriod(setControl(current, control), null) : setControl(current, control));
          setSetup(null);
          controlAddRef.current?.focus();
        }} /> }

      {ask && (
        <ConfirmModal
          title={ask.title}
          message={ask.message}
          confirmLabel={ask.confirmLabel}
          cancelLabel={ask.cancelLabel}
          confirmColor={ask.confirmColor}
          onConfirm={() => { setAsk(null); ask.onConfirm(); }}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
    </ControlNavigationProvider>
  );
}

/**
 * The store seam, and nothing else. It answers the three questions the draft cannot: which
 * dimensions this pacing actually carries (a pie needs one to be cut by), what a fixed CM360
 * mapping is CALLED, and what a scope pin may be pinned TO — the pacing's channels, its line
 * items and the values its facts carry per dimension.
 */
export const WidgetBuilderBody = ReportBuilderBody;

/**
 * The store's `sourceFacts`, with the drawer's UNSAVED CM360 draft folded in.
 *
 * The builder is a TAB of the drawer that CM360 is added in, and both sit behind one Save —
 * `localThirdParty` (SettingsDrawer) is a draft the server has never seen, so `sourceFacts`
 * cannot describe it. Without this, an author who adds CM360 on the Data tab and walks
 * straight to Widgets finds no CM chip anywhere and no sentence saying why: the picker
 * silently denies a source they just connected.
 *
 * A draft that says «configured» where the store's facts do not lights the chip on its FIRST
 * rung — `{configured:true, present:false}`, which the picker prints as «CM360 data is not
 * loaded yet». That is exactly true: nothing has been fetched, because nothing has been
 * saved. A draft can only ever supply the configured half; whether rows landed and whether a
 * mapping resolves stay the server's answers, so no rung above this one can be faked.
 */
export function withDraftCm360(facts, draftConfigured) {
  if (!draftConfigured) return facts;
  if (facts && facts.cm360 && facts.cm360.configured) return facts;
  return { ...facts, cm360: { configured: true, present: false, fetched_at: null, row_count: 0 } };
}

export default function WidgetBuilder({ draftCm360Configured = false, ...props }) {
  // `availDims` DECIDES which dimensions this pacing offers — the legacy Breakdown panel's
  // own rule over the facts. `availableSplits` is still read beside it, but only to NAME the
  // single value behind a refusal: it is an inventory of values, and asking it which
  // dimensions exist is what left Funnel and Platform unpickable.
  const availDims = useAvailDims();
  const availableSplits = useAvailableSplits();
  const liPlan = useLiPlan();
  const dimSources = useDimSources();
  const dataConfig = useDataConfig();
  const mappings = useDashboardStore((s) => s.mappingsV3);
  // The auxiliary rows the pacing carries: with them `dimensionEntries` lists aux:creative /
  // aux:conversion, so the Options checklist can draw — and untick — every key a «Pick» on an
  // auto switch stores (that list is resolved from the same rows, auto-controls.js).
  const creatives = useDashboardStore((s) => s.creatives);
  const conversions = useDashboardStore((s) => s.conversions);
  const liNames = useDashboardStore((s) => s.display?.liNames);
  const facts = useDashboardStore((s) => s.facts);
  const sourceFacts = useDashboardStore((s) => s.sourceFacts);
  // What this pacing's data was built to carry (spec 2026-09-08 §3.6) — the metric maps read
  // it, so a key the file lacks is shown muted with its reason instead of minting a value
  // whose tile would print the sentence.
  const availableMetrics = useDashboardStore((s) => s.availableMetrics);
  // The AUTO dimension list, resolved on this pacing with the tile's own pre-step: the hook
  // costs nothing while the draft carries no auto switch (it answers null), and the builder
  // must not derive a second list from `dims` — `dimensionEntries` and `autoDimensionOptions`
  // are different rules (Channel is offered by one and never by the other).
  const autoInventory = useAutoInventory(props.widget && props.widget.spec);
  const autoDims = useMemo(
    () => (autoInventory ? autoDimensionOptions(autoInventory) : []),
    [autoInventory],
  );
  const env = useMemo(() => ({
    dims: dimensionEntries({ availDims, availableSplits, liPlan, dimSources, dataConfig, creatives, conversions }),
    autoDims,
    mappings, dimSources, dataConfig,
    // What each per-pacing source can serve right now (spec 2026-08-25 §4). The metric maps
    // read it beside `mappings`: whether a CM pill can be picked is one question with two
    // halves — is there CM360 data, and is there a mapping to read it through — and the two
    // arrive from the same store on the same object so no surface answers half of it. The
    // drawer's unsaved CM360 draft is folded in here and nowhere else.
    sourceFacts: withDraftCm360(sourceFacts, draftCm360Configured),
    availableMetrics,
    // Which dimensions this pacing declares a TARGET on (plan metrics on dim rows,
    // 2026-09-12). A value map on such a grain may offer the plan half; every other
    // dimension keeps the old refusal. Memoised with the env, because the catalog re-judges
    // on every Spotlight keystroke and this walks every container of every line.
    declaredDims: collectDeclaredDimKeys(liPlan),
    // Built here rather than in the panel: the dimension values are mined from the whole
    // breakdown aggregate, and a per-render derivation would re-walk it on every keystroke
    // in the builder. `makeDimValues` memoizes per key behind this one.
    scopeOptions: {
      channels: channelOptions(liPlan),
      lis: liOptions(liPlan, liNames),
      dimValuesFor: makeDimValues(facts),
    },
  }), [availDims, availableSplits, liPlan, dimSources, dataConfig, creatives, conversions, mappings, sourceFacts,
    availableMetrics, draftCm360Configured, liNames, facts, autoDims]);
  return <ReportBuilderBody {...props} env={env} />;
}
