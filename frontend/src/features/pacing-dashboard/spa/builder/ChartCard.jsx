// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/ChartCard.jsx
//
// THE CHART CARD (widget-builder v2 §5.1, mockup §2). One card in the builder's Views list:
// the chart's own settings as chips, its series as ROWS, and one `+ Add series` that opens
// the Spotlight.
//
// The card interface T7-T10 inherit — every kind's card takes exactly this:
//
//   { view, spec, widget, env, patch, first, last, onMove, onDropAt, onRemove, onDraftInvalid }
//
//   view/spec/widget  the view this card is about, the spec it sits in, and the whole draft
//                     widget (an axis refusal judges a candidate WIDGET, because four of
//                     the validator's rules live beside the spec and not in it)
//   env               `{dims, mappings}` — what the store knows and the draft does not
//   patch(mutate)     the builder's ONE write path: `onPatch((w) => ({...w, spec: mutate(w.spec)}))`.
//                     A card never rebuilds the wrapper and never saves.
//   first/last/onMove/onDropAt/onRemove   handed straight to the shared `ViewFrame`
//   onDraftInvalid(bad)          a formula being typed here is not finished; the drawer
//                     blocks Save and asks on Back while it is not
//
// Three rules of §5.1 are structural here, not decoration:
//
//   · X IS DATA, NOT LOOK. `setX` writes the grain and touches no style — the system never
//     decides the visual form from the data choice (owner, 2026-08-19). A Plan/Needed line
//     that no longer has a date axis is KEPT and marked skipped, never deleted under the
//     author (§3's amendment).
//   · EVERY REFUSAL IS THE GRAMMAR'S. The cap sentence, the calculation's «date axis only»
//     and an axis conflict all come from the tables and validators that own them.
//   · LEGIBLE AT REST. A series row says its name, its source and its settings in one line,
//     so the whole chart is reviewable without opening a single popover (§3).
//
// A NOTE ON IDS. A new series' id is minted from the spec THIS RENDER holds, before the
// patch — `handleDisplayChange` is a functional setState, so an id computed inside the
// updater is not readable when the popover has to be told which row to open on. The draft
// cannot move between this render and the click that reads it, so the two agree.
import { SwitchAction, useContextualSwitch } from './ContextualSwitch.jsx';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import Popover from '../Popover.jsx';
import Spotlight from '../Spotlight.jsx';
import { useFocusOnOpen } from '../PopupCoordinator.jsx';
import { formulaScopeFor } from '../formula-scope.js';
import {
  DATE_DOMAINS, EMPTY_BEHAVIORS, LIMITS, ORIENTATIONS, flattenViews,
} from '../report-v2.js';
import { chartPaint } from '../chart-paint.js';
import { CATALOG, mintValue } from '../metric-catalog.js';
import { autoLabel, calculatedGuideLabel, grainTypeOf, guideBasisOf, resolveValue } from '../report-render.js';
import {
  addCalculatedGuide, addSeries, datasetTypeOf, moveSeriesTo, newNodeId, patchSeries, removeSeries,
  setAxisFormat, setChartDateDomain, setChartEmptyBehavior, setChartJournal,
  setChartTitleAuto, setOrientation, setTopN, setViewTitle, setX, validateReportDraft,
} from '../report-draft.js';
import { cmRefusal, dimPlanEnv, sourceEnv, sourceStep, sourcesFor, spotlightItems, valueReadsCm } from '../spotlight-items.js';
import SeriesPopover, { guideWith } from './SeriesPopover.jsx';
import GuidePopover from './GuidePopover.jsx';
import { PopRow, Seg, word } from './rows.jsx';
import AxesPopover from './AxesPopover.jsx';
import ViewFrame from './ViewFrame.jsx';
import ContentRow from './ContentRow.jsx';
import HighlightChildren from './HighlightChildren.jsx';
import { highlightContextExpressionsAvailable, highlightCmSlots } from './highlight-capabilities.js';
import { dragType, dropIndex, idsOf, useRowDrag } from './reorder.js';
import { ADD_FIRST } from './draft-states.js';
import { grainName, seriesName } from './view-text.js';
import { autoAxisFormat, axisFamilies, axisSides, drawnSeries } from './chart-axis.js';
import { seriesAt } from './ask-grammar.js';

const arr = (v) => (Array.isArray(v) ? v : []);
/** The terse form of `CALC_SKIP_REASON`: the summary line is a list of settings and not a
 *  sentence, and the tile under the card prints the full one where a sentence belongs. */
const SKIPPED = 'date axis only · skipped';
/** What a stored standalone calculation says of itself (spec 2026-09-10 «Standalone calculation
 *  series»): the picker no longer mints one, and a Highlight compares with the Guide, not with it. */
const STANDALONE = 'Standalone line. A Guide on the value series is what a Highlight compares with.';
/** The Spotlight's context pill, per door — each says which slot is being filled (§4). */
const SPOT_LABEL = {
  __proto__: null,
  add: 'Add to: Chart', x: 'Chart X axis', value: 'Series value', guide: 'Guide line',
};
const SPOT_ANCHOR = { __proto__: null, add: 'chart', x: 'chartx', value: 'series', guide: 'guide' };
const NO_ITEMS = [];
/** What an X-map pick MEANS, by the namespace of its id: a dimension key, the dimension
 *  SWITCH (M4), or one of the fixed grains. One reader, so the map and the mutator can never
 *  disagree about which of the three a row was. */
function xGrain(id, dimensionControl) {
  if (id.startsWith('x:dim:')) return { type: 'dim', key: id.slice('x:dim:'.length) };
  if (id === 'x:control') return { type: 'control', controlId: dimensionControl && dimensionControl.id };
  return { type: id.slice('x:'.length) };
}

export default function ChartCard({
  view, spec, widget, env, patch, first, last, onMove, onDropAt, onRemove, onDraftInvalid,
  embedded = false, formulaPreview,
}) {
  const switching = useContextualSwitch(widget, env, patch);
  const uid = useId();
  const rowEls = useRef(new Map());
  const guideEls = useRef(new Map());
  const anchorRef = useRef(null);
  const valueRef = useRef(null);
  // The Axes chip is the only control here that ANCHORS a panel: the Spotlight is modal
  // and hands focus back to whatever opened it, so the X chip and `+ Add series` need no
  // ref of their own.
  const switchAxisRef = useRef(null);
  const axesRef = useRef(null);
  const presentationRef = useRef(null);
  // `panel` is the open popover — one at a time, the coordinator's rule made local so two
  // are never even rendered. `spot` is the open Spotlight and which door it came through.
  const [panel, setPanel] = useState(null);
  const [spot, setSpot] = useState(null);
  const [more, setMore] = useState(false);
  // A pick has to arrive as a NEW object or the shell hands back the step it is already
  // hiding (T5's measured trap), so the pick IS the state and every one of them is fresh.
  const [pick, setPick] = useState(null);
  // The row the popover opens on NEXT, once the patch has landed and it is in the DOM.
  const [pending, setPending] = useState(null);
  const directGuideRef = useRef(null);
  const [restoreGuideFocus, setRestoreGuideFocus] = useState(false);
  useFocusOnOpen(directGuideRef, restoreGuideFocus && !spot && !panel, () => {
    setRestoreGuideFocus(false);
    return directGuideRef.current;
  });

  const series = arr(view.series);
  const guideProblems = useMemo(() => {
    if (!series.some((line) => line.kind !== 'calc' && line.guide)) return [];
    const at = seriesAt(spec, view.id);
    return validateReportDraft(widget).problems.filter((problem) =>
      at && problem.pointer.startsWith(`${at}/`) && /\/guide(?:\/|$)/.test(problem.pointer));
  }, [widget, spec, view.id, series]);
  const datasetType = datasetTypeOf(spec);
  // The axis this card JUDGES by, which is the axis the tile runs down: a control axis is
  // the dimension axis it resolves to (M4), so the maps under it refuse what a dimension
  // grain refuses. The chip one line down still names the SWITCH — `grainName` reads the
  // stored grain, because what the author chose is the switch and not today's answer.
  const xType = grainTypeOf(view.x);
  // …and its KEY, for the one rule that needs the axis itself rather than its type: a `ds:`
  // axis is judged by its source's own metric list, not the delivery inventory
  // (metric-catalog's `grainKey`). A control axis resolves to whichever dimension the viewer
  // lands on, which the builder cannot know, so it names none.
  const xKey = typeof view.x?.key === 'string' ? view.x.key : null;
  const isDate = xType === 'date';
  const atCap = series.length >= LIMITS.series;
  const sides = axisSides(view, spec);
  // The series the tile DRAWS, in its order — hidden ones and a calculation off the date
  // axis are absent from both, so the row's axis word and its swatch are read off the same
  // list the chart under the card is drawing from.
  const drawn = drawnSeries(view);
  /** The palette slot a row's swatch wears. A row the tile does not draw has no drawn
   *  position to take a colour from, so it falls back to its stored one — the swatch is
   *  dimmed and the words say «hidden» or «skipped» beside it either way. */
  const palIndex = (s, i) => (drawn.indexOf(s) === -1 ? i : drawn.indexOf(s));
  const metricControl = arr(spec.controls).find((c) => c && c.type === 'metric') || null;
  const dimensionControl = arr(spec.controls).find((c) => c && c.type === 'dimension') || null;
  // Does this pacing declare targets on the dimension this chart is cut by (2026-09-12)? The
  // series map and the formula palette read the one answer, so a field offered in the
  // Spotlight is the same set the editor beside it accepts.
  const dimPlanEligible = dimPlanEnv(env, xKey, dimensionControl);
  const scopeEnv = useMemo(() => ({ ...env, dimPlanEligible }), [env, dimPlanEligible]);

  // §3: after a Spotlight pick the popover REOPENS on the new element with focus on Value.
  // In an effect keyed on the id, because the row it hangs from has to be in the DOM first —
  // the patch travels up to the drawer and comes back as a new `view` prop.
  useEffect(() => {
    if (!pending) return;
    if (!series.some((s) => s.id === pending.id && (pending.kind !== 'guide' || s.guide))) return;
    setPanel(pending);
    if (pending.kind === 'series') setMore(false);
    setPending(null);
  }, [pending, series]);

  const closeSpot = () => { setSpot(null); setPick(null); onDraftInvalid?.(false); };
  const cancelSpot = () => {
    // A scrim's default pointer action can move focus to body after Spotlight's
    // opener restore. The shared focus helper returns it on the following frame.
    const destination = spot?.mode === 'guide' && !spot.fromContent ? {
      kind: series.find((line) => line.id === spot.seriesId)?.guide ? 'guide' : 'series', id: spot.seriesId,
    } : null;
    closeSpot();
    if (destination) setPanel(destination);
    else if (spot?.fromContent) setRestoreGuideFocus(true);
  };
  const openSpot = (mode, seriesId, fromContent = false) => { setRestoreGuideFocus(false); setPanel(null); setPick(null); setSpot({ mode, seriesId, fromContent }); };
  /** Back to the panel this Spotlight replaced, on the element it was opened from (§3). */
  const reopen = (seriesId) => { setSpot(null); setPick(null); onDraftInvalid?.(false); setPanel({ kind: 'series', id: seriesId }); };

  /* ── adding ───────────────────────────────────────────────────────────── */

  /** N ids no element in this spec carries, minted the way `addView` mints a child's: each
   *  one is RESERVED in the namespace before the next is asked for, so «Both sources» does
   *  not name its two lines the same thing. */
  const mintIds = (n) => {
    const out = [];
    let s = spec;
    for (let i = 0; i < n; i += 1) {
      const id = newNodeId(s, 's');
      out.push(id);
      s = { ...s, views: [...arr(s.views), { id }] };
    }
    return out;
  };

  /** One value series, plus the axis-scale default the pick may FILL (§5.1 — never an
   *  override; a typed formula passes no entry and so fills nothing). */
  const addOne = (s, id, value, entry) => {
    let next = addSeries(s, view.id, { id, value });
    const v = flattenViews(next.views).find((x) => x?.id === view.id);
    const auto = entry && v && autoAxisFormat(v, next, id, entry);
    return auto ? setAxisFormat(next, view.id, auto.side, auto.format) : next;
  };

  const addValue = (entry, source) => {
    const [id] = mintIds(1);
    // The row to open on is named BEFORE the patch, not after: React batches the two into
    // one commit, and the effect that opens the popover has to see both at once.
    setPending({ kind: 'series', id });
    patch((s) => addOne(s, id, mintValue(entry, { source, datasetType: datasetTypeOf(s) }), entry));
    closeSpot();
  };

  const addBoth = (entry, sources) => {
    const [a, b] = mintIds(2);
    setPending({ kind: 'series', id: a });
    patch((s) => {
      const one = addOne(s, a, mintValue(entry, { source: sources[0], datasetType: datasetTypeOf(s) }), entry);
      return addOne(one, b, mintValue(entry, { source: sources[1], datasetType: datasetTypeOf(one) }), entry);
    });
    closeSpot();
  };

  const addBound = () => {
    const [id] = mintIds(1);
    setPending({ kind: 'series', id });
    patch((s) => addOne(s, id, { kind: 'bound' }, null));
    closeSpot();
  };

  /* ── filling a slot that already exists ───────────────────────────────── */

  const setValue = (seriesId, entry, opt) => {
    const value = opt.bound ? { kind: 'bound' } : mintValue(entry, { source: opt.source, datasetType });
    patch((s) => {
      const next = patchSeries(s, view.id, seriesId, { value });
      const v = flattenViews(next.views).find((x) => x?.id === view.id);
      const auto = !opt.bound && v && autoAxisFormat(v, next, seriesId, entry);
      return auto ? setAxisFormat(next, view.id, auto.side, auto.format) : next;
    });
    reopen(seriesId);
  };

  const setGuideValue = (seriesId, value) => {
    const cur = series.find((s) => s.id === seriesId);
    patch((s) => patchSeries(s, view.id, seriesId, {
      guide: guideWith(cur && cur.guide, { value }),
    }));
    closeSpot();
    setPending({ kind: 'guide', id: seriesId });
  };
  // Expected joins the series and the standalone line it replaces leaves, in ONE patch —
  // one Apply, one Undo (report-draft.js `addCalculatedGuide`, spec 2026-09-10 «The child»).
  const setGuideCalculation = (seriesId) => {
    if (!series.some((entry) => entry.id === seriesId)) return;
    patch((currentSpec) => addCalculatedGuide(currentSpec, view.id, seriesId));
    closeSpot(); setPending({ kind: 'guide', id: seriesId });
  };

  /* ── the Spotlight ────────────────────────────────────────────────────── */

  const pickEnv = useMemo(() => ({
    dims: env.dims,
    // The X map's «follows the dimension switch» row (M4) — offered from the draft, because
    // only the draft knows whether this report has one.
    dimensionControl,
    // What this PACING can serve (spec 2026-08-25 §4): the CM pill on every dual-source row
    // is judged from it, on this dataset and on the CM360 one alike.
    ...sourceEnv(env),
    datasetType,
    grain: xType,
    grainKey: xKey,
    dimPlanEligible,
    hasMetricControl: !!metricControl,
    // A pick that ADDS is weighed against every series; one that REPLACES leaves out the
    // value it replaces (the catalog's own rule for `axisFamilies`).
    ...(spot && spot.mode === 'add' ? { axis: 'auto', axisFamilies: axisFamilies(view, spec, null) } : null),
    ...(spot && spot.mode === 'value' ? valueEnv(view, spec, spot.seriesId) : null),
    ...(spot?.mode === 'guide' ? { guideCalculationRefusal: guideCalculationRefusal(series.find((entry) => entry.id === spot.seriesId), spec) } : null),
  }), [env, dimensionControl, datasetType, xType, xKey, metricControl, spot, view, spec, dimPlanEligible]);

  const items = spot ? spotlightItems(SPOT_ANCHOR[spot.mode], pickEnv) : NO_ITEMS;

  // Memoized on the PICK alone: the shell files a step the user typed past by identity, so
  // a fresh object every render would re-show a question they had already left.
  const step = useMemo(() => (pick ? {
    question: pick.question,
    options: pick.options,
    onPick: (o) => {
      const opt = pick.options.find((x) => x.id === o.id);
      if (!opt || opt.disabled) return;
      if (pick.mode === 'add') {
        if (opt.bound) return addBound();
        if (opt.sources) return addBoth(pick.entry, opt.sources);
        return addValue(pick.entry, opt.source);
      }
      if (pick.mode === 'value') return setValue(pick.seriesId, pick.entry, opt);
      return setGuideValue(pick.seriesId, mintValue(pick.entry, { source: opt.source, datasetType }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null), [pick]);

  const onSpotPick = (item) => {
    if (item.disabled) return;
    const { mode, seriesId } = spot;
    if (mode === 'x') {
      patch((s) => setX(s, view.id, xGrain(item.id, dimensionControl)));
      closeSpot();
      return;
    }
    if (item.id === 'guidecalc:projection') {
      if (mode === 'guide' && !items.find((entry) => entry.id === item.id)?.disabled) setGuideCalculation(seriesId);
      return;
    }
    const entry = CATALOG.find((e) => e.id === item.id);
    if (!entry) return;
    const options = sourceStep(entry, {
      ...sourceEnv(env),
      datasetType,
      // A guide is a FIXED reference line — the grammar refuses a bound one, so the switch
      // is never an answer there. A series' own value may follow it.
      metricControl: mode === 'guide' ? null : metricControl,
      freeSlots: LIMITS.series - series.length,
      // Only a LIST can take two elements. A guide and a series' own value hold one.
      allowBoth: mode === 'add',
      addsTo: 'chart',
    });
    if (!options) {
      const source = sourcesFor(entry, { ...sourceEnv(env), datasetType })[0];
      if (mode === 'add') return addValue(entry, source);
      if (mode === 'value') return setValue(seriesId, entry, { source });
      return setGuideValue(seriesId, mintValue(entry, { source, datasetType }));
    }
    setPick({
      mode,
      seriesId,
      entry,
      options,
      question: mode === 'add' ? `Add ${entry.label} as:` : `Read ${entry.label} from:`,
    });
  };

  const onFormula = (expr, family) => {
    const { mode, seriesId } = spot;
    const value = { kind: 'formula', expr, unitFamily: family };
    if (mode === 'add') {
      const [id] = mintIds(1);
      setPending({ kind: 'series', id });
      // A TYPED formula never triggers the metric-picked axis default (§5.1): the engine
      // cannot know what the expression is in, which is why its author declares the family.
      patch((s) => addOne(s, id, value, null));
      closeSpot();
      return;
    }
    if (mode === 'value') { patch((s) => patchSeries(s, view.id, seriesId, { value })); reopen(seriesId); return; }
    setGuideValue(seriesId, value);
  };

  const previewFormula = (expr, unitFamily) => {
    const { mode, seriesId } = spot;
    const value = { kind: 'formula', expr, unitFamily };
    const elementId = mode === 'add' ? newNodeId(spec, 'formula_preview') : seriesId;
    const next = mode === 'add' ? addOne(spec, elementId, value, null)
      : patchSeries(spec, view.id, elementId, mode === 'guide'
        ? { guide: guideWith(series.find((line) => line.id === elementId)?.guide, { value }) }
        : { value });
    return formulaPreview({ ...widget, spec: next }, {
      kind: mode === 'guide' ? 'chartGuide' : 'chartSeries', viewId: view.id, elementId,
    });
  };

  /* ── the render ───────────────────────────────────────────────────────── */

  const open = panel && panel.kind === 'series' ? series.find((s) => s.id === panel.id) : null;
  const openGuide = panel?.kind === 'guide' ? series.find((s) => s.id === panel.id && s.kind !== 'calc' && s.guide) : null;
  // A ref on JSX is filled in by the renderer; this is the one the popover MEASURES from,
  // pointed at whichever row is open. Assigned during render because the popover reads it in
  // a layout effect, which runs before any effect of this component could.
  //
  // The ROW'S BUTTON, not the row: `Popover` hands focus back through this ref on Escape and
  // on an outside click, and `.focus()` on a `<div>` with no tabindex is a silent no-op — so
  // focus was left on <body> inside a trapped dialog and the next Tab restarted the drawer's
  // cycle at the top. It is also the control that opened the panel, which is what every chip
  // in this window anchors from.
  anchorRef.current = open ? rowEls.current.get(open.id) || null
    : openGuide ? guideEls.current.get(openGuide.id) || null : null;

  const removeGuide = (seriesId) => {
    setPanel(null);
    patch((current) => patchSeries(current, view.id, seriesId, { guide: null }));
    rowEls.current.get(seriesId)?.focus({ preventScroll: true });
  };

  const formulaScope = useMemo(() => formulaScopeFor(spot?.mode === 'guide'
    ? { type: 'agg' } : (view.x || { type: 'date' }), scopeEnv), [spot?.mode, view.x, scopeEnv]);
  const seriesDrag = dragType('series', view.id);

  const viewSettings = (<>
      <div className="sp-rb-row sp-rb-row--view">
        <button type="button" className="sp-rb-chip sp-rb-chip--act" ref={switchAxisRef} onClick={() => openSpot('x')}>
          {`X: ${grainName(env, view.x, spec)}`}
          {' '}
          <span className="sp-rb-caret" aria-hidden="true">▾</span>
        </button>
        <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'x'}} onClick={() => { setPanel(null); setSpot(null); switching.open({viewId:view.id,kind:'x'}, switchAxisRef); }} />
        {/* A radio group, not a toggle whose label is its own state: «Vertical» on a
            button says nothing about whether that is what the chart IS or what the click
            would DO. `Seg` and not a second copy of its markup: T13 gave the group a
            roving tabindex and an arrow walk, and a hand-rolled twin on this card would
            be the one segmented control in the window that does not answer ← →. */}
        {isDate ? null : (
          <span className="sp-rb-chip sp-rb-chip--seg">
            <Seg
              label="Orientation"
              value={view.orientation}
              options={ORIENTATIONS.map((o) => [o, word(o)])}
              onPick={(o) => patch((s) => setOrientation(s, view.id, o))}
            />
          </span>
        )}
        {isDate ? null : (
          <span className="sp-rb-chip sp-rb-chip--num">
            <label className="sp-rb-chip-l" htmlFor={`${uid}-topn`}>Top N</label>
            <input
              id={`${uid}-topn`}
              type="number"
              className="sp-inp sp-inp--sm sp-rb-num"
              min={1}
              max={LIMITS.chartTopN}
              placeholder="All"
              title={`1 to ${LIMITS.chartTopN}, or empty to draw every row`}
              value={view.topN == null ? '' : view.topN}
              onChange={(e) => {
                const raw = String(e.target.value).trim();
                if (raw === '') { patch((s) => setTopN(s, view.id, null)); return; }
                const n = Number(raw);
                // Nothing is clamped (§9). A number outside the range is STORED and the
                // validator names it; text that is not a number at all is not a number the
                // author typed, it is a keystroke on the way to one.
                if (Number.isInteger(n)) patch((s) => setTopN(s, view.id, n));
              }}
            />
          </span>
        )}
        <button type="button" className="sp-rb-chip sp-rb-chip--act" ref={axesRef} onClick={() => { setSpot(null); setPanel('axes'); }}>
          Axes
        </button>
        <button
          type="button"
          className="sp-rb-chip sp-rb-chip--act"
          ref={presentationRef}
          onClick={() => { setSpot(null); setPanel('presentation'); }}
        >
          {presentationSummary(view)}
          {' '}
          <span className="sp-rb-caret" aria-hidden="true">▾</span>
        </button>
      </div>

  </>);

  return (
    <ViewFrame
      embedded={embedded}
      view={view} spec={spec} first={first} last={last}
      onMove={onMove} onDropAt={onDropAt} onRemove={onRemove}
      onTitle={(title) => patch((s) => setViewTitle(s, view.id, title))}
    >
      {!embedded && viewSettings}
      {embedded && <h3 className="sp-inspector-section-title">Series</h3>}

      <div className="sp-rb-els">
        {/* §9's `incomplete`, on the card the banner above is about: an empty required slot
            says the next step where the reader is looking, instead of leaving a blank strip
            over the button that fills it. */}
        {series.length === 0 && <div className="sp-rb-empty">{ADD_FIRST.chart}</div>}
        {series.map((s, i) => (
          <Fragment key={s.id}>
          <SeriesRow
            series={s}
            spec={spec}
            side={sides[s.id] || (s.axis === 'right' ? 'right' : 'left')}
            index={palIndex(s, i)}
            skipped={s.kind === 'calc' && !isDate}
            // The drag carries THIS chart's own type, so a series let go on another card's
            // rows is a drop nothing is listening for (T17).
            dragType={seriesDrag}
            onDropAt={(dragged, place) => patch((sp) => moveSeriesTo(sp, view.id, dragged,
              dropIndex(idsOf(sp, view.id, 'series'), dragged, s.id, place)))}
            btnRef={(el) => { if (el) rowEls.current.set(s.id, el); else rowEls.current.delete(s.id); }}
            open={panel?.kind === 'series' && panel.id === s.id}
            onOpen={() => { setSpot(null); setMore(false); setPanel({ kind: 'series', id: s.id }); }}
            onRemove={() => {
              patch((sp) => removeSeries(sp, view.id, s.id));
              if (panel?.id === s.id) setPanel(null);
            }}
          />
          {s.kind !== 'calc' && s.guide && <GuideRow
            guide={s.guide} spec={spec} accumulate={s.accumulate} quiet={s.hidden || !!s.guide.calc && !isDate}
            error={guideProblems.find((problem) => problem.pointer.startsWith(`${seriesAt(spec, view.id)}/${i}/guide`))?.detail
              || (s.guide.calc && !isDate ? 'A calculated Guide needs a date axis.' : null)}
            btnRef={(el) => { if (el) guideEls.current.set(s.id, el); else guideEls.current.delete(s.id); }}
            open={panel?.kind === 'guide' && panel.id === s.id}
            onOpen={() => { setSpot(null); setPanel({ kind: 'guide', id: s.id }); }}
            onRemove={() => removeGuide(s.id)}
          />}
          <HighlightChildren owner={s} ownerType="series" lineStyle={s.style?.type}
            addLabel="+ Highlight" beforeAdd={s.kind !== 'calc' && !s.guide ? <button type="button"
              className="wgf-add sp-content-add" aria-label="Add guide"
              onClick={(event) => { directGuideRef.current = event?.currentTarget || null; openSpot('guide', s.id, true); }}>+ Guide</button> : null}
            allowContextExpressions={highlightContextExpressionsAvailable(s.value, spec)}
            cm={highlightCmSlots(view, 'series', s, spec, scopeEnv)}
            dependencies={{ guide: !!s.guide }} formulaScope={formulaScopeFor(view.x, scopeEnv)}
            referencePreview={formulaPreview ? (kind) => kind === 'guide' && s.guide
              ? formulaPreview(widget, { kind: 'chartGuide', viewId: view.id, elementId: s.id }) : null : undefined}
            onEditingChange={onDraftInvalid} onOpen={() => { setRestoreGuideFocus(false); setPanel(null); setSpot(null); }}
            onChange={(highlights) => patch((current) => patchSeries(current, view.id, s.id, { highlights }))} />
          </Fragment>
        ))}
      </div>

      <button
        type="button"
        className="wgf-add sp-rb-addel"
        // aria-disabled, never disabled (§10.3): the cap this button prints IS the reason,
        // and a control nobody can put focus on cannot deliver one. The guard below is
        // what makes the attribute true.
        aria-disabled={atCap ? true : undefined}
        onClick={() => { if (!atCap) openSpot('add'); }}
      >
        + Add series
        {/* The count is on screen at ALL times, not only in a tooltip (§1.1.3: a reason is
            visible, or it is not a reason). It is also how the cap stops being a surprise —
            a reader watching it climb knows what the fourth series costs before they spend
            it — and, since T13, it is the whole of what the refused button says. */}
        <span className="sp-rb-cap">{` · ${series.length} of ${LIMITS.series}`}</span>
      </button>

      {embedded && <details className="sp-inspector-details"><summary>Axes & presentation</summary><div className="sp-inspector-detail-body">{viewSettings}</div></details>}

      {open ? (
        <SeriesPopover
          key={open.id}
          env={env}
          widget={widget}
          view={view}
          series={open}
          anchorRef={anchorRef}
          valueRef={valueRef}
          more={more}
          onMore={setMore}
          patch={patch}
          onPickValue={() => openSpot('value', open.id)}
          onMakeSwitchable={() => { switching.open({viewId:view.id,kind:'series',elementId:open.id}, anchorRef); setPanel(null); }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {openGuide && <GuidePopover key={openGuide.id} env={env} widget={widget} view={view} series={openGuide}
        anchorRef={anchorRef} valueRef={valueRef} patch={patch}
        onPickValue={() => openSpot('guide', openGuide.id)}
        onClose={() => setPanel(null)} onRemove={() => removeGuide(openGuide.id)} />}

      {panel === 'axes' ? (
        <AxesPopover
          view={view}
          anchorRef={axesRef}
          onClose={() => setPanel(null)}
          onFormat={(side, format) => patch((s) => setAxisFormat(s, view.id, side, format))}
        />
      ) : null}

      {panel === 'presentation' ? (
        <ChartPresentationPopover
          view={view}
          anchorRef={presentationRef}
          patch={patch}
          onClose={() => setPanel(null)}
        />
      ) : null}

      <Spotlight
        open={!!spot}
        context={{ label: spot ? SPOT_LABEL[spot.mode] : '', anchor: spot ? SPOT_ANCHOR[spot.mode] : '' }}
        items={items}
        step={step}
        // An X axis is not a value, so there is no formula to write there.
        formulaSlot={spot && spot.mode !== 'x' ? {
          value: spot.mode === 'guide' ? series.find((s) => s.id === spot.seriesId)?.guide?.value : series.find((s) => s.id === spot.seriesId)?.value,
          ...formulaScope,
          // The mart-metrics inventory travels with the slot, so the door at the bottom of
          // the value map says what FormulaField and the full editor already say.
          availableMetrics: env.availableMetrics,
          // …and the PACING's CM360 verdict (§2.5), beside the SLOT's join that the spread
          // above already carries.
          cmUnavailable: cmRefusal({ ...sourceEnv(env), datasetType }),
          onCommit: onFormula,
          previewFormula: formulaPreview ? previewFormula : undefined,
          onDraftState: (bad) => onDraftInvalid?.(bad),
        } : null}
        onPick={onSpotPick}
        onClose={cancelSpot}
      />
      {switching.dialog}
    </ViewFrame>
  );
}

/** One compact chip says the four chart-level presentation choices without opening the
 * panel. They remain separate authored fields; this is only their at-rest summary. */
function presentationSummary(view) {
  const bits = [view.titleAuto ? 'auto title' : 'manual title'];
  if (view.x && view.x.type === 'date') bits.push(view.x.domain === 'factDates' ? 'fact dates' : 'calendar');
  bits.push(view.emptyBehavior === 'hide' ? 'hide empty' : 'show empty');
  if (view.journal) bits.push('journal');
  return `Display · ${bits.join(' · ')}`;
}

/** Chart-level presentation stays four short explicit rows. The popover is deliberately not
 * an Options drawer: no nested scroll region, no metrics, and no unrelated settings. */
function ChartPresentationPopover({ view, anchorRef, patch, onClose }) {
  const isDate = !!view.x && view.x.type === 'date';
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Chart display" width={324}>
      <PopRow label="Title">
        <Seg
          label="Chart title" value={!!view.titleAuto}
          options={[[false, 'Manual'], [true, 'Automatic']]}
          onPick={(enabled) => patch((spec) => setChartTitleAuto(spec, view.id, enabled))}
        />
      </PopRow>
      {isDate ? (
        <PopRow label="Dates">
          <Seg
            label="Date domain" value={view.x.domain || 'calendar'}
            options={DATE_DOMAINS.map((domain) => [
              domain, domain === 'factDates' ? 'Facts only' : 'Calendar',
            ])}
            onPick={(domain) => patch((spec) => setChartDateDomain(spec, view.id, domain))}
          />
        </PopRow>
      ) : null}
      <PopRow label="No data">
        <Seg
          label="Empty behavior" value={view.emptyBehavior || 'placeholder'}
          options={EMPTY_BEHAVIORS.map((behavior) => [
            behavior, behavior === 'hide' ? 'Hide chart' : 'Show message',
          ])}
          onPick={(behavior) => patch((spec) => setChartEmptyBehavior(spec, view.id, behavior))}
        />
      </PopRow>
      {isDate ? (
        <PopRow label="Journal">
          <Seg
            label="Journal overlay" value={!!view.journal}
            options={[[false, 'Off'], [true, 'On']]}
            onPick={(enabled) => patch((spec) => setChartJournal(spec, view.id, enabled))}
          />
        </PopRow>
      ) : null}
    </Popover>
  );
}

/* ── one series, as a row ─────────────────────────────────────────────────── */

/**
 * «Legible at rest» (§3): swatch, name, where it is read from, and the one-line summary of
 * everything the popover would show. The swatch is an inline glyph INSIDE the row — never a
 * left-edge bar (the project's hard ban on vertical colour stripes) — and the colour is
 * never the only distinction: every setting it stands for is also in the words beside it.
 *
 * Since T17 the row also carries a `⋮⋮` grip and is a drop target for its own list. Like the
 * card's, the grip is `aria-hidden` and no Tab stop: `Order ▲▼` inside the row's popover is
 * the keyboard path, and it is unchanged.
 */
export function SeriesRow({
  series, spec, side, index, skipped, dragType: type, onDropAt, btnRef, onOpen, onRemove, open,
}) {
  const row = useRef(null);
  const drag = useRowDrag(type, series.id, (dragged, place) => onDropAt?.(dragged, place), row);
  const isCalc = series.kind === 'calc';
  const resolved = isCalc ? null : resolveValue(series.value, spec, null);
  // Through `view-text.js`, because the row is no longer the only thing that names a
  // series: the draft-state banner reports a refusal about one, and it has to call it what
  // this row calls it (P3 T11).
  const label = seriesName(series, spec);
  const bound = !isCalc && !!series.value && series.value.kind === 'bound';
  const source = isCalc || bound ? null : valueReadsCm(resolved) ? 'CM' : resolved?.kind === 'metric' ? 'BQ' : null;
  const summary = isCalc
    ? (skipped ? SKIPPED : STANDALONE)
    : [
      series.style && series.style.type,
      series.style && series.style.bars === 'stacked' ? 'stacked' : null,
      `${side === 'right' ? 'right' : 'left'} axis`,
      series.color === 'auto' ? null : 'custom color',
      series.dashed ? 'dashed' : null,
      series.accumulate === 'cumulative' ? 'cumulative' : null,
      series.hidden ? 'hidden' : null,
    ].filter(Boolean).join(' · ');
  return (
    <ContentRow rowRef={row} buttonRef={btnRef} label={label} summary={summary}
      buttonProps={{ 'data-content-id': series.id }}
      quiet={series.hidden || skipped} className={drag.cls} rowProps={drag.boxProps} onOpen={onOpen} open={open}
      handle={<span className="sp-rb-hndl" aria-hidden="true" title="Drag to reorder" {...drag.handleProps}>⋮⋮</span>}
      marker={<span
          className={`sp-rb-sw${series.dashed || isCalc ? ' sp-rb-sw--dash' : ''}`}
          style={{ background: chartPaint(series.color, index) }}
          aria-hidden="true"
        />}
      actions={<button type="button" className="sp-rb-btn sp-rb-btn--rm"
        title="Remove series" aria-label={`Remove ${label}`} onClick={onRemove}>×</button>}
    >
        {/* The spaces ride in the TEXT, the same rule the Data chips follow: these are flex
            items, so the row's gap draws the separation and flexbox eats a leading space —
            while anything reading `textContent` gets a sentence and not «Impressions⇄BQ». */}
        {bound ? (
          <>
            {' '}
            <span className="sp-rb-bind" role="img" aria-label="follows the metric switch">⇄</span>
          </>
        ) : null}
        {source ? (
          <>
            {' '}
            <span className={`sp-rb-src${source === 'CM' ? ' sp-rb-src--cm' : ''}`}>{source}</span>
          </>
        ) : null}
    </ContentRow>
  );
}

/** A fixed or daily reference appears directly under its owner. */
export function GuideRow({ guide, spec, accumulate, quiet, btnRef, onOpen, onRemove, open, error }) {
  const errorId = useId();
  const resolved = resolveValue(guide.value, spec, null);
  const valueLabel = guide.calc ? calculatedGuideLabel(guide, accumulate) : autoLabel(resolved) || 'Choose a value';
  const label = guide.label || valueLabel;
  const source = valueReadsCm(resolved) ? 'CM' : guide.value?.kind === 'metric' ? 'BQ' : null;
  // A calculated Guide names no metric of its own: it IS the parent's plan, so the row
  // says only which mode it draws.
  const summary = [guide.label && valueLabel !== label ? valueLabel : null,
    guide.calc ? guide.modeControlId ? 'Plan / Reforecast' : guide.mode === 'reforecast' ? 'Reforecast' : 'Plan' : null,
    !guide.calc && guide.invert ? 'Lower is better' : null,
    guide.labelPlacement === 'plotTopRight' ? 'Plot top right' : null].filter(Boolean).join(' · ');
  return <div className="sp-content-item">
    <ContentRow nested roleLabel="Guide" label={label} summary={summary} quiet={quiet}
      buttonRef={btnRef} onOpen={onOpen} open={open}
      buttonProps={{ 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }}
      actions={<button type="button" className="sp-rb-btn sp-rb-btn--rm" title="Remove guide" aria-label="Remove guide" onClick={onRemove}>×</button>}>
      {source && <> <span className={`sp-rb-src${source === 'CM' ? ' sp-rb-src--cm' : ''}`}>{source}</span></>}
    </ContentRow>
    {error && <div id={errorId} className="sp-lay-refusal" role="status">{error}</div>}
  </div>;
}

/** The grammar's own rule restated before the pick (spec 2026-09-10 «The child»): every value
 *  the series can show must be a metric the pacing engine plans — im, cl, coViews or sp. */
function guideCalculationRefusal(series, spec) {
  if (!series || series.kind === 'calc') return 'A calculated Guide belongs to a value series.';
  if (!highlightContextExpressionsAvailable(series.value, spec)) return 'A calculated Guide needs a Delivery value.';
  const value = series.value;
  const bound = value?.kind === 'bound';
  const options = bound
    ? (spec.controls || []).find((control) => control?.type === 'metric')?.options?.map((option) => option?.value) || []
    : [value];
  // A bound value with no switch to follow has nothing the plan could be read off — never an
  // empty `every`, which would offer a Guide the grammar cannot resolve.
  if (options.length && options.every((option) => guideBasisOf(option))) return null;
  return bound && options.length
    ? 'Every Metric switch option must be measured in impressions, clicks, views or spend for a calculated Guide.'
    : 'A calculated Guide needs a series measured in impressions, clicks, views or spend.';
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

/** The env a REPLACE pick is judged in: this series' own accumulate and axis, and the
 *  families of every OTHER series — the value being replaced is not a neighbour. */
function valueEnv(view, spec, seriesId) {
  const s = arr(view.series).find((x) => x.id === seriesId);
  return {
    accumulate: s && s.accumulate,
    axis: s && s.axis,
    axisFamilies: axisFamilies(view, spec, seriesId),
  };
}
