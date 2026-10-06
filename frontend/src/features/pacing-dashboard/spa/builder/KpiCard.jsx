// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/KpiCard.jsx
//
// THE KPI CARD (widget-builder v2 §5.3, mockup §2). One card in the builder's Views list,
// and the smallest of the four: a KPI is ONE number, so the card is one chip that says the
// whole of it and opens its settings.
//
// It takes the CARD INTERFACE `ChartCard.jsx` states — the same nine props, handed down by
// the builder's Views map.
//
// A KPI IS BORN WITH ITS VALUE. `normKpiView` requires one, so `addView('kpi')` mints
// Impressions and the grammar has no shape for an empty KPI at all. The mockup's «+ pick a
// metric» plus is therefore not built: it would offer to fill a slot that is already full,
// and a card that showed it would be describing a draft that cannot exist. The chip is
// there from the first render, and picking a different metric is what the panel is for.
//
// Three rules of §5.1/§5.2 hold here too:
//
//   · LEGIBLE AT REST. The chip says the name, the source, the format, the target and the
//     Δ line — the whole panel in one line, so a KPI is reviewable without opening
//     anything (§3).
//   · EVERY REFUSAL IS THE GRAMMAR'S. The target map is judged on the VALUE's unit family
//     and the Δ line on the real `normKpiView`; both sentences are the ones the Save gate
//     would have printed.
//   · NOTHING IS DECIDED FOR THE AUTHOR. A value change re-mints only a format the new
//     family cannot print (§1.1.4), and a target the new family no longer matches is KEPT
//     and named by the validator — never deleted under the author (§9's Fix or Undo).
import { useContextualSwitch } from './ContextualSwitch.jsx';
import { useId, useMemo, useRef, useState } from 'react';
import Spotlight from '../Spotlight.jsx';
import { formulaScopeFor } from '../formula-scope.js';
import { CATALOG, familyOf, mintValue } from '../metric-catalog.js';
import {
  datasetTypeOf, setTarget, setViewTitle, validateReportDraft, updateView,
} from '../report-draft.js';
import { cmRefusal, sourceEnv, sourceStep, sourcesFor, spotlightItems, valueReadsCm } from '../spotlight-items.js';
import { formulaValue } from './FormulaEditorDialog.jsx';
import KpiPopover from './KpiPopover.jsx';
import TargetPopover from './TargetPopover.jsx';
import { viewAt } from './ask-grammar.js';
import ContentRow from './ContentRow.jsx';
import HighlightChildren from './HighlightChildren.jsx';
import { highlightContextExpressionsAvailable, highlightCmSlots } from './highlight-capabilities.js';
import ViewFrame from './ViewFrame.jsx';
import { valueName } from './view-text.js';
import { formatWord, pickViewValue } from './column-format.js';

const arr = (v) => (Array.isArray(v) ? v : []);
/** The Spotlight's context pill, per door — each says which slot is being filled (§4). The
 *  KPI's is the mockup's own word for it. */
const SPOT_LABEL = { __proto__: null, value: 'KPI metric', target: 'KPI target' };
const SPOT_ANCHOR = { __proto__: null, value: 'kpi', target: 'target' };
const NO_ITEMS = [];
/** A card rendered with no store under it (a host test) knows nothing about the pacing, and
 *  «nothing known» is the safe answer everywhere below: cm stays unavailable, exactly as it
 *  was before this pacing's facts existed. */
const EMPTY_ENV = {};
/** A KPI reads ONE number over the widget's window — the aggregate basis, the same one a
 *  chart guide is written on (`buildReportKpiModel` reads both through `aggReading`). */
const FORMULA_SCOPE = formulaScopeFor({ type: 'agg' });

/** Compact state summary; the matching basis and corridor controls live in More. */
const BASIS_WORD = {
  __proto__: null,
  campaign: 'reads the whole campaign',
  video: 'reads the video lines',
  audio: 'reads the audio lines',
  cpc: 'reads the campaign while it is paced on clicks',
};
const BAND_WORD = { __proto__: null, ctr: 'CTR alert corridor', vcr: 'VCR alert corridor' };

// `env`'s `dims` are not read here: they answer a GRAIN question, and neither of this card's
// two maps asks one — a KPI is one number over the window, and a target is one number to
// measure it against. Its `sourceFacts`/`mappings` ARE read: whether a CM pill can be picked
// is a fact about the pacing, and a KPI takes cm values like every other slot.
export default function KpiCard({
  view, spec, widget, env = EMPTY_ENV, patch, first, last, onMove, onDropAt, onRemove, onDraftInvalid,
  embedded = false, formulaPreview,
}) {
  const switching = useContextualSwitch(widget, env, patch);
  const chipRef = useRef(null);
  const valueRef = useRef(null);
  const targetRef = useRef(null);
  const targetValueRef = useRef(null);
  const errorId = useId();
  const [open, setOpen] = useState(null);
  const [spot, setSpot] = useState(null);
  // A pick has to arrive as a NEW object or the shell hands back the step it is already
  // hiding (T5's measured trap), so the pick IS the state and every one of them is fresh.
  const [pick, setPick] = useState(null);

  const value = view.value || null;
  const datasetType = datasetTypeOf(spec);
  const metricControl = arr(spec.controls).find((c) => c && c.type === 'metric') || null;

  const closeSpot = () => { setSpot(null); setPick(null); onDraftInvalid?.(false); if (spot === 'target') setOpen(view.target ? 'target' : 'value'); };
  const openSpot = (mode) => { setOpen(null); setPick(null); setSpot(mode); };
  /** Return to the value or dependent target that opened the picker. */
  const reopen = (mode = 'value') => { setSpot(null); setPick(null); onDraftInvalid?.(false); setOpen(mode); };

  /* ── writing ──────────────────────────────────────────────────────────── */

  /** The value, and the format the pick may FILL (§1.1.4). A formula or a bound value is
   *  minted from no catalog entry and declares no one family, so it passes none and the
   *  format stays where it was — the validator names it if it cannot print the new value. */
  const writeValue = (next, entry) => patch((s) => pickViewValue(s, view.id, next, entry));

  const setValue = (entry, opt) => {
    writeValue(opt.bound ? { kind: 'bound' } : mintValue(entry, { source: opt.source, datasetType }),
      opt.bound ? null : entry);
    reopen();
  };

  /** A target keeps the `invert` the author already chose: picking a different number to
   *  measure against does not un-say «lower is better». */
  const setTargetValue = (next) => {
    const invert = !!(view.target && view.target.invert);
    patch((s) => setTarget(s, view.id, { value: next, invert }));
    reopen('target');
  };

  /* ── the Spotlight ────────────────────────────────────────────────────── */

  // Only the TARGET map reads a family, and only while it is open: the rule is «the target
  // is measured in the unit of the value it measures», so the value's own families are what
  // judge it. A list, because a bound value spans its switch's options and no single target
  // measures two units — the catalog says exactly that, in one sentence.
  const pickEnv = useMemo(() => ({
    ...sourceEnv(env),
    datasetType,
    hasMetricControl: !!metricControl,
    grain: null,
    ...(spot === 'target' ? { targetFamily: familyOf(value, spec) } : null),
  }), [env.sourceFacts, env.mappings, env.availableMetrics, datasetType, metricControl, spot, value, spec]);

  const items = spot ? spotlightItems(SPOT_ANCHOR[spot], pickEnv) : NO_ITEMS;

  // Memoized on the PICK alone: the shell files a step the user typed past by identity, so
  // a fresh object every render would re-show a question they had already left.
  const step = useMemo(() => (pick ? {
    question: pick.question,
    options: pick.options,
    onPick: (o) => {
      const opt = pick.options.find((x) => x.id === o.id);
      if (!opt || opt.disabled) return;
      if (pick.mode === 'target') return setTargetValue(mintValue(pick.entry, { source: opt.source, datasetType }));
      return setValue(pick.entry, opt);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null), [pick]);

  const onSpotPick = (item) => {
    const entry = CATALOG.find((e) => e.id === item.id);
    if (!entry) return;
    const options = sourceStep(entry, {
      ...sourceEnv(env),
      datasetType,
      // A target is a FIXED number to measure against — `normTarget` refuses a bound one, so
      // the switch is never an answer there. The KPI's own value may follow it.
      metricControl: spot === 'target' ? null : metricControl,
      // «Both sources» adds a second ELEMENT, and neither of these slots is a list: a KPI
      // draws one number and a target is one line to measure it against.
      allowBoth: false,
    });
    if (!options) {
      const source = sourcesFor(entry, { ...sourceEnv(env), datasetType })[0];
      if (spot === 'target') return setTargetValue(mintValue(entry, { source, datasetType }));
      return setValue(entry, { source });
    }
    setPick({ mode: spot, entry, options, question: `Read ${entry.label} from:` });
  };

  const onFormula = (stored, family) => {
    const next = formulaValue(stored, family);
    // A formula declares its own family, so nothing here re-mints the format: the author
    // said what the expression is in, and `badCellFormat` names a format that cannot print it.
    if (spot === 'target') return setTargetValue(next);
    writeValue(next, null);
    reopen();
  };

  const previewFormula = (stored, unitFamily) => {
    const nextValue = formulaValue(stored, unitFamily);
    const next = spot === 'target'
      ? setTarget(spec, view.id, { ...view.target, value: nextValue, invert: !!view.target?.invert })
      : pickViewValue(spec, view.id, nextValue, null);
    return formulaPreview({ ...widget, spec: next }, {
      kind: spot === 'target' ? 'kpiTarget' : 'kpiValue', viewId: view.id,
    });
  };

  /* ── the render ───────────────────────────────────────────────────────── */

  const bound = !!value && value.kind === 'bound';
  // `ColumnRow`'s own rule, so one pill means one thing across the window: a bound value
  // wears none — the switch decides where it is read from — and everything else is read
  // from the delivery side unless it says CM.
  const pill = bound ? null : valueReadsCm(value) ? 'CM' : value?.kind === 'metric' ? 'BQ' : null;
  const target = view.target || null;
  const summary = [
    `format ${formatWord(view.format)}`,


    view.basis ? BASIS_WORD[view.basis] : null,
    view.deltaVsOtherSource ? 'Δ vs CM360' : null,
  ].filter(Boolean).join(' · ');

  const targetSummary = [target?.invert ? 'lower is better' : null,
    target?.band ? BAND_WORD[target.band] : null].filter(Boolean).join(' · ');
  const targetError = useMemo(() => {
    if (!target) return null;
    const at = `${viewAt(spec, view.id)}/target`;
    return validateReportDraft(widget).problems.find((p) => p.pointer === at || p.pointer.startsWith(`${at}/`))?.detail || null;
  }, [widget, spec, view.id, target]);

  return (
    <ViewFrame
      embedded={embedded}
      view={view} spec={spec} first={first} last={last}
      onMove={onMove} onDropAt={onDropAt} onRemove={onRemove}
      onTitle={(title) => patch((s) => setViewTitle(s, view.id, title))}
    >
      {embedded && <h3 className="sp-inspector-section-title">Value</h3>}
      <div className="sp-rb-els">
        <ContentRow
          buttonRef={chipRef}
          label={valueName(value, spec)}
          summary={summary}
          open={open === 'value'}
          onOpen={() => { setSpot(null); setOpen('value'); }}
        >
          {bound ? <>{' '}<span className="sp-rb-bind" role="img" aria-label="follows the metric switch">⇄</span></> : null}
          {pill ? <>{' '}<span className={`sp-rb-src${pill === 'CM' ? ' sp-rb-src--cm' : ''}`}>{pill}</span></> : null}
        </ContentRow>
        {target ? <ContentRow nested roleLabel="Target" buttonRef={targetRef}
          label={valueName(target.value, spec)} summary={targetSummary} open={open === 'target'}
          buttonProps={{ 'aria-invalid': targetError ? true : undefined, 'aria-describedby': targetError ? errorId : undefined }}
          onOpen={() => { setSpot(null); setOpen('target'); }}>
          {target.value?.kind === 'metric' || valueReadsCm(target.value) ? <>{' '}<span className={`sp-rb-src${valueReadsCm(target.value) ? ' sp-rb-src--cm' : ''}`}>{valueReadsCm(target.value) ? 'CM' : 'BQ'}</span></> : null}
        </ContentRow> : null}
        {targetError ? <div id={errorId} className="sp-lay-refusal" role="status">{targetError}</div> : null}
        <HighlightChildren owner={view} ownerType="kpi" dependencies={{ target: !!view.target }}
          referencePreview={formulaPreview ? (kind) => kind === 'target' && view.target?.value
            ? formulaPreview(widget, { kind: 'kpiTarget', viewId: view.id }) : null : undefined}
          allowContextExpressions={highlightContextExpressionsAvailable(view.value, spec)}
          cm={highlightCmSlots(view, 'kpi', view, spec, env)}
          onEditingChange={onDraftInvalid} onOpen={() => { setOpen(null); setSpot(null); }}
          onChange={(highlights) => patch((current) => updateView(current, view.id, (node) => {
            const next = { ...node }; if (highlights) next.highlights = highlights; else delete next.highlights; return next;
          }))} />
      </div>

      {open === 'value' ? (
        <KpiPopover
          embedded={embedded}
          env={env}
          widget={widget}
          view={view}
          anchorRef={chipRef}
          valueRef={valueRef}
          patch={patch}
          onPickValue={() => openSpot('value')}
          onMakeSwitchable={() => { setOpen(null); switching.open({viewId:view.id,kind:'value'}, chipRef); }}
          onPickTarget={() => openSpot('target')}
          onEditTarget={() => setOpen('target')}
          onRemove={onRemove}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === 'target' && target ? <TargetPopover spec={spec} target={target} ownerValue={value}
        env={env} anchorRef={targetRef} valueRef={targetValueRef}
        onValue={(next) => patch((s) => setTarget(s, view.id, { ...target, value: next }))}
        onChange={(fields) => patch((s) => setTarget(s, view.id, { ...target, ...fields }))}
        onFormula={() => openSpot('target')}
        onRemove={() => { setOpen(null); patch((s) => setTarget(s, view.id, null)); chipRef.current?.focus(); }}
        onClose={() => setOpen(null)} /> : null}

      <Spotlight
        open={!!spot}
        context={{ label: spot ? SPOT_LABEL[spot] : '', anchor: spot ? SPOT_ANCHOR[spot] : '' }}
        items={items}
        step={step}
        formulaSlot={spot ? {
          value: spot === 'target' ? view.target?.value : value,
          ...FORMULA_SCOPE,
          // The slot in compile.js's words: which stored form a chip formula gets (decision h).
          slot: spot === 'target' ? 'target' : 'value',
          // The mart-metrics inventory travels with the slot, so the door at the bottom of
          // the value map says what FormulaField and the full editor already say.
          availableMetrics: env.availableMetrics,
          // …and the PACING's CM360 verdict (§2.5). A KPI is a WINDOW slot, so the join half
          // riding in on FORMULA_SCOPE is always `window` and never the refusing one.
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
