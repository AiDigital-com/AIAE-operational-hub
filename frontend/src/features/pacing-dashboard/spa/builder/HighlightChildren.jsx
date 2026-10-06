import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Popover from '../Popover.jsx';
import { useFocusOnOpen } from '../PopupCoordinator.jsx';
import { HIGHLIGHT_OPS, HIGHLIGHT_COLORS, HIGHLIGHT_STROKE_WIDTHS, LIMITS, normHighlights, highlightStyleKeys, POINTER_SEP } from '../report-v2.js';
import { formulaScopeFor } from '../formula-scope.js';
import FormulaField from './FormulaField.jsx';
import { validate as validateFormula, NO_CM_JOIN } from '../widget-formula.js';
import { draftCtx, chipPlacement } from '../report-draft.js';
import { compileClient, writerForm } from '../chips/compile.js';
import { isChipHolder, holderFace } from '../chips/info.js';
import { highlightUsesContextExpressions } from './highlight-capabilities.js';
import { readRelativeCondition, makeRelativeCondition, relativeConditionSummary } from './highlight-condition.js';
import ContentRow from './ContentRow.jsx';
import { OrderRow, PopRow, Seg, word } from './rows.jsx';
import { highlightPaint, highlightTextStyle } from '../widget-highlights.js';
import './HighlightChildren.css';

const arr = (value) => Array.isArray(value) ? value : [];
const OPS = { gt: 'Above', gte: 'At least', lt: 'Below', lte: 'At most', eq: 'Equal to', neq: 'Not equal to', between: 'Between', outside: 'Outside range' };
const BOUNDS = { number: 'Number', target: 'Target', guide: 'Guide', marker: 'Marker', formula: 'Formula' };
const READINGS = { 'flight.day': 'Flight day', 'flight.total': 'Flight days', 'flight.remaining': 'Days remaining' };
const DEFAULT_SCOPE = formulaScopeFor({ type: 'agg' });
// A caller that names no slot has no CM360 join: a cm-bearing expression is refused with the
// same sentence the draft validator gives, and everything else behaves as it always has.
const DEFAULT_CM = Object.freeze({ rows: null, total: null, refusal: NO_CM_JOIN, cmOnly: false });
// The three facts the grammar cannot know, the SAME ones the draft gate injects: without
// `normChips` a rule holding a chip map is refused with «no chip catalogue was injected»
// (formula chips P1-editor), here at Apply instead of at Save.
const DRAFT_CTX = draftCtx({});
/** Does this owner's CM360 join open a formula slot at all, either half? One question, asked
 *  identically by the editor (`HighlightEditor`) and by the collapsed rules list
 *  (`HighlightChildren`) — written once so the two cannot drift onto different answers. */
const cmSlotAvailable = (cm) => !!(cm.rows || cm.total);
// The one sentence this file says about a rule the BQ context cannot answer. Two surfaces say
// it — the collapsed row in the rules list, and the editor for the one state
// `highlightEditorProblem` has nothing to say about (a flight reading on an owner whose CM360
// join opened the formula slots but can give a flight reading no context) — so it is written
// once rather than typed at each of them.
const NO_BQ_COMPARISON = 'Comparison unavailable for this data source. Choose this value and a number, Target or Guide.';
const copy = (value) => structuredClone(value);
const merge = (value, fields) => Object.fromEntries(Object.entries({ ...value, ...fields }).filter(([, entry]) => entry !== undefined));
const number = (value) => value === '' ? '' : Number(value);
const isChart = (type) => type === 'series' || type === 'miniSeries';
const cap = () => LIMITS.highlights || 8;

// Boundaries carry MORE precision than the parent's display, because the comparison happens
// on the raw value and a boundary rounded to the column's own format would explain a match
// the reader cannot see. But not the whole float: 12 significant digits printed
// «Guide is $8.34798578755», which is not a number anybody reads. Four decimals, and for a
// value too small for four decimals to say anything, four significant digits instead.
// Rates already use percentage units.
export function formatHighlightBoundary(value, format) {
  const raw = Number(value);
  const opts = Math.abs(raw) > 0 && Math.abs(raw) < 0.01
    ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: 4 };
  const number = raw.toLocaleString('en-US', opts);
  if (['percent', 'percent1', 'percent2'].includes(format)) return `${number}%`;
  if (format === 'pp') return `${number} pp`;
  if (['money', 'money4', 'currency', 'currency4'].includes(format)) return `$${number}`;
  return number;
}

export function highlightSummary(rule) {
  const relative = readRelativeCondition(rule?.condition);
  if (relative) return [rule?.enabled === false ? 'Off' : null, relativeConditionSummary(relative)].filter(Boolean).join(' · ');
  const bound = (value) => value?.kind === 'number' ? String(value.value)
    : value?.kind === 'formula' ? value.expr : [BOUNDS[value?.kind] || 'Choose a threshold',
      value?.factor !== undefined ? `× ${value.factor}` : null,
      value?.offset ? `${value.offset > 0 ? '+' : '−'} ${Math.abs(value.offset)}` : null].filter(Boolean).join(' ');
  return [rule?.enabled === false ? 'Off' : null, OPS[rule?.condition?.op] || 'Choose a condition',
    bound(rule?.condition?.threshold), rule?.condition?.upper ? `and ${bound(rule.condition.upper)}` : null].filter(Boolean).join(' ');
}

export function highlightEffectsSummary(style = {}) {
  return [style.color ? word(style.color) : null,
    style.background ? `${word(style.background)} background` : null,
    style.bold === undefined ? null : style.bold ? 'Bold' : 'Regular',
    style.strokeWidth === undefined ? null : `Line ${style.strokeWidth} px`,
    style.points === undefined ? null : style.points ? 'Points' : 'No points'].filter(Boolean).join(' · ');
}

export function highlightDependencyProblem(rule, ownerType, dependencies = {}) {
  for (const threshold of [rule.condition?.threshold, rule.condition?.upper]) {
    const kind = threshold?.kind;
    if (!['target', 'guide', 'marker'].includes(kind)) continue;
    if (!dependencies[kind]) return `${BOUNDS[kind]} is missing. Restore it or choose another comparison.`;
    if (kind === 'target' && ownerType === 'column' && !['total', 'both'].includes(rule.scope)) {
      return 'Target compares the total. Choose Total in the highlight settings.';
    }
  }
  return null;
}

export function highlightEditorProblem(rule, ownerType, scope = DEFAULT_SCOPE, noValue = false, owner, cm = DEFAULT_CM) {
  const result = normHighlights([rule], '/highlights', ownerType, owner, DRAFT_CTX);
  if (!result.ok) return result.detail.slice(result.detail.indexOf(POINTER_SEP) + POINTER_SEP.length);
  if (noValue && !rule.input) return 'Choose a numeric input for this content.';
  const holders = [rule.input, rule.condition?.threshold, rule.condition?.upper, rule.guard];
  for (const holder of holders) {
    const expr = holder?.expr;
    if (expr === undefined) continue;
    // One pair per judgement `checkAlerts` makes (§2.5, §2.8): the CONTEXT decides window
    // functions and the field set, the CM360 SLOT decides the join, and they move
    // independently. A `both` rule is judged twice, and a `total` rule on rows that do not
    // join is refused — which the context alone cannot express, because the total is judged
    // as an aggregate whether or not any row carries a pair. The GRAIN rides with the
    // context: a total is the aggregate's, which is what the draft gate judges a chip by.
    const pairs = ownerType === 'column' && rule.scope === 'total' ? [['agg', cm.total, 'agg']]
      : ownerType === 'column' && rule.scope === 'both' ? [[scope.contextKind, cm.rows, scope.grain], ['agg', cm.total, 'agg']]
        : [[scope.contextKind, cm.rows, scope.grain]];
    for (const [kind, slot, grain] of pairs) {
      if (isChipHolder(holder)) {
        // A chip holder: the client rules the server cannot know (spec §3), on this pair's
        // placement, with the first refusal's sentence.
        const placement = chipPlacement({ ...scope, grain }, holder, { cm: slot, cmRefusal: cm.refusal });
        const compiled = compileClient(holder, placement, 'highlight');
        if (!compiled.ok) return compiled.errors[0].message;
        // A highlight stores the legacy text (decision h): a chip with no spelling here cannot be
        // stored, and Apply says which one.
        const written = writerForm(holder, placement, 'highlight');
        if (written.form === 'refused') return written.message;
        continue;
      }
      const parsed = validateFormula(expr, kind, scope.fieldSet, { cm: slot, cmRefusal: cm.refusal, cmOnly: cm.cmOnly });
      if (!parsed.ok) return [parsed.error, parsed.hint].filter(Boolean).join('. ');
    }
  }
  return null;
}

function Select({ label, value, onChange, children, disabled }) {
  return <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>;
}
function Input({ label, value, onChange, numeric = false, placeholder, ...props }) {
  return <input className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp" aria-label={label} type={numeric ? 'number' : 'text'}
    step={numeric ? 'any' : undefined} value={value ?? ''} placeholder={placeholder}
    onChange={(event) => onChange(numeric ? number(event.target.value) : event.target.value)} {...props} />;
}

/**
 * A formula slot in this editor, with the SAME control a column's value gets: a metric picker
 * for the common case, and the full editor with the field palette behind «ƒx» for anything
 * else. It was a bare text box, so the one place that most needs the palette — a threshold
 * naming a field the reader has to recall from memory — was the one place without it.
 *
 * Stacked rather than laid into the 84px label grid: the picker is a fixed 240px and the
 * «ƒx» button beside it another ~85px, which does not fit the ~270px control column of a
 * 400px popover and wrapped the button onto a line of its own.
 *
 * `contextKind` is the STRICTER of the contexts the draft validator checks — a column
 * highlight scoped to the total is judged as an aggregate, where window functions are
 * illegal — so the field cannot accept an expression the editor then refuses.
 */
/** The slot object with a field's holder written into it (formula chips P1-editor): the text
 *  and, only beside chips, the map, so a holder written back as text drops a stale map. */
function withHolder(slot, holder) {
  const next = { ...slot, expr: holder.expr, chips: holder.chips };
  if (next.chips === undefined) delete next.chips;
  return next;
}

function formulaRow({ label, ariaLabel, holder, onChange, scope, contextKind, cm, cmRefusal, cmOnly, disabled, allowEmpty = true }) {
  if (disabled) {
    // Read-only, so the face (as LayoutCard's closed rows print it), never a chip's `_c1` ref.
    return <PopRow label={label}><Input label={ariaLabel} value={isChipHolder(holder) ? holderFace(holder) : holder?.expr} disabled onChange={() => {}} /></PopRow>;
  }
  return (
    <div className="sp-pop-row sp-pop-row--stack">
      <span className="sp-pop-lbl">{label}</span>
      <span className="sp-pop-ctl">
        <FormulaField
          label={ariaLabel}
          value={holder ?? ''}
          contextKind={contextKind || scope.contextKind}
          fieldSet={scope.fieldSet}
          fieldLabels={scope.fieldLabels}
          grain={scope.grain}
          slot="highlight"
          // The STRICTER of the joins the draft validator will judge this expression in, so
          // the palette offers the CM360 group exactly where Apply will accept it.
          cm={cm}
          cmRefusal={cmRefusal}
          cmOnly={cmOnly}
          allowEmpty={allowEmpty}
          // BOTH, and deliberately: `onCommit` alone fires only on a valid expression, so a
          // half-typed one would never reach the draft, the editor's own error would never
          // appear, and Apply would stay enabled over the PREVIOUS formula. Every keystroke
          // lands, exactly as it did in the bare input, and `highlightEditorProblem` is what
          // blocks Apply.
          onChange={onChange}
          onCommit={onChange}
        />
      </span>
    </div>
  );
}

function Choice({ label, value, onChange, options }) {
  return <Seg label={label} value={value} onPick={onChange} options={options} />;
}

function AppearanceSample({ effects, chart, lineStyle }) {
  return <span className="sp-highlight-sample" aria-label="Appearance example">
    {chart ? <svg width="80" height="28" viewBox="0 0 80 28" aria-hidden="true"
      style={{ color: highlightPaint(effects.color) || 'var(--text-secondary)' }}>
      {lineStyle === 'bar' ? <path d="M8 26V16h12v10zm26 0V8h12v18zm26 0V2h12v24z" fill="currentColor" /> : <>
        <path d="M8 21L32 13L52 17L72 5" fill="none" stroke="currentColor" strokeWidth={effects.strokeWidth ?? 2} />
        {effects.points === true ? [[8, 21], [32, 13], [52, 17], [72, 5]].map(([cx, cy]) =>
          <circle key={cx} cx={cx} cy={cy} r="3" fill="currentColor" />) : null}
      </>}
    </svg> : <span style={highlightTextStyle({ style: effects })}>Aa 123</span>}
    <span className="sp-highlight-sample-label">Example</span>
  </span>;
}

function ThresholdFields({ label, value, onChange, dependencies, allowContextExpressions = true, simple = false, scope, contextKind, cm, cmRefusal, cmOnly }) {
  const kind = value?.kind || 'number';
  const missing = ['target', 'guide', 'marker'].includes(kind) && !dependencies[kind];
  return <>
    <PopRow label={simple && label === 'Threshold' ? 'Compare with' : label} note={missing ? `This value no longer has a ${kind}. Choose another threshold or restore it.` : null}>
      <Select label={`${label} source`} value={kind} onChange={(next) => onChange(next === 'number'
        ? { kind: next, value: 0 } : next === 'formula' ? { kind: next, expr: '' } : { kind: next })}>
        {Object.entries(BOUNDS).filter(([key]) => key === 'number' || (key === 'formula' && allowContextExpressions) || dependencies[key] || key === kind)
          .map(([key, text]) => <option key={key} value={key} disabled={key === 'formula' ? !allowContextExpressions : key !== 'number' && !dependencies[key]}>{text}</option>)}
      </Select>
    </PopRow>
    {kind === 'number' ? <PopRow label="Value"><Input label={`${label} value`} value={value.value} numeric onChange={(next) => onChange({ ...value, value: next })} /></PopRow>
      : kind === 'formula' ? formulaRow({ label: 'Formula', ariaLabel: `${label} formula`, holder: value,
        scope, contextKind, cm, cmRefusal, cmOnly, disabled: !allowContextExpressions,
        onChange: (holder) => onChange(withHolder(value, holder)) })
        : simple ? null : <>
          <PopRow label="Multiply by"><Input label={`${label} multiplier`} value={value.factor ?? 1} numeric onChange={(factor) => onChange(merge(value, { factor: factor === 1 ? undefined : factor }))} /></PopRow>
          <PopRow label="Then add"><Input label={`${label} offset`} value={value.offset ?? 0} numeric onChange={(offset) => onChange(merge(value, { offset: offset === 0 ? undefined : offset }))} /></PopRow>
        </>}
  </>;
}

function relativeSetup(condition) {
  const read = readRelativeCondition(condition);
  return read ? { direction: read.direction, belowPercent: read.belowPercent ?? read.percent,
    abovePercent: read.abovePercent ?? read.percent }
    : { direction: condition.op === 'lt' ? 'below' : 'above', belowPercent: 0, abovePercent: 0 };
}

/** A complete local transaction. The owning value changes only on Apply. */
export function HighlightEditor({ initial, ownerType, dependencies = {}, formulaScope = DEFAULT_SCOPE, noValue = false,
  lineStyle, owner, allowContextExpressions = true, cm = DEFAULT_CM, referencePreview, position = 0, count = 1, onApply, onCancel, onRemove, anchorRef }) {
  const [draft, setDraft] = useState(() => copy(initial));
  const [advanced, setAdvanced] = useState(() => !readRelativeCondition(initial.condition)
    && (initial.condition.threshold.kind !== 'number' || !!initial.condition.upper));
  const [relativeState, setRelativeState] = useState(() => relativeSetup(initial.condition));
  const [order, setOrder] = useState(position);
  const [moreOpen, setMoreOpen] = useState(() => initial.guard !== undefined || initial.note !== undefined);
  // Keep input controls in the same place while changing their source, so the
  // selected control keeps focus. Authored custom inputs are visible on opening.
  const [primaryInput] = useState(() => !!initial.input || noValue || ownerType === 'pie');
  const editorRef = useRef(null);
  const restoreSetupFocus = useRef(false);
  useEffect(() => {
    if (!restoreSetupFocus.current) return;
    restoreSetupFocus.current = false;
    editorRef.current?.querySelector('.sp-highlight-section select')?.focus({ preventScroll: true });
  }, [advanced]);
  const changeSetup = (next) => { restoreSetupFocus.current = true; setAdvanced(next); };
  const error = highlightEditorProblem(draft, ownerType, formulaScope, noValue, owner, cm);
  // §2.8: «no formulas» narrows to «no BQ formulas». A cm-fed owner can still carry a CM360
  // formula, which reads the same mapped population its own value does — so the control is
  // offered, and the BQ refusal lands per expression, from the validator, instead of
  // disabling the whole slot.
  const cmAvailable = cmSlotAvailable(cm);
  const formulasAllowed = allowContextExpressions || cmAvailable;
  // A flight reading is a BQ reading whatever the join is — there is no CM360 flight — so the
  // join that opened the formula slots leaves this one input dead. Named once: it blocks Apply
  // below AND it is the one state where the paragraph above the fields would otherwise say
  // nothing, because `formulasAllowed` is true and `highlightEditorProblem` has no expression
  // to refuse.
  const readingBlocked = !allowContextExpressions && draft.input?.reading !== undefined;
  const set = (fields) => setDraft((current) => merge(current, fields));
  const condition = (fields) => setDraft((current) => ({ ...current, condition: merge(current.condition, fields) }));
  const style = (fields) => setDraft((current) => ({ ...current, style: merge(current.style, fields) }));
  const inputKind = draft.input?.kind === 'share' ? 'share' : draft.input?.reading ? 'reading' : draft.input ? 'formula' : 'parent';
  const chart = isChart(ownerType);
  // The context the draft validator will judge these expressions in. A column highlight
  // scoped to the total is judged as an AGGREGATE (and `both` is judged as both, of which
  // aggregate is the stricter), so the field must not accept a window function the Apply
  // button would then refuse.
  const strictContext = ownerType === 'column' && (draft.scope === 'total' || draft.scope === 'both')
    ? 'agg' : formulaScope.contextKind;
  // …and the same question about the CM360 join: null beats label beats date and window, so
  // a `both` rule whose total does not join offers no CM360 field at all.
  const strictCm = ownerType === 'column' && draft.scope === 'total' ? cm.total
    : ownerType === 'column' && draft.scope === 'both' ? (cm.rows && cm.total ? cm.total : null)
      : cm.rows;
  const effects = draft.style || {};
  const supportedEffects = highlightStyleKeys(ownerType, owner);
  const unsupportedEffects = Object.keys(effects).filter((key) => !supportedEffects.includes(key));
  const thresholdDependencies = { ...dependencies, target: dependencies.target && (ownerType !== 'column' || draft.scope === 'total' || draft.scope === 'both') };
  const reference = draft.condition.threshold.kind;
  const relative = !advanced && ['target', 'guide', 'marker'].includes(reference);
  const { direction, belowPercent, abovePercent } = relativeState;
  const percent = direction === 'below' ? belowPercent : abovePercent;
  const preview = useMemo(() => relative && thresholdDependencies[reference] ? referencePreview?.(reference) : null,
    [relative, reference, thresholdDependencies[reference], referencePreview]);
  const relativeValue = { reference, direction, percent, belowPercent, abovePercent };
  const relativeCondition = relative ? makeRelativeCondition(relativeValue) : null;
  const percentError = relative && !relativeCondition ? 'Enter a percentage of zero or more.' : null;
  const nonPositiveReference = relative && (direction === 'outside' ? belowPercent > 0 || abovePercent > 0 : percent > 0)
    && preview?.status === 'ready' && preview.value <= 0;
  const updateRelative = (fields) => {
    const next = { ...relativeState, ...fields };
    if (Object.hasOwn(fields, 'percent')) next[next.direction === 'below' ? 'belowPercent' : 'abovePercent'] = fields.percent;
    setRelativeState({ direction: next.direction, belowPercent: next.belowPercent, abovePercent: next.abovePercent });
    const nextCondition = makeRelativeCondition({ ...next, reference: fields.reference ?? reference,
      percent: next.direction === 'below' ? next.belowPercent : next.abovePercent });
    if (nextCondition) set({ condition: nextCondition });
  };
  const changeThreshold = (threshold) => {
    if (!advanced && ['target', 'guide', 'marker'].includes(threshold.kind)) {
      updateRelative({ reference: threshold.kind, ...(relative ? {} : {
        direction: draft.condition.op === 'lt' ? 'below' : 'above', belowPercent: 0, abovePercent: 0 }) });
    } else {
      if (threshold.kind === 'formula') setAdvanced(true);
      condition({ threshold, ...(!advanced && relative ? { op: 'gt', upper: undefined } : {}) });
    }
  };
  const unavailable = [draft.condition?.threshold, draft.condition?.upper]
    .find((threshold) => ['target', 'guide', 'marker'].includes(threshold?.kind) && !thresholdDependencies[threshold.kind]);
  // A BQ formula needs a BQ context; a flight reading needs one too, and no join can give it
  // one, so the reading keeps following `allowContextExpressions` alone while the formula slots
  // follow what the join opened.
  const unavailableExpression = (!formulasAllowed && highlightUsesContextExpressions(draft, cmAvailable))
    || readingBlocked;
  const canApply = !error && !percentError && (!(unavailable || unavailableExpression || nonPositiveReference) || draft.enabled === false);
  let explanation = relative && relativeCondition ? `${relativeConditionSummary(relativeValue)}.` : null;
  if (explanation && preview?.shape === 'series' && preview.status === 'ready') {
    explanation += ' Each value compares with the Guide on the same date.';
  }
  if (relative && relativeCondition && preview?.status === 'ready' && Number.isFinite(preview.value) && !nonPositiveReference) {
    const lower = preview.value * (relativeCondition.threshold.factor ?? 1);
    const upper = relativeCondition.upper ? preview.value * (relativeCondition.upper.factor ?? 1) : null;
    const boundary = (value) => formatHighlightBoundary(value, preview.format);
    explanation = !Number.isFinite(lower) || (upper !== null && !Number.isFinite(upper))
      ? 'Comparison unavailable: the calculated boundary is too large.'
      : `${BOUNDS[reference]} is ${boundary(preview.value)}. Triggers ${direction === 'outside'
        ? `below ${boundary(lower)} or above ${boundary(upper)}` : `${direction} ${boundary(lower)}`}.`;
  }
  const fakeOrder = Array.from({ length: count }, (_, index) => ({ id: index === order ? draft.id : `position${index}` }));
  const inputFields = <>
      <PopRow label="Check" note={noValue ? 'Choose the number that controls this text.' : undefined}>
        <Select label="Highlight input" value={inputKind} onChange={(kind) => set({ input: kind === 'parent' ? undefined
          : kind === 'share' ? { kind: 'share' } : kind === 'reading' ? { reading: 'flight.remaining' } : { expr: '' } })}>
          <option value="parent" disabled={noValue}>This value</option>
          {ownerType === 'pie' ? <option value="share">Slice share (%)</option> : null}
          {formulasAllowed || inputKind === 'formula' ? <option value="formula" disabled={!formulasAllowed}>Formula</option> : null}
          {allowContextExpressions || inputKind === 'reading' ? <option value="reading" disabled={!allowContextExpressions}>Flight reading</option> : null}
        </Select>
      </PopRow>
      {inputKind === 'formula' ? formulaRow({ label: 'Formula', ariaLabel: 'Highlight input formula', holder: draft.input,
        scope: formulaScope, contextKind: strictContext, cm: strictCm, cmRefusal: cm.refusal, cmOnly: cm.cmOnly,
        disabled: !formulasAllowed,
        onChange: (holder) => set({ input: withHolder({}, holder) }) }) : null}
      {inputKind === 'reading' ? <PopRow label="Reading"><Select label="Highlight flight reading" value={draft.input.reading} disabled={!allowContextExpressions}
        onChange={(reading) => set({ input: { reading } })}>{Object.entries(READINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></PopRow> : null}
  </>;
  const thresholdFields = <ThresholdFields key="threshold" label={!relative && ['between', 'outside'].includes(draft.condition.op) ? 'Lower threshold' : 'Threshold'}
    value={draft.condition.threshold} onChange={changeThreshold} dependencies={thresholdDependencies} allowContextExpressions={formulasAllowed} simple={!advanced}
    scope={formulaScope} contextKind={strictContext} cm={strictCm} cmRefusal={cm.refusal} cmOnly={cm.cmOnly} />;
  const changeOperation = (op) => {
    if (relative) updateRelative({ direction: op === 'outside' ? 'outside' : op === 'lt' ? 'below' : 'above' });
    else condition({ op, upper: ['between', 'outside'].includes(op) ? draft.condition.upper || { kind: 'number', value: 1 } : undefined });
  };
  return <Popover open anchorRef={anchorRef} onClose={onCancel} title="Highlight settings" width={400} initialFocus=".sp-highlight-section select">
    <div className="sp-highlight-editor" ref={editorRef}>
      <section className="sp-highlight-section" aria-label="When to highlight">
      <div className="sp-highlight-section-head">
        <h3>When to highlight</h3>
        <label className="sp-pop-ck"><input type="checkbox" aria-label="Enable highlight" checked={draft.enabled !== false}
          onChange={(event) => set({ enabled: event.target.checked ? undefined : false })} /> Enabled</label>
      </div>
      {!formulasAllowed ? <p className={unavailableExpression && draft.enabled !== false ? 'sp-lay-refusal' : 'sp-lay-help'} role="status">
        Formula comparisons are unavailable for this data source. Use this value and a number, Target or Guide.
      </p> : readingBlocked ? <p className={draft.enabled !== false ? 'sp-lay-refusal' : 'sp-lay-help'} role="status">
        {NO_BQ_COMPARISON}
      </p> : null}
      {primaryInput ? inputFields : null}
      {ownerType === 'column' ? <PopRow label="Apply to"><Select label="Highlight table scope" value={draft.scope || 'values'} onChange={(scope) => set({ scope: scope === 'values' ? undefined : scope })}>
        <option value="values">Values</option><option value="total">Total</option><option value="both">Values and total</option>
      </Select></PopRow> : null}
      {relative ? thresholdFields : null}
      <PopRow label={relative ? 'Direction' : 'Condition'}>
        {relative ? <Choice label="Highlight condition" value={{ above: 'gt', below: 'lt', outside: 'outside' }[direction]} onChange={changeOperation}
          options={[["gt", "Above"], ["lt", "Below"], ["outside", "Outside"]]} />
          : <Select label="Highlight condition" value={draft.condition.op} onChange={changeOperation}>
            {HIGHLIGHT_OPS.map((op) => <option key={op} value={op}>{OPS[op]}</option>)}
          </Select>}
      </PopRow>
      {!relative ? thresholdFields : null}
      {relative ? <>
        {direction === 'outside' ? <>
          <PopRow label="Below by" note="0% highlights any value below the reference.">
            <Input label="Highlight below deviation percent" value={belowPercent} numeric min={0} onChange={(value) => updateRelative({ belowPercent: value })} />
            <span className="sp-highlight-percent-unit">% of {BOUNDS[reference]}</span>
          </PopRow>
          <PopRow label="Above by" note="0% highlights any value above the reference.">
            <Input label="Highlight above deviation percent" value={abovePercent} numeric min={0} onChange={(value) => updateRelative({ abovePercent: value })} />
            <span className="sp-highlight-percent-unit">% of {BOUNDS[reference]}</span>
          </PopRow>
        </> : <PopRow label="Deviation" note={direction === 'above' ? '0% highlights any value above the reference.'
          : '0% highlights any value below the reference.'}>
          <Input label="Highlight deviation percent" value={percent} numeric min={0} onChange={(value) => updateRelative({ percent: value })} />
          <span className="sp-highlight-percent-unit">% of {BOUNDS[reference]}</span>
        </PopRow>}
        {explanation ? <p className="sp-lay-help sp-highlight-explanation" aria-live="polite">{explanation}</p> : null}
        {nonPositiveReference ? <p className="sp-lay-refusal" role="status">Percentage deviations need a positive reference. Choose a number or use Advanced comparison.</p> : null}
      </> : null}
      {!relative && ['between', 'outside'].includes(draft.condition.op) ? <ThresholdFields label="Upper threshold" value={draft.condition.upper}
        onChange={(upper) => condition({ upper })} dependencies={thresholdDependencies} allowContextExpressions={formulasAllowed}
        scope={formulaScope} contextKind={strictContext} cm={strictCm} cmRefusal={cm.refusal} cmOnly={cm.cmOnly} /> : null}
      {advanced ? <div className="sp-highlight-mode">
        <span className="sp-lay-help">Advanced comparison</span>
        {readRelativeCondition(draft.condition) ? <button type="button" className="sp-rb-btn" onClick={() => {
          setRelativeState(relativeSetup(draft.condition)); changeSetup(false);
        }}>Use percentage setup</button> : null}
      </div> : null}
      {inputKind === 'share' ? <p className="sp-lay-help">Enter a percentage: 25 means 25% of the total.</p> : null}
      </section>
      <section className="sp-highlight-section sp-highlight-effects" aria-label="Appearance">
        <div className="sp-highlight-section-head"><h3>Appearance</h3><AppearanceSample effects={effects} chart={chart} lineStyle={lineStyle} /></div>
        {unsupportedEffects.length ? <PopRow label="Appearance" note="Some effects do not apply to this element.">
          <button type="button" className="sp-rb-btn" onClick={() => style(Object.fromEntries(unsupportedEffects.map((key) => [key, undefined])))}>Remove unavailable effects</button>
        </PopRow> : null}
        <PopRow label="Color"><span className="sp-highlight-color-control"><span className="sp-highlight-color-dot" aria-hidden="true" style={{ background: highlightPaint(effects.color) || 'var(--text-secondary)' }} /><Select label="Highlight color" value={effects.color || ''} onChange={(color) => style({ color: color || undefined })}>
          <option value="">Keep existing</option>{HIGHLIGHT_COLORS.map((color) => <option key={color} value={color}>{word(color)}</option>)}
        </Select></span></PopRow>
        {!chart && ownerType !== 'pie' ? <PopRow label="Background"><Select label="Highlight background" value={effects.background || ''} onChange={(background) => style({ background: background || undefined })}>
          <option value="">Keep existing</option>{HIGHLIGHT_COLORS.map((color) => <option key={color} value={color}>{word(color)}</option>)}
        </Select></PopRow> : null}
        {!chart ? <PopRow label="Text weight"><Choice label="Highlight text weight" value={effects.bold === undefined ? '' : String(effects.bold)}
          onChange={(value) => style({ bold: value === '' ? undefined : value === 'true' })}
          options={[["", "Keep"], ["false", "Regular"], ["true", "Bold"]]} /></PopRow> : null}
        {chart && lineStyle !== 'bar' ? <>
          <PopRow label="Line width"><Select label="Highlight line width" value={effects.strokeWidth ?? ''} onChange={(value) => style({ strokeWidth: value === '' ? undefined : Number(value) })}>
            <option value="">Keep existing</option>{HIGHLIGHT_STROKE_WIDTHS.map((width) => <option key={width} value={width}>{width}</option>)}
          </Select></PopRow>
          <PopRow label="Points"><Choice label="Highlight points" value={effects.points === undefined ? '' : String(effects.points)}
            onChange={(value) => style({ points: value === '' ? undefined : value === 'true' })}
            options={[["", "Keep"], ["true", "Show"], ["false", "Hide"]]} /></PopRow>
        </> : null}
      </section>
      {ownerType === 'column' && draft.scope !== 'total' && (draft.condition.threshold.kind === 'target' || draft.condition.upper?.kind === 'target')
        ? <p className="sp-lay-help">{formulasAllowed ? 'A column target applies to its total. Use a contextual formula for a row plan, or select Total.' : 'A column target applies to its total. Select Total to compare with this target.'}</p> : null}
      <details className="sp-highlight-advanced" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
        <summary className="sp-pop-more"><svg className="sp-highlight-disclosure" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>Advanced options</summary>
        {!primaryInput ? inputFields : null}
        {!advanced ? <button type="button" className="sp-rb-btn sp-highlight-advanced-button" disabled={!!percentError} onClick={() => changeSetup(true)}>Advanced comparison</button> : null}
        {formulasAllowed || draft.guard ? <PopRow label="Minimum data"><label className="sp-pop-ck"><input type="checkbox" aria-label="Require minimum data" checked={!!draft.guard}
          onChange={(event) => set({ guard: event.target.checked ? { expr: cm.cmOnly ? 'cmIm' : 'im', min: 1000 } : undefined })} /> Use a minimum</label></PopRow> : null}
        {draft.guard ? <>
          {formulaRow({ label: 'Measure', ariaLabel: 'Minimum data formula', holder: draft.guard,
            scope: formulaScope, contextKind: strictContext, cm: strictCm, cmRefusal: cm.refusal, cmOnly: cm.cmOnly,
            disabled: !formulasAllowed,
            onChange: (holder) => set({ guard: withHolder(draft.guard, holder) }) })}
          <PopRow label="At least"><Input label="Minimum data value" value={draft.guard.min} disabled={!formulasAllowed} numeric onChange={(min) => set({ guard: { ...draft.guard, min } })} /></PopRow>
        </> : null}
        <PopRow label="Hover note"><Input label="Highlight hover note" value={draft.note} maxLength={LIMITS.support || 240}
          onChange={(note) => set({ note: note || undefined })} placeholder="Optional" /></PopRow>
      </details>
      <OrderRow list={fakeOrder} id={draft.id} label="highlight" onMove={(dir) => setOrder((current) => current + (dir === 'up' ? -1 : 1))} />
      {count > 1 ? <p className="sp-lay-help">Later matching highlights override the appearance settings they change.</p> : null}
      {error ? <p className="sp-lay-refusal" role="status">{error}</p> : null}
      {percentError ? <p className="sp-lay-refusal" role="status">{percentError}</p> : null}
      <div className="sp-control-setup-actions">
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={onRemove}>Remove highlight</button> : null}
        <button type="button" className="sp-rb-btn" onClick={() => { anchorRef?.current?.focus({ preventScroll: true }); onCancel(); }}>Cancel</button>
        <button type="button" className="sp-rb-btn sp-control-create" disabled={!canApply}
          onClick={() => { if (canApply) onApply(normHighlights([draft], '/highlights', ownerType, owner, DRAFT_CTX).out[0], order); }}>Apply</button>
      </div>
    </div>
  </Popover>;
}

export default function HighlightChildren({ owner, ownerType, onChange, dependencies = {}, formulaScope = DEFAULT_SCOPE,
  noValue = false, lineStyle, allowContextExpressions = true, cm = DEFAULT_CM, referencePreview, beforeAdd, addLabel = '+ Add highlight', onEditingChange, onOpen }) {
  const rules = arr(owner?.highlights);
  const uid = useId();
  const [editing, setEditing] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const addRef = useRef(null);
  const anchors = useRef(new Map());
  const activeRef = useRef(null);
  const callback = useRef(onEditingChange);
  callback.current = onEditingChange;
  useFocusOnOpen(addRef, !!focusRequest, () => {
    const target = anchors.current.get(focusRequest?.id) || addRef.current;
    setFocusRequest(null);
    return target;
  });
  const fingerprint = JSON.stringify(rules);
  useEffect(() => { setEditing(null); }, [fingerprint]);
  useEffect(() => {
    if (!editing) return undefined;
    callback.current?.(true);
    return () => callback.current?.(false);
  }, [!!editing]);
  const close = () => setEditing(null);
  const open = (rule) => { onOpen?.(); activeRef.current = rule ? anchors.current.get(rule.id) : addRef.current;
    let id = 'highlight1';
    for (let n = 1; rules.some((entry) => entry.id === id); n += 1) id = `highlight${n + 1}`;
    const reference = ['target', 'guide', 'marker'].find((kind) => dependencies[kind] && (ownerType !== 'column' || kind !== 'target'));
    setEditing({ isNew: !rule, rule: rule || { id, ...(noValue ? { input: { expr: '' } } : {}),
      condition: { op: 'gt', threshold: reference ? { kind: reference } : { kind: 'number', value: 0 } }, style: { color: 'red' } } });
  };
  const commit = (next, focusId) => {
    onChange(next.length ? next : undefined);
    close();
    setFocusRequest({ id: focusId });
  };
  const remove = (id) => {
    const index = rules.findIndex((rule) => rule.id === id);
    const next = rules.filter((rule) => rule.id !== id);
    commit(next, next[index]?.id || next[index - 1]?.id);
  };
  // §2.8: the CM360 join narrows «no formulas» to «no BQ formulas», PER RULE. The outer guard
  // is still «this owner has no BQ context», because that is what the sentence is about; what
  // the join changes is which rules it applies to, and `highlightUsesContextExpressions`
  // answers that — false for an all-CM360 rule and for a rule with no expressions at all.
  // Folding the join into the outer guard would drop the sentence for every rule on a cm-fed
  // owner, including the BQ ones that stay permanently dead at render.
  const cmAvailable = cmSlotAvailable(cm);
  return <>
    {rules.map((rule) => {
      const problem = highlightDependencyProblem(rule, ownerType, dependencies)
        || (!allowContextExpressions && highlightUsesContextExpressions(rule, cmAvailable) ? NO_BQ_COMPARISON : null);
      const errorId = `${uid}-${rule.id}-error`;
      const input = rule.input?.expr || READINGS[rule.input?.reading] || (rule.input?.kind === 'share' ? 'Slice share' : null);
      const scope = ownerType === 'column' ? { total: 'Total', both: 'Values and total' }[rule.scope] : null;
      const summary = [input, scope, problem ? 'Comparison unavailable' : null, highlightEffectsSummary(rule.style)].filter(Boolean).join(' · ');
      return <div key={rule.id} className="sp-content-item">
        <ContentRow nested roleLabel="Highlight" label={highlightSummary(rule)}
          summary={summary}
          quiet={rule.enabled === false} buttonRef={(element) => { if (element) anchors.current.set(rule.id, element); else anchors.current.delete(rule.id); }}
          buttonProps={{ title: [highlightSummary(rule), summary].filter(Boolean).join(' · '),
            'aria-invalid': problem && rule.enabled !== false ? true : undefined, 'aria-describedby': problem ? errorId : undefined }}
          actions={<button type="button" className="sp-rb-btn sp-rb-btn--rm" title="Remove highlight" aria-label="Remove highlight" onClick={() => remove(rule.id)}>×</button>}
          open={editing?.rule.id === rule.id} onOpen={() => open(rule)} />
        {problem ? <div id={errorId} className={rule.enabled === false ? 'sp-lay-help' : 'sp-lay-refusal'} role="status">{problem}</div> : null}
      </div>;
    })}
    {rules.length > 1 ? <p className="sp-lay-help sp-highlight-order-hint">Matching highlights apply from top to bottom. Later rules override earlier appearance settings.</p> : null}
    <div className="sp-highlight-actions">
      {beforeAdd}
      <button type="button" className="wgf-add sp-content-add sp-highlight-add" ref={addRef} disabled={rules.length >= cap()}
        aria-label="Add highlight" onClick={() => open(null)}>{addLabel}{rules.length >= cap() ? ` (${cap()} maximum)` : ''}</button>
    </div>
    {editing ? <HighlightEditor key={editing.rule.id} initial={editing.rule} ownerType={ownerType} dependencies={dependencies}
      owner={owner} noValue={noValue} formulaScope={formulaScope} lineStyle={lineStyle} allowContextExpressions={allowContextExpressions} cm={cm} referencePreview={referencePreview} anchorRef={activeRef}
      position={editing.isNew ? rules.length : rules.findIndex((rule) => rule.id === editing.rule.id)} count={rules.length + (editing.isNew ? 1 : 0)}
      onCancel={close} onRemove={editing.isNew ? undefined : () => remove(editing.rule.id)}
      onApply={(rule, position) => { const next = rules.filter((entry) => entry.id !== rule.id); next.splice(position, 0, rule); commit(next, rule.id); }} /> : null}
  </>;
}
