// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/TableCard.jsx
//
// THE TABLE CARD (widget-builder v2 §5.2, mockup §2). One card in the builder's Views list:
// the table's own settings as chips, its columns as ROWS, and one `+ Add column` that opens
// the Spotlight.
//
// It takes the CARD INTERFACE `ChartCard.jsx` states — the same nine props, handed down by
// the builder's Views map — and follows the same three rules of §5.1/§5.2:
//
//   · THE GRAIN IS DATA, NOT LOOK. `setRows` writes the row grain and touches nothing else:
//     the columns, the authored sort, the totals row and the limit all stay where they were.
//     A Δ% column that the new grain refuses is KEPT and named by the validator (§9's
//     context conflict, with Fix or Undo) — never deleted under the author.
//   · EVERY REFUSAL IS THE GRAMMAR'S. The cap sentence and the two halves of the Δ% rule
//     are asked of `validateReportDraft` on the very draft the pick would have produced
//     (`ask-grammar.js`), so what the map prints is `normColumn`'s own sentence.
//   · LEGIBLE AT REST. A column row says its name, where it is read from and the format it
//     prints, so the whole table is reviewable without opening a single popover (§3).
//
// A NOTE ON IDS, inherited from the chart card: a new column's id is minted from the spec
// THIS RENDER holds, before the patch — an id computed inside a functional setState is not
// readable when the popover has to be told which row to open on.
import { SwitchAction, useContextualSwitch } from './ContextualSwitch.jsx';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import Spotlight from '../Spotlight.jsx';
import { formulaScopeFor } from '../formula-scope.js';
import { LIMITS, ROW_SORT_KEY } from '../report-v2.js';
import { CATALOG, DUAL_SOURCE_ENTRIES, mintValue } from '../metric-catalog.js';
import { grainTypeOf, resolveValue } from '../report-render.js';
import {
  addColumn, datasetTypeOf, moveColumnTo, newNodeId, patchColumn, removeColumn,
  setLimit, setRows, setShare, setSort, setTotals, setViewTitle, setViewSettings, validateReportDraft,
} from '../report-draft.js';
import { cmRefusal, deltaMetricStep, dimPlanEnv, sourceEnv, sourceStep, sourcesFor, spotlightItems, valueReadsCm } from '../spotlight-items.js';
import { formulaValue } from './FormulaEditorDialog.jsx';
import ColumnPopover from './ColumnPopover.jsx';
import TargetPopover from './TargetPopover.jsx';
import SortPopover from './SortPopover.jsx';
import ViewFrame from './ViewFrame.jsx';
import ContentRow from './ContentRow.jsx';
import HighlightChildren from './HighlightChildren.jsx';
import { highlightContextExpressionsAvailable, highlightCmSlots } from './highlight-capabilities.js';
import { dragType, dropIndex, idsOf, useRowDrag } from './reorder.js';
import { ADD_FIRST } from './draft-states.js';
import { columnName, grainName, valueName } from './view-text.js';
import { columnsAt, refusalAt } from './ask-grammar.js';
import { formatFor, formatForValue, formatWord } from './column-format.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The Spotlight's context pill, per door — each says which slot is being filled (§4). */
const SPOT_LABEL = {
  __proto__: null, add: 'Add to: Table', rows: 'Table rows', value: 'Column value', target: 'Column totals target',
};
const SPOT_ANCHOR = { __proto__: null, add: 'table', rows: 'rows', value: 'column', target: 'target' };
const NO_ITEMS = [];
/** What a Rows-map pick MEANS, by the namespace of its id: a dimension key, the dimension
 *  SWITCH (M4), or one of the fixed grains. ChartCard's `xGrain`, over the one grain list
 *  that carries `dateLi`. */
function rowGrain(id, dimensionControl) {
  if (id.startsWith('rows:dim:')) return { type: 'dim', key: id.slice('rows:dim:'.length) };
  if (id === 'rows:control') return { type: 'control', controlId: dimensionControl && dimensionControl.id };
  return { type: id.slice('rows:'.length) };
}
/** The Δ% offer that follows «Both sources» (§1.1.4: the mockup adds one on its own; here
 *  it is a question, because two columns side by side is also a finished answer). */
const DELTA_OFFER_Q = 'Compare the two with a Δ% column?';
const DELTA_STEP_Q = 'Compare which metric:';
/** A Δ% prints (CM − BQ) / BQ, which is a ratio — so it is born printing a percentage.
 *  `auto` would drop the % sign off it, which is a wrong number and not a wrong style. */
const DELTA_FORMAT = 'percent';
/** The metric a trial Δ% is built on when the card asks the grammar what it thinks of one.
 *  Impressions is the field every pacing and every CM360 export carries. */
const TRIAL_METRIC = CATALOG.find((e) => e.id === 'field:im');

export default function TableCard({
  view, spec, widget, env, patch, first, last, onMove, onDropAt, onRemove, onDraftInvalid,
  embedded = false, formulaPreview,
}) {
  const switching = useContextualSwitch(widget, env, patch);
  const uid = useId();
  const rowEls = useRef(new Map());
  const targetEls = useRef(new Map());
  const anchorRef = useRef(null);
  const valueRef = useRef(null);
  // The Sort chip is the only control here that ANCHORS a panel: the Spotlight is modal and
  // hands focus back to whatever opened it, so the Rows chip and `+ Add column` need no ref.
  const switchAxisRef = useRef(null);
  const sortRef = useRef(null);
  const [panel, setPanel] = useState(null);
  const [more, setMore] = useState(false);
  const [spot, setSpot] = useState(null);
  // A pick has to arrive as a NEW object or the shell hands back the step it is already
  // hiding (T5's measured trap), so the pick IS the state and every one of them is fresh.
  const [pick, setPick] = useState(null);
  // The row the popover opens on NEXT, once the patch has landed and it is in the DOM.
  const [pending, setPending] = useState(null);

  const columns = arr(view.columns);
  const datasetType = datasetTypeOf(spec);
  // The grain this card JUDGES by, which is the grain the tile runs down: a control grain
  // is the dimension grain it resolves to (M4), so the column map and the formula palette
  // refuse what a dimension refuses. The Rows chip still names the SWITCH — `grainName`
  // reads the stored grain, because the switch is what the author chose.
  const rowType = grainTypeOf(view.rows);
  // …and its KEY, for the one rule that needs the grain itself rather than its type: a
  // `ds:` grain is judged by its source's own metric list, not the delivery inventory
  // (metric-catalog's `grainKey`). A control grain resolves to whichever dimension the
  // viewer lands on, which the builder cannot know, so it names none.
  const rowKey = typeof view.rows?.key === 'string' ? view.rows.key : null;
  const atCap = columns.length >= LIMITS.columns;
  const freeSlots = LIMITS.columns - columns.length;
  const metricControl = arr(spec.controls).find((c) => c && c.type === 'metric') || null;
  const dimensionControl = arr(spec.controls).find((c) => c && c.type === 'dimension') || null;
  // Does this pacing declare targets on the dimension the rows are cut by (2026-09-12)? One
  // answer, read by the column map and by the formula palette, so the Spotlight and the
  // select on the same row cannot disagree about a field.
  const dimPlanEligible = dimPlanEnv(env, rowKey, dimensionControl);
  // The env every formula palette on this card reads — the builder's, plus that one answer.
  const scopeEnv = useMemo(() => ({ ...env, dimPlanEligible }), [env, dimPlanEligible]);
  // What the Row share may be read FROM on the CM360 side (§2.6). The three counts are the
  // whole CM360 vocabulary — `DUAL_SOURCE_ENTRIES`, the same list the Δ% column and the
  // compare switch offer, so a fourth CM360 field arrives in all three at once — and they are
  // offered only on a widget that carries the file. On a delivery report this is `NO_ITEMS`
  // and the select is exactly what it was.
  //
  // …and only where the ROWS join, which is FormulaField's rule for the CM360 group written
  // out one screen over: a group that is dead on every row of this grain is noise rather than
  // discovery. `li` and `dateLi` carry nothing to join on, so §2.6 answers such a share with
  // NO_CM_JOIN at render — an option that looks pickable, saves, and then refuses itself.
  const shareCmEntries = datasetType === 'deliveryCm360'
    && formulaScopeFor(view.rows || { type: 'date' }, scopeEnv).cm ? DUAL_SOURCE_ENTRIES : NO_ITEMS;
  const shareValue = isObj(view.share) ? view.share.value : null;
  // …and WHICH of them a stored cm share is. A cm value is stored under its CM NAME on either
  // dataset (`mintValue`), so that is the spelling to match. Without this the select would
  // fall through to «fixed», print the value's name, and leave no way to move to another
  // count — a picker that looks settled on a row it cannot re-pick.
  const shareCmEntry = shareValue && shareValue.kind === 'metric' && shareValue.source === 'cm'
    ? shareCmEntries.find((e) => (e.cmName || e.key) === shareValue.metric) || null
    : null;
  // The pointer every refusal about THIS table's columns starts with. `null` when the view
  // is gone from under an open panel — there is nothing to ask about then.
  const colsAt = columnsAt(spec, view.id);
  // What the tile UNDER the card is sorting by (`buildReportTableModel`'s own default: the
  // row itself, ascending). The chip says what is drawn, and `sort` absent is what the
  // grammar reads as «nothing was authored».
  const sort = view.sort || { columnId: ROW_SORT_KEY, dir: 'asc' };

  // §3: after a Spotlight pick the popover REOPENS on the new element with focus on Value.
  // In an effect keyed on the id, because the row it hangs from has to be in the DOM first.
  useEffect(() => {
    if (!pending) return;
    const next = typeof pending === 'string' ? { kind: 'column', id: pending } : pending;
    if (!columns.some((c) => c.id === next.id)) return;
    setPanel(next);
    setPending(null);
  }, [pending, columns]);

  const closeSpot = () => {
    setSpot(null); setPick(null); onDraftInvalid?.(false);
    if (spot?.mode === 'target') setPanel({ kind: columns.some((c) => c.id === spot.columnId && c.target) ? 'target' : 'column', id: spot.columnId });
  };
  const openSpot = (mode, columnId) => { setPanel(null); setPick(null); setSpot({ mode, columnId }); };

  /* ── adding ───────────────────────────────────────────────────────────── */

  /** N ids no element in this spec carries, each RESERVED before the next is asked for —
   *  so «Both sources» does not name its two columns the same thing. */
  const mintIds = (n) => {
    const out = [];
    let s = spec;
    for (let i = 0; i < n; i += 1) {
      const id = newNodeId(s, 'col');
      out.push(id);
      s = { ...s, views: [...arr(s.views), { id }] };
    }
    return out;
  };

  /**
   * One value column, printing the format the METRIC is measured in (§1.1.4: automation
   * fills an empty default, and a column that does not exist yet has nothing but one).
   * Looked at on screen: with `auto` — which is what `addView` mints —
   * a Client cost column prints «11,095.07» with no currency mark and a CTR column prints
   * «0.13» with no percent sign, because `fmtV2`'s `auto` only decides whole against
   * fractional. Those are wrong NUMBERS, not a style nobody chose.
   *
   * A value with no catalog entry behind it (a bound one, a typed formula) declares no one
   * family here, so it keeps `auto` — a table cell is the one slot the grammar allows it in.
   */
  const addOne = (s, id, value, format = 'auto') => addColumn(s, view.id, { id, value, format });
  /** A Δ% column, on the dual-source form `isDualSource` reads (§5.2). */
  const deltaCol = (id, value) => ({ id, kind: 'delta', value, format: DELTA_FORMAT });
  const trialDelta = (s) => addColumn(s, view.id, deltaCol(newNodeId(s, 'col'),
    mintValue(TRIAL_METRIC, { source: 'bq', datasetType: datasetTypeOf(s) })));

  const addValue = (entry, source) => {
    const [id] = mintIds(1);
    // The row to open on is named BEFORE the patch: React batches the two into one commit,
    // and the effect that opens the popover has to see both at once.
    setPending(id);
    patch((s) => addOne(s, id, mintValue(entry, { source, datasetType: datasetTypeOf(s) }), entry.defaultFormat));
    closeSpot();
  };

  const addBound = () => {
    const [id] = mintIds(1);
    setPending(id);
    patch((s) => addOne(s, id, { kind: 'bound' }));
    closeSpot();
  };

  /** A Δ% column. `presetId` is the offer's own reserved id (see `addBoth`); every other
   *  door mints one here. The value is minted against the draft it LANDS in, which is what
   *  gives it the CM name on a CM360 widget — the form `isDualSource` reads. */
  const addDelta = (opt, presetId) => {
    const id = presetId || mintIds(1)[0];
    setPending(id);
    patch((s) => addColumn(s, view.id, deltaCol(id, opt.bound
      ? { kind: 'bound' }
      : mintValue(opt.entry, { source: 'bq', datasetType: datasetTypeOf(s) }))));
    closeSpot();
  };

  /**
   * «Both sources» adds two columns — and then OFFERS the Δ% that compares them (§1.1.4:
   * the mockup adds one on its own; nothing here decides for the author). The Spotlight
   * stays open on the question, so the two columns are already in the draft while it is
   * asked; the answer is what does or does not add a third.
   */
  const addBoth = (entry, sources) => {
    const [a, b, d] = mintIds(3);
    const two = (s) => {
      const one = addOne(s, a, mintValue(entry, { source: sources[0], datasetType: datasetTypeOf(s) }), entry.defaultFormat);
      return addOne(one, b, mintValue(entry, { source: sources[1], datasetType: datasetTypeOf(one) }), entry.defaultFormat);
    };
    patch(two);
    // The offer is judged on the spec THIS render holds plus the two columns — the patch
    // above has not travelled up to the drawer and back yet, and `two` is pure.
    const after = two(spec);
    const why = refusalAt({ ...widget, spec: after },
      addColumn(after, view.id, deltaCol(d, mintValue(entry, { source: 'bq', datasetType }))), colsAt);
    // The cap is COUNTED here as well as asked. `N of 12` is this card's own promise, printed
    // on the button, and `normReport` answers with the first problem and stops — so on a draft
    // that already carries a fault elsewhere it never reaches this trial column and `why` comes
    // back empty (see `ask-grammar.js`). Two columns have just landed, so a third needs three.
    // The SENTENCE stays the grammar's: `null` when it could not answer, which is the same
    // honest silence the map's own Δ% row degrades to rather than a second wording of the cap.
    const noRoom = freeSlots < 3;
    const yes = { id: 'delta:yes', label: 'Add a Δ% column' };
    if (why || noRoom) { yes.disabled = true; yes.reason = why || null; }
    setPick({
      mode: 'both', entry, firstId: a, deltaId: d,
      question: DELTA_OFFER_Q,
      options: [yes, { id: 'delta:no', label: 'Just the two columns' }],
    });
  };

  /* ── filling a slot that already exists ───────────────────────────────── */

  /** Write a value into a column, and with it the format `formatFor` decides (§1.1.4). The
   *  format is read off the column THIS render holds, which is the one the author is
   *  looking at; nothing else on the column moves. */
  const writeValue = (columnId, value, entry) => {
    const cur = columns.find((c) => c.id === columnId);
    const p = cur ? { value, format: entry ? formatFor(cur.format, entry) : formatForValue(cur.format, value, spec, cur.kind !== 'delta') } : { value };
    patch((s) => patchColumn(s, view.id, columnId, p));
  };

  const setValue = (columnId, entry, opt) => {
    const value = opt.bound ? { kind: 'bound' } : mintValue(entry, { source: opt.source, datasetType });
    writeValue(columnId, value, opt.bound ? null : entry);
    reopen(columnId);
  };

  /** Back to the panel this Spotlight replaced, on the element it was opened from (§3). */
  const reopen = (columnId) => {
    setSpot(null); setPick(null); onDraftInvalid?.(false);
    setPanel({ kind: 'column', id: columnId });
  };

  const setTargetValue = (columnId, value, entry = null) => {
    const column = columns.find((c) => c.id === columnId);
    const format = entry ? formatFor(column?.target?.format || entry.defaultFormat, entry)
      : formatForValue(column?.target?.format || 'auto', value, spec);
    patch((s) => patchColumn(s, view.id, columnId, { target: { ...column?.target, value, format } }));
    setSpot(null); setPick(null); onDraftInvalid?.(false);
    setPending({ kind: 'target', id: columnId });
  };

  /* ── the Spotlight ────────────────────────────────────────────────────── */

  const adding = !!spot && spot.mode === 'add';
  // Only while the map is OPEN: this is two `normReport` runs, and the map is modal, so it
  // costs nothing on the renders the author spends typing somewhere else in the window.
  const deltaRefusal = useMemo(
    () => (adding ? refusalAt(widget, trialDelta(spec), colsAt) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adding, widget, spec, view.id, colsAt],
  );

  const pickEnv = useMemo(() => ({
    dims: env.dims,
    // What this PACING can serve (spec 2026-08-25 §4) — the CM pill on every dual-source
    // column row is judged from it, on this dataset and on the CM360 one alike.
    ...sourceEnv(env),
    // The Rows map's «follows the dimension switch» row (M4) — offered from the draft,
    // because only the draft knows whether this report has one.
    dimensionControl,
    datasetType,
    grain: spot?.mode === 'target' ? null : rowType,
    grainKey: rowKey,
    // …and whether THIS dimension is one the pacing declares a target on, which is what opens
    // the plan half of the map on a dim grain (2026-09-12). Computed here rather than read off
    // the grain, because a dimension switch has no key until the viewer picks one.
    dimPlanEligible,
    hasMetricControl: spot?.mode !== 'target' && !!metricControl,
    deltaRefusal,
  }), [env, dimensionControl, datasetType, rowType, rowKey, metricControl, deltaRefusal, spot?.mode, dimPlanEligible]);

  const items = spot ? spotlightItems(SPOT_ANCHOR[spot.mode], pickEnv) : NO_ITEMS;

  // Memoized on the PICK alone: the shell files a step the user typed past by identity, so
  // a fresh object every render would re-show a question they had already left.
  const step = useMemo(() => (pick ? {
    question: pick.question,
    options: pick.options,
    onPick: (o) => {
      const opt = pick.options.find((x) => x.id === o.id);
      if (!opt || opt.disabled) return;
      if (pick.mode === 'both') {
        if (opt.id === 'delta:yes') return addDelta({ entry: pick.entry }, pick.deltaId);
        setPending(pick.firstId);
        return closeSpot();
      }
      if (pick.mode === 'delta') return addDelta(opt);
      if (pick.mode === 'target') return setTargetValue(pick.columnId, mintValue(pick.entry, { source: opt.source, datasetType }), pick.entry);
      if (pick.mode === 'value') return setValue(pick.columnId, pick.entry, opt);
      if (opt.bound) return addBound();
      if (opt.sources) return addBoth(pick.entry, opt.sources);
      return addValue(pick.entry, opt.source);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null), [pick]);

  const onSpotPick = (item) => {
    const { mode, columnId } = spot;
    if (mode === 'rows') {
      patch((s) => setRows(s, view.id, rowGrain(item.id, dimensionControl)));
      closeSpot();
      return;
    }
    if (item.id.startsWith('delta:')) {
      // A Δ% is a column KIND, so the second question is not «from which source» — both
      // sides are the point — but «of which metric».
      setPick({
        mode: 'delta',
        question: DELTA_STEP_Q,
        options: deltaMetricStep({
          metricControl,
          boundRefusal: metricControl
            ? refusalAt(widget, addColumn(spec, view.id, deltaCol(newNodeId(spec, 'col'), { kind: 'bound' })), colsAt)
            : null,
        }),
      });
      return;
    }
    const entry = CATALOG.find((e) => e.id === item.id);
    if (!entry) return;
    const options = sourceStep(entry, {
      ...sourceEnv(env),
      datasetType,
      metricControl: mode === 'target' ? null : metricControl,
      freeSlots,
      // Only a LIST can take two elements, and a column's own value holds one.
      allowBoth: mode === 'add',
      addsTo: 'table',
    });
    if (!options) {
      const source = sourcesFor(entry, { ...sourceEnv(env), datasetType })[0];
      if (mode === 'add') return addValue(entry, source);
      if (mode === 'target') return setTargetValue(columnId, mintValue(entry, { source, datasetType }), entry);
      return setValue(columnId, entry, { source });
    }
    setPick({
      mode,
      columnId,
      entry,
      options,
      question: mode === 'add' ? `Add ${entry.label} as:` : `Read ${entry.label} from:`,
    });
  };

  const onFormula = (stored, family) => {
    const { mode, columnId } = spot;
    const value = formulaValue(stored, family);
    if (mode === 'add') {
      const [id] = mintIds(1);
      setPending(id);
      patch((s) => addOne(s, id, value));
      closeSpot();
      return;
    }
    if (mode === 'target') return setTargetValue(columnId, value);
    // A formula declares its own family, so nothing here re-mints the format: the author
    // said what the expression is in, and `badCellFormat` names a format that cannot print it.
    writeValue(columnId, value, null);
    reopen(columnId);
  };

  const previewFormula = (stored, unitFamily) => {
    const { mode, columnId } = spot;
    const value = formulaValue(stored, unitFamily);
    const elementId = mode === 'add' ? newNodeId(spec, 'formula_preview') : columnId;
    const column = columns.find((item) => item.id === elementId);
    const fields = mode === 'target'
      ? { target: { ...column?.target, value, format: formatForValue(column?.target?.format || 'auto', value, spec) } }
      : { value, format: formatForValue(column?.format, value, spec, column?.kind !== 'delta') };
    const next = mode === 'add' ? addOne(spec, elementId, value) : patchColumn(spec, view.id, elementId, fields);
    return formulaPreview({ ...widget, spec: next }, {
      kind: mode === 'target' ? 'tableTarget' : 'tableColumn', viewId: view.id, elementId,
    });
  };

  /* ── the render ───────────────────────────────────────────────────────── */

  const selected = panel && typeof panel === 'object' ? columns.find((c) => c.id === panel.id) : null;
  const open = panel?.kind === 'column' ? selected : null;
  const targetColumn = panel?.kind === 'target' && selected?.target ? selected : null;
  // Assigned during render because the popover reads it in a layout effect, which runs
  // before any effect of this component could. It is the row's BUTTON — see `ChartCard`'s
  // note: `.focus()` on a plain `<div>` is a no-op, so the panel's focus hand-off went to
  // <body> inside a trapped dialog.
  anchorRef.current = targetColumn ? targetEls.current.get(targetColumn.id) || null : open ? rowEls.current.get(open.id) || null : null;
  const targetProblems = useMemo(() => validateReportDraft(widget).problems, [widget]);

  // A totals target is one aggregate even on a date/dimension table. Column formulas
  // follow the rows, including only their own source's custom fields.
  const formulaScope = useMemo(() => formulaScopeFor(spot?.mode === 'target' ? { type: 'agg' } : (view.rows || { type: 'date' }), scopeEnv),
    [spot?.mode, view.rows, scopeEnv]);
  const columnDrag = dragType('column', view.id);

  const viewSettings = (<>
      <div className="sp-rb-row sp-rb-row--view">
        <button type="button" className="sp-rb-chip sp-rb-chip--act" ref={switchAxisRef} onClick={() => openSpot('rows')}>
          {`Rows: ${grainName(env, view.rows, spec)}`}
          {' '}
          <span className="sp-rb-caret" aria-hidden="true">▾</span>
        </button>
        <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'rows'}} onClick={() => { setPanel(null); setSpot(null); switching.open({viewId:view.id,kind:'rows'}, switchAxisRef); }} />
        <button
          type="button" className="sp-rb-chip sp-rb-chip--act" ref={sortRef}
          onClick={() => { setSpot(null); setPanel('sort'); }}
        >
          {/* «by» because the chip beside it is `Rows: Date` and this one was `Sort: Date` —
              two chips, one word, two different things it was doing to the table. One
              author still: the name is `grainName`/`columnName`, exactly as before. */}
          {`Sort: by ${sortName(view, spec, env, sort)} ${sort.dir === 'desc' ? '↓' : '↑'}`}
          {' '}
          <span className="sp-rb-caret" aria-hidden="true">▾</span>
        </button>
        {/* A CHECKBOX, not a two-button segment: `totals` is one required boolean, the
            native control says its own state without colour, and it carries the chip's
            height so this chip sits on the same baseline as the ones beside it. */}
        <label className="sp-rb-chip sp-rb-chip--ck">
          <input
            type="checkbox"
            className="sp-rb-ck"
            checked={!!view.totals}
            // The box is read HERE and not inside the mutator: `patch` hands that function to
            // a functional setState, which runs after this handler has returned — by then the
            // event's target is a live DOM node that may have moved on.
            onChange={(e) => { const on = e.target.checked; patch((s) => setTotals(s, view.id, on)); }}
          />
          {'Totals row'}
        </label>
        <span className="sp-rb-chip sp-rb-chip--num">
          <label className="sp-rb-chip-l" htmlFor={`${uid}-limit`}>Limit</label>
          <input
            id={`${uid}-limit`}
            type="number"
            className="sp-inp sp-inp--sm sp-rb-num"
            min={1}
            max={LIMITS.tableLimit}
            placeholder="All"
            title={`1 to ${LIMITS.tableLimit}, or empty to print every row`}
            value={view.limit == null ? '' : view.limit}
            onChange={(e) => {
              const raw = String(e.target.value).trim();
              if (raw === '') { patch((s) => setLimit(s, view.id, null)); return; }
              const n = Number(raw);
              // Nothing is clamped (§9). A number outside the range is STORED and the
              // validator names it; text that is not a number at all is a keystroke on
              // the way to one.
              if (Number.isInteger(n)) patch((s) => setLimit(s, view.id, n));
            }}
          />
        </span>
        <span className="sp-rb-chip sp-rb-chip--num min-w-0 max-w-full">
          <label className="sp-rb-chip-l shrink-0" htmlFor={`${uid}-share`}>{embedded ? 'Share percentage' : 'Row share'}</label>
          <select id={`${uid}-share`} className="sp-inp sp-inp--sm sp-pop-sel" aria-label={embedded ? 'Share percentage basis' : 'Row share basis'}
            value={shareCmEntry ? `cm:${shareCmEntry.id}`
              : shareValue ? (shareValue.kind === 'bound' ? 'metric' : 'fixed')
                : (view.share?.columnId ? `column:${view.share.columnId}` : '')}
            onChange={(e) => {
              const key = e.target.value;
              // «fixed» is a READ-OUT, not a pick: it names a share this card cannot mint — a
              // formula, a canonical, a value out of a Standard entry or the Library — and
              // choosing it again must leave that value exactly where it is.
              if (key === 'fixed') return;
              if (key.startsWith('cm:')) {
                const entry = shareCmEntries.find((x) => x.id === key.slice('cm:'.length));
                // Minted, never spread: the grammar accepts the three counts under their CM
                // names only, and `mintValue` is the one place that knows which name a source
                // and a dataset produce.
                if (entry) patch((s) => setShare(s, view.id, { value: mintValue(entry, { source: 'cm', datasetType }) }));
                return;
              }
              patch((s) => setShare(s, view.id, key === 'metric' ? { value: { kind: 'bound' } }
                : key ? { columnId: key.slice('column:'.length) } : null));
            }}>
            <option value="">None</option>
            {(metricControl || shareValue?.kind === 'bound') && <option value="metric">Current metric</option>}
            {shareCmEntries.map((e) => <option key={e.id} value={`cm:${e.id}`}>{`${e.label} · CM360`}</option>)}
            {shareValue && shareValue.kind !== 'bound' && !shareCmEntry
              && <option value="fixed">{valueName(shareValue, spec)}</option>}
            {columns.map((c) => <option key={c.id} value={`column:${c.id}`}>{columnName(c, spec)}</option>)}
          </select>
        </span>
      </div>
      {!embedded && <button type="button" className="sp-pop-more" aria-label="More table settings" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? '▾ Less' : '▸ More'}
      </button>}
      {embedded || more ? <div className="sp-rb-row sp-rb-row--view">
        {[
          ['search', 'Search rows'], ['residual', 'Show untagged remainder'], ['filterOnClick', 'Filter dashboard on row click'],
        ].map(([key, label]) => <label key={key} className="sp-rb-chip sp-rb-chip--ck">
          <input type="checkbox" className="sp-rb-ck" aria-label={label} checked={!!view[key]}
            disabled={key !== 'search' && rowType !== 'dim' && !view[key]}
            onChange={(e) => { const on = e.target.checked; patch((s) => setViewSettings(s, view.id, { [key]: on ? true : undefined })); }} />
          {label}
        </label>)}
        {rowType !== 'dim' ? <span className="sp-lay-help">Remainder and dashboard filtering need dimension rows.</span> : null}
      </div> : null}

  </>);

  return (
    <ViewFrame
      embedded={embedded}
      view={view} spec={spec} first={first} last={last}
      onMove={onMove} onDropAt={onDropAt} onRemove={onRemove}
      onTitle={(title) => patch((s) => setViewTitle(s, view.id, title))}
    >
      {!embedded && viewSettings}
      {embedded && <h3 className="sp-inspector-section-title">Columns</h3>}

      <div className="sp-rb-els">
        {/* The card half of §9's `incomplete` — the same instruction the banner carries for
            the whole draft, said where the missing piece is (see ChartCard). */}
        {columns.length === 0 && <div className="sp-rb-empty">{ADD_FIRST.table}</div>}
        {columns.map((c, index) => {
          const at = `${colsAt}/${index}/target`;
          const error = c.target && targetProblems.find((p) => p.pointer === at || p.pointer.startsWith(`${at}/`))?.detail;
          const errorId = `${uid}-${c.id}-target-error`;
          // …and the column's OWN value, which until now could block Save with nothing said
          // beside the row it came from. A CM360 formula on line-item rows is refused by the
          // slot (§2.5), and the author needs the sentence where the value is, not only in the
          // banner. The two pointers are disjoint: a target's problems live under `/target`.
          const valueAt = `${colsAt}/${index}/value`;
          const valueError = targetProblems.find((p) => p.pointer === valueAt || p.pointer.startsWith(`${valueAt}/`))?.detail;
          const valueErrorId = `${uid}-${c.id}-value-error`;
          return <Fragment key={c.id}>
          <ColumnRow
            column={c}
            spec={spec}
            error={valueError}
            errorId={valueErrorId}
            // The drag carries THIS table's own type, so a column let go on another card's
            // rows is a drop nothing is listening for (T17).
            dragType={columnDrag}
            onDropAt={(dragged, place) => patch((s) => moveColumnTo(s, view.id, dragged,
              dropIndex(idsOf(s, view.id, 'columns'), dragged, c.id, place)))}
            btnRef={(el) => { if (el) rowEls.current.set(c.id, el); else rowEls.current.delete(c.id); }}
            open={panel?.kind === 'column' && panel.id === c.id}
            onOpen={() => { setSpot(null); setPanel({ kind: 'column', id: c.id }); }}
            onRemove={() => {
              patch((s) => removeColumn(s, view.id, c.id));
              if (panel?.id === c.id) setPanel(null);
            }}
          />
          {/* The column's own refusal, under the row it came from, the same element the
              totals target's refusal uses so the two read as one thing. */}
          {valueError ? <div id={valueErrorId} className="sp-lay-refusal" role="status">{valueError}</div> : null}
          {c.target ? <ContentRow nested roleLabel="Totals target"
            buttonRef={(el) => { if (el) targetEls.current.set(c.id, el); else targetEls.current.delete(c.id); }}
            label={valueName(c.target.value, spec)} summary={`format ${formatWord(c.target.format)}`}
            open={panel?.kind === 'target' && panel.id === c.id}
            onOpen={() => { setSpot(null); setPanel({ kind: 'target', id: c.id }); }}
            buttonProps={{ 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }}>
            {c.target.value?.kind === 'metric' || valueReadsCm(c.target.value) ? <>{' '}<span className={`sp-rb-src${valueReadsCm(c.target.value) ? ' sp-rb-src--cm' : ''}`}>{valueReadsCm(c.target.value) ? 'CM' : 'BQ'}</span></> : null}
          </ContentRow> : null}
          {error ? <div id={errorId} className="sp-lay-refusal" role="status">{error}</div> : null}
          <HighlightChildren owner={c} ownerType="column" dependencies={{ target: !!c.target }}
            referencePreview={formulaPreview ? (kind) => kind === 'target' && c.target?.value
              ? formulaPreview(widget, { kind: 'tableTarget', viewId: view.id, elementId: c.id }) : null : undefined}
            allowContextExpressions={highlightContextExpressionsAvailable(c.value, spec, { delta: c.kind === 'delta' })}
            cm={highlightCmSlots(view, 'column', c, spec, scopeEnv)}
            formulaScope={formulaScopeFor(view.rows, scopeEnv)} onEditingChange={onDraftInvalid}
            onOpen={() => { setPanel(null); setSpot(null); }}
            onChange={(highlights) => patch((current) => patchColumn(current, view.id, c.id, { highlights }))} />
          </Fragment>;
        })}
      </div>

      <button
        type="button"
        className="wgf-add sp-rb-addel"
        // aria-disabled, never disabled (§10.3) — see ChartCard's own `+ Add series`.
        aria-disabled={atCap ? true : undefined}
        onClick={() => { if (!atCap) openSpot('add'); }}
      >
        + Add column
        {/* The count is on screen at ALL times, not only in a tooltip (§1.1.3: a reason is
            visible, or it is not a reason), and it is what the refused button says. */}
        <span className="sp-rb-cap">{` · ${columns.length} of ${LIMITS.columns}`}</span>
      </button>

      {embedded && <details className="sp-inspector-details"><summary>Rows & table settings</summary><div className="sp-inspector-detail-body">{viewSettings}</div></details>}

      {open ? (
        <ColumnPopover
          key={open.id}
          env={env}
          widget={widget}
          view={view}
          column={open}
          anchorRef={anchorRef}
          valueRef={valueRef}
          patch={patch}
          onPickValue={() => openSpot('value', open.id)}
          onMakeSwitchable={() => { switching.open({viewId:view.id,kind:'column',elementId:open.id}, anchorRef); setPanel(null); }}
          onPickTarget={() => openSpot('target', open.id)}
          onEditTarget={() => setPanel({ kind: 'target', id: open.id })}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {targetColumn ? <TargetPopover key={targetColumn.id} kind="table" spec={spec} target={targetColumn.target}
        env={env} anchorRef={anchorRef} valueRef={valueRef}
        onValue={(value, entry) => {
          const target = targetColumn.target;
          const format = entry ? formatFor(target.format || entry.defaultFormat, entry) : formatForValue(target.format || 'auto', value, spec);
          patch((s) => patchColumn(s, view.id, targetColumn.id, { target: { ...target, value, format } }));
        }}
        onChange={(fields) => patch((s) => patchColumn(s, view.id, targetColumn.id, { target: { ...targetColumn.target, ...fields } }))}
        onFormula={() => openSpot('target', targetColumn.id)}
        onRemove={() => {
          setPanel(null); patch((s) => patchColumn(s, view.id, targetColumn.id, { target: undefined }));
          rowEls.current.get(targetColumn.id)?.focus();
        }}
        onClose={() => setPanel(null)} /> : null}

      {panel === 'sort' ? (
        <SortPopover
          view={view}
          spec={spec}
          env={env}
          sort={sort}
          anchorRef={sortRef}
          onClose={() => setPanel(null)}
          onSort={(next) => patch((s) => setSort(s, view.id, next))}
        />
      ) : null}

      <Spotlight
        open={!!spot}
        context={{ label: spot ? SPOT_LABEL[spot.mode] : '', anchor: spot ? SPOT_ANCHOR[spot.mode] : '' }}
        items={items}
        step={step}
        // A row grain is not a value, so there is no formula to write there.
        formulaSlot={spot && spot.mode !== 'rows' ? {
          value: spot.mode === 'target' ? columns.find((c) => c.id === spot.columnId)?.target?.value : columns.find((c) => c.id === spot.columnId)?.value,
          ...formulaScope,
          // The slot in compile.js's words: which stored form a chip formula gets (decision h).
          slot: spot.mode === 'target' ? 'columnTarget' : 'column',
          // The mart-metrics inventory travels with the slot, so the door at the bottom of
          // the value map says what FormulaField and the full editor already say.
          availableMetrics: env.availableMetrics,
          // …and so does the PACING's CM360 verdict (§2.5): `...formulaScope` already carries
          // the SLOT's join, and this is the other half — no source, no rows, no mapping. The
          // pill row beside this door is refused by the same call, so the palette and the
          // picker cannot disagree about whether this pacing has CM360 to read.
          cmUnavailable: cmRefusal({ ...sourceEnv(env), datasetType }),
          onCommit: onFormula,
          previewFormula: formulaPreview ? previewFormula : undefined,
          onDraftState: (bad) => onDraftInvalid?.(bad),
        } : null}
        onPick={onSpotPick}
        onClose={closeSpot}
      />
      {switching.dialog}
    </ViewFrame>
  );
}

/* ── one column, as a row ─────────────────────────────────────────────────── */

/**
 * What a column row says about itself after its name and source: the format it prints, and
 * §5.2's four optional facts (section-widget parity, 2026-09-04). «Legible at rest» (§3) is
 * the card's whole job, and a stored property with no words on the card is how a widget and
 * its editor drift — the same reason the KPI card names a corridor and a basis.
 */
function columnFacts(column, spec) {
  const out = [`format ${formatWord(column.format)}`];
  if (column.hideWhenEmpty) out.push('hides when nothing measured');
  if (column.zeroAs === 'blank') out.push('zero reads as none');
  if (column.highlightExtremes) out.push('best and worst tinted');
  return out;
}

/**
 * «Legible at rest» (§3): the column's name, where its numbers come from, and the format it
 * prints. A Δ% wears its own tag and names BOTH sides, because that is what it subtracts —
 * and the two source pills are the ones the Data row already uses, so one pill means one
 * thing across the window. Nothing here is a coloured edge (the project's hard ban).
 *
 * Since T17 the row also carries a `⋮⋮` grip and is a drop target for its own list. Like the
 * card's, the grip is `aria-hidden` and no Tab stop: `Order ▲▼` inside the row's popover is
 * the keyboard path, and it is unchanged.
 *
 * The row itself draws nothing for a refusal on the column's own value: it only wears the
 * `aria-invalid` / `aria-describedby` pair for one, the same as the totals target's row does.
 * The CARD draws the sentence, as a sibling right after this row, with `errorId` supplying
 * the id the two sides agree on — the same place and element the target's own refusal uses.
 */
export function ColumnRow({ column, spec, dragType: type, onDropAt, btnRef, onOpen, onRemove, open, error, errorId }) {
  const row = useRef(null);
  const drag = useRowDrag(type, column.id, (dragged, place) => onDropAt?.(dragged, place), row);
  const isDelta = column.kind === 'delta';
  const resolved = resolveValue(column.value, spec, null);
  const label = columnName(column, spec);
  const bound = !!column.value && column.value.kind === 'bound';
  const source = isDelta || bound ? null : valueReadsCm(resolved) ? 'CM' : resolved?.kind === 'metric' ? 'BQ' : null;
  return (
    <ContentRow rowRef={row} buttonRef={btnRef} label={label} summary={columnFacts(column, spec).join(' · ')}
      buttonProps={{ 'data-content-id': column.id,
        'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }}
      className={drag.cls} rowProps={drag.boxProps} onOpen={onOpen} open={open}
      handle={<span className="sp-rb-hndl" aria-hidden="true" title="Drag to reorder" {...drag.handleProps}>⋮⋮</span>}
      actions={<button type="button" className="sp-rb-btn sp-rb-btn--rm"
        title="Remove column" aria-label={`Remove ${label}`} onClick={onRemove}>×</button>}
    >
        {/* The spaces ride in the TEXT, the same rule the Data chips follow: these are flex
            items, so the row's gap draws the separation and flexbox eats a leading space —
            while anything reading `textContent` gets a sentence and not «ImpressionsBQ». */}
        {isDelta ? (
          <>
            {' '}
            <span className="sp-rb-tag">Δ%</span>
          </>
        ) : null}
        {bound ? (
          <>
            {' '}
            <span className="sp-rb-bind" role="img" aria-label="follows the metric switch">⇄</span>
          </>
        ) : null}
        {isDelta ? (
          <>
            {' '}
            <span className="sp-rb-src sp-rb-src--cm">CM</span>
            {' vs '}
            <span className="sp-rb-src">BQ</span>
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

/* ── small pieces ─────────────────────────────────────────────────────────── */

/** What the Sort chip names: the row itself wears the grain's own word, a column wears its
 *  own name. A sort pointing at a column that is gone prints the empty-cell placeholder —
 *  the draft is refused by name, and the chip still has to say something. */
function sortName(view, spec, env, sort) {
  if (sort.columnId === ROW_SORT_KEY) return grainName(env, view.rows, spec);
  if (sort.columnId === '__share__') return 'Row share';
  const hit = arr(view.columns).find((c) => c.id === sort.columnId);
  return hit ? columnName(hit, spec) : '—';
}
