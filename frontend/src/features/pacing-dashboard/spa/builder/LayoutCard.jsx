// Canonical Layout View editor for the unified Widget Builder.
//
// It edits the v2 tree directly: rows -> columns -> blocks. There is no legacy Composite
// adapter and no second storage shape. Empty rows, columns and block lists are intentional
// draft states: Preview receives them immediately; the strict Layout normalizer below says
// why Save is blocked until the author finishes the structure.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmModal from '../ConfirmModal.jsx';
import Spotlight from '../Spotlight.jsx';
import './LayoutFields.css';
import { LIMITS, formatLegal } from '../report-v2.js';
import { updateView } from '../report-draft.js';
import { formulaScopeFor } from '../formula-scope.js';
import { isCmBearing } from '../cm-formula-context.js';
import { validate as validateFormula } from '../widget-formula.js';
import FormulaField from './FormulaField.jsx';
import ViewFrame from './ViewFrame.jsx';
import LayoutContentEntry from './LayoutContentEntry.jsx';
import HighlightChildren from './HighlightChildren.jsx';
import {
  LAYOUT_BADGES, LAYOUT_BLOCK_CHOICES, LAYOUT_BLOCK_HINTS, LAYOUT_BLOCK_KEYS,
  LAYOUT_BLOCK_LABELS, LAYOUT_COLUMN_KEYS, LAYOUT_DETAIL_SOURCES, LAYOUT_EMPHASIS,
  LAYOUT_FORMATS, LAYOUT_FRAMES_LIST, LAYOUT_MONEY_SIDES, LAYOUT_HEADER_CONTENTS, LAYOUT_DELIVERY_UNITS, LAYOUT_RATE_UNITS,
  LAYOUT_NOTE_SOURCES, LAYOUT_NOTE_LABELS, LAYOUT_PILL_STYLES, LAYOUT_RATE_SERIES, LAYOUT_ROW_KEYS,
  LAYOUT_STAT_LAYOUTS, LAYOUT_VIEW_KEYS, addLayoutBlock, addLayoutCol, addLayoutRow,
  countLayoutBlocks, convertLayoutBlock, suggestLayoutTarget, layoutBindingHasIntrinsicTarget, layoutBindingEntry, layoutBindingFor, layoutBlockNeedsExplicitTarget, LAYOUT_VALUES, layoutBlocks, layoutCols, layoutRows,
  layoutViewRefusal, mergeLayoutFields, moveLayoutBlock, moveLayoutCol, moveLayoutRow, normalizeRateUnitsForSeries,
  newLayoutNodeId, patchLayoutBlock, patchLayoutView,
  removeLayoutBlock, removeLayoutCol, removeLayoutRow, replaceLayoutCol, replaceLayoutRow,
  replaceLayoutView, replaceUnknownLayoutFields,
  unknownLayoutFields,
} from './layout-model.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const arr = (value) => (Array.isArray(value) ? value : []);
const own = (value, key) => (hasOwn(value, key) ? value[key] : undefined);
const AGG_FORMULA_SCOPE = formulaScopeFor({ type: 'agg' });
const DATE_FORMULA_SCOPE = formulaScopeFor({ type: 'date' });
/** The CM360 slot a block's highlight rules are judged in (2026-09-18). A block, a stat-row
 *  cell, a target and a marker are WINDOW numbers and a mini-chart line is a run of days, so
 *  the join is the scope's own, the one the block's value is already validated by. `cmOnly`
 *  is «this owner's own value reads CM360»: its rules are then read off the matched pairs,
 *  where `im` is the pair's delivery half, exactly as on a cm-fed column. */
const brickCmSlot = (scope, expr) => ({ rows: scope.cm, total: null, refusal: scope.cmRefusal, cmOnly: isCmBearing(expr) });

const FORMAT_LABEL = {
  __proto__: null,
  int: 'Integer', count1: 'Count · 1 decimal', money: 'Money', money4: 'Money 4dp', percent: 'Percent',
  percent2: 'Percent 2dp', pp: 'Percentage points', number2: 'Number 2dp',
  plain2: 'Plain 2dp', auto: 'Auto',
};
const FRAME_LABEL = { __proto__: null, none: 'No frame', card: 'Card', signal: 'Signal panel' };
const RATE_LABEL = {
  __proto__: null,
  planRate: 'Plan rate per unit', bidPair: 'Bid plan vs fact',
  earned: 'Earned at plan rate', dynamic: 'Dynamic rates',
};
const DETAIL_LABEL = {
  __proto__: null,
  planUnits: 'Plan units', planRate: 'Plan rate per day', actualUnits: 'Actual units',
  neededPerDay: 'Needed per day', latestDay: 'Latest delivered day', opRead: 'Operational read',
};
const BADGE_LABEL = {
  __proto__: null, pace: 'Live pace word', margin: 'Live margin word', currency: 'Currency note',
};
const ROLE_LABEL = { __proto__: null, client: 'Client side', media: 'Media side' };
const EMPHASIS_LABEL = { __proto__: null, muted: 'Muted', strong: 'Strong' };
const STAT_LAYOUT_LABEL = { __proto__: null, flex: 'Side by side', pair: 'Two columns' };
const bindingFormat = (current, entry) => formatLegal(entry.unitFamily, current) ? current : entry.defaultFormat;
const PILL_LABEL = { __proto__: null, status: 'Status', delta: 'Difference vs target' };
const UNIT_LABEL = { __proto__: null, impressions: 'Impressions', clicks: 'Clicks', views: 'Views' };

const pairs = (values, labels) => values.map((value) => [value, labels?.[value] || value]);

function bindingSummary(bind) {
  const label = layoutBindingEntry(bind)?.label || bind?.expr || bind?.reading || bind?.metric;
  return typeof label === 'string' && label ? label : 'Choose a value';
}

// The closed row shows the normalizer's own sentence. Its JSON pointer names a view
// this editor builds only to ask the question ("/view/rows/0/cols/0/bricks/0/…"), so
// the pointer is dropped and the field's sentence stays.
const refusalText = (text) => (typeof text === 'string' ? text.replace(/^\/[^\s:]*: /, '') : text);

function bindingFormulaError(bind, label) {
  if (typeof bind?.expr !== 'string') return null;
  // A brick bind, target, tick, stat-row cell and container badge are WINDOW slots (§2.5):
  // one number over the widget's own window, read off the reader the Layout context carries.
  // The join rides on the scope, so this call only has to stop dropping it.
  const result = validateFormula(bind.expr, AGG_FORMULA_SCOPE.contextKind, AGG_FORMULA_SCOPE.fieldSet,
    { cm: AGG_FORMULA_SCOPE.cm, cmRefusal: AGG_FORMULA_SCOPE.cmRefusal });
  return result.ok ? null : `${label}: ${result.error}`;
}

function Field({ label, children, className = '' }) {
  return (
    <div className={`sp-lay-field${className ? ` ${className}` : ''}`}>
      <span className="sp-lay-label">{label}</span>
      <div className="sp-lay-control">{children}</div>
    </div>
  );
}

function SelectField({ value, options, onChange, label }) {
  const stored = value == null ? '' : String(value);
  const list = [...options];
  if (!list.some(([candidate]) => String(candidate) === stored)) {
    list.unshift([stored, stored ? `Stored value: ${stored}` : 'Choose…', true]);
  }
  return (
    <select
      className="sp-inp sp-inp--sans sp-lay-select"
      aria-label={label}
      value={stored}
      onChange={(event) => onChange(event.target.value)}
    >
      {list.map(([candidate, text, disabled], index) => (
        <option key={`${String(candidate)}:${index}`} value={candidate} disabled={disabled}>{text}</option>
      ))}
    </select>
  );
}

function TextField({ value, onChange, label, placeholder = '', maxLength = LIMITS.support }) {
  return (
    <input
      type="text"
      className="sp-inp sp-inp--sans sp-lay-text"
      aria-label={label}
      value={typeof value === 'string' ? value : ''}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function NumberField({ value, onChange, label, min, max }) {
  return (
    <input
      type="number"
      className="sp-inp sp-lay-number"
      aria-label={label}
      value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      onChange={(event) => {
        const raw = String(event.target.value).trim();
        if (!raw) { onChange(undefined); return; }
        const number = Number(raw);
        if (Number.isFinite(number)) onChange(number);
      }}
    />
  );
}

function OptionalText({ object, field, label, onFields, maxLength = LIMITS.support }) {
  const present = hasOwn(object, field);
  return (
    <Field label={label}>
      <TextField
        label={label}
        value={present ? object[field] : ''}
        placeholder="Optional"
        maxLength={maxLength}
        onChange={(value) => onFields({ [field]: value.trim() ? value : undefined })}
      />
    </Field>
  );
}

function BoolField({ value, present, label, onChange }) {
  return (
    <Field label={label}>
      <SelectField
        label={label}
        value={present ? String(value) : ''}
        options={[
          ['false', 'Higher is better'], ['true', 'Lower is better'],
        ]}
        onChange={(next) => onChange(next === '' ? undefined : next === 'true')}
      />
    </Field>
  );
}

/** A visible, editable escape hatch for fields a newer or broken writer left behind. */
export function UnknownFields({ value, knownKeys, label, invalidKey, onChange, onInvalid }) {
  const extras = useMemo(() => unknownLayoutFields(value, knownKeys), [value, knownKeys]);
  const serialized = useMemo(() => JSON.stringify(extras, null, 2), [extras]);
  const [draft, setDraft] = useState(serialized);
  const committed = useRef({ invalidKey, serialized });
  const hasExtras = Object.keys(extras).length > 0;

  useEffect(() => {
    if (committed.current.invalidKey !== invalidKey || committed.current.serialized !== serialized) {
      setDraft(serialized);
      onInvalid(invalidKey, false);
    }
    committed.current = { invalidKey, serialized };
  }, [serialized, invalidKey, onInvalid]);
  useEffect(() => () => onInvalid(invalidKey, false), [invalidKey, onInvalid]);

  if (!hasExtras) return null;
  return (
    <Field label={`${label} extra fields`} className="sp-lay-field--stack">
      <textarea
        className="sp-inp sp-inp--sans sp-lay-json"
        aria-label={`${label} extra fields as JSON`}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            const parsed = JSON.parse(next);
            if (!isObj(parsed)) throw new TypeError('extra fields must be a JSON object');
            // This exact value will come back through props. Keep the author's text
            // and caret; only external changes replace the local editing buffer.
            committed.current = { invalidKey, serialized: JSON.stringify(parsed, null, 2) };
            onInvalid(invalidKey, false);
            onChange(replaceUnknownLayoutFields(value, knownKeys, parsed));
          } catch {
            onInvalid(invalidKey, true);
          }
        }}
      />
      <span className="sp-lay-help">Unknown fields stay in the draft until you edit or remove them here.</span>
    </Field>
  );
}

export function BindEditor({ label, bind, onChange, invalidKey, onInvalid, previewFormula, active = true }) {
  const value = isObj(bind) ? bind : {};
  const entry = layoutBindingEntry(value);
  const [picking, setPicking] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(() => hasOwn(value, 'expr') && !entry);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => { if (!active) { setPicking(false); setDialogOpen(false); } }, [active]);
  const both = ['metric', 'expr', 'reading'].filter((key) => hasOwn(value, key)).length > 1;
  const items = LAYOUT_VALUES.map((candidate) => ({ id: candidate.id, label: candidate.label,
    sub: ['canonical', 'reading'].includes(candidate.kind) ? 'Computed reading' : 'Widget data', selected: candidate.id === entry?.id }));
  const choose = (item) => {
    const picked = LAYOUT_VALUES.find((candidate) => candidate.id === item.id);
    if (!picked) return;
    onChange(mergeLayoutFields(value, { metric: undefined, reading: undefined, expr: undefined, ...layoutBindingFor(picked) }), picked);
    setPicking(false); setFormulaOpen(false);
  };
  return (
    <div className="sp-lay-bind">
      <Field label={label}>
        <div className="sp-lay-value-row">
          <button type="button" className="sp-inp sp-inp--sans sp-lay-value-pick" aria-label={`Choose ${label.toLowerCase()}`}
            onClick={() => setPicking(true)}>{entry?.label || (hasOwn(value, 'expr') ? 'Formula' : 'Choose a value')}<span aria-hidden="true">⌄</span></button>
          <button type="button" className="wgf-adv" aria-label={`Edit ${label.toLowerCase()} formula`} aria-expanded={dialogOpen}
            onClick={() => { setFormulaOpen(true); setDialogOpen(true); }}>ƒx</button>
        </div>
      </Field>
      {both && <div className="sp-lay-help">This stored value has more than one binding. Choose one above, or edit the formula to use it.</div>}
      {formulaOpen && <Field label="Formula">
        <FormulaField key={`${invalidKey}:formula`} label={`${label} formula`} value={typeof value.expr === 'string' ? value.expr : ''}
          {...AGG_FORMULA_SCOPE} previewFormula={previewFormula} startAdvanced hideEditorTrigger requireEditorValue editorOpen={dialogOpen}
          onEditorOpenChange={(open) => { setDialogOpen(open); if (!open && !hasOwn(value, 'expr')) setFormulaOpen(false); }}
          allowEmpty={!hasOwn(value, 'expr')}
          onChange={(next) => onChange(mergeLayoutFields(value, { metric: undefined, reading: undefined, expr: next }))}
          onDraftState={(_, bad) => onInvalid(`${invalidKey}:formula`, bad)} />
      </Field>}
      <Spotlight open={picking} context={{ label: `Choose ${label.toLowerCase()}`, anchor: 'kpi' }} items={items}
        onPick={choose} onClose={() => setPicking(false)} />
      <UnknownFields value={value} knownKeys={['metric', 'expr', 'reading']} label={label}
        invalidKey={`${invalidKey}:bind-extra`} onInvalid={onInvalid} onChange={onChange} />
    </div>
  );
}

function TargetEditor({ block, required = false, onFields, invalidKey, onInvalid, previewFormula, active = true }) {
  const present = hasOwn(block, 'target');
  const invertPresent = hasOwn(block, 'invert');
  return (
    <div className="sp-lay-target">
      {!required ? (
        <Field label="Target">
          <label className="sp-lay-present">
            <input
              type="checkbox"
              checked={present}
              aria-label="Include target"
              onChange={(event) => onFields(event.target.checked
                ? { target: suggestLayoutTarget(block) || {}, invert: false }
                : { target: undefined, invert: undefined })}
            />
            include
          </label>
        </Field>
      ) : null}
      {present ? (
        <BindEditor
          label="Target value"
          bind={block.target}
          active={active}
          previewFormula={previewFormula}
          invalidKey={`${invalidKey}:target`}
          onInvalid={onInvalid}
          onChange={(target) => onFields({ target })}
        />
      ) : (
        required ? (
          <button
            type="button"
            className="wgf-add sp-lay-inline-add"
            onClick={() => onFields({ target: suggestLayoutTarget(block) || {}, invert: false })}
          >
            + Add required target
          </button>
        ) : null
      )}
      {present || invertPresent ? (
        <BoolField
          label="Direction"
          value={block.invert}
          present={invertPresent}
          onChange={(invert) => onFields({ invert })}
        />
      ) : null}
    </div>
  );
}

function FormatField({ value, onChange }) {
  return (
    <Field label="Format">
      <SelectField
        label="Format"
        value={value}
        options={pairs(LAYOUT_FORMATS, FORMAT_LABEL)}
        onChange={onChange}
      />
    </Field>
  );
}

function UnitFields({ units, options, unavailable = [], onChange }) {
  const custom = units !== undefined;
  const selected = Array.isArray(units) ? units : [];
  const move = (index, delta) => {
    const next = [...selected];
    if (index + delta < 0 || index + delta >= next.length) return;
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return <>
    <Field label="Units">
      <SelectField label="Unit selection" value={custom ? 'custom' : 'automatic'}
        options={[["automatic", "Campaign default"], ["custom", "Choose units"]]}
        onChange={(mode) => onChange(mode === 'automatic' ? undefined : options.filter((unit) => !unavailable.includes(unit)))} />
    </Field>
    {custom ? <div className="sp-lay-unit-list" role="group" aria-label="Units and order">
      {[...selected, ...options.filter((unit) => !selected.includes(unit))].map((unit, index) => {
        const included = selected.includes(unit);
        const label = UNIT_LABEL[unit] || String(unit);
        const unavailableHere = unavailable.includes(unit);
        return <div className="sp-lay-unit-row" key={`${unit}:${index}`}>
          <label className="sp-lay-present"><input type="checkbox" checked={included} disabled={!included && unavailableHere}
            onChange={(event) => onChange(event.target.checked ? [...selected, unit] : selected.filter((item) => item !== unit))} />{label}{unavailableHere ? ' (dynamic rates only)' : ''}</label>
          {included ? <span className="sp-lay-unit-actions">
            <button type="button" className="sp-rb-btn" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
            <button type="button" className="sp-rb-btn" aria-label={`Move ${label} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>↓</button>
          </span> : null}
        </div>;
      })}
      {!selected.length ? <div className="sp-lay-help">Select at least one unit.</div> : null}
    </div> : null}
    <div className="sp-lay-help">Only units used by this campaign appear in the Widget.</div>
  </>;
}

export function BlockEditor({ block, spec, path, onChange, onInvalid, widget, viewId, formulaPreview }) {
  const value = isObj(block) ? block : {};
  const type = value.type;
  const invalidKey = `block:${path}`;
  const [openEntry, setOpenEntry] = useState(null);
  const [formulaEntry, setFormulaEntry] = useState(null);
  const [invalidEntries, setInvalidEntries] = useState(() => new Set());
  // Session keys are independent of editable IDs and labels. Removing a preceding
  // entry keeps the remaining input, its selection and any unfinished JSON alive.
  const entrySession = useRef({ owner: null, keys: [], next: 0 });
  const entryOwner = `${path}:${type}`;
  const contentKey = `${entryOwner}:value`;
  const targetKey = `${entryOwner}:target`;
  const markerKey = `${entryOwner}:marker`;
  const contentOpen = openEntry === contentKey;
  const contentButtonRef = useRef(null);
  // The content row exists only in some modes (a pill showing words, a note with
  // authored text). When a render leaves it out, release its open session, or the
  // row comes back open on the next mode switch and its panel takes the focus.
  const renderedEntries = useRef(new Set());
  renderedEntries.current = new Set();
  useEffect(() => {
    if ([contentKey, targetKey, markerKey].includes(openEntry) && !renderedEntries.current.has(openEntry)) setOpenEntry(null);
  });
  if (entrySession.current.owner !== entryOwner) entrySession.current = { owner: entryOwner, keys: [], next: 0 };
  const entryCount = arr(type === 'statRow' ? value.cells : type === 'miniChart' ? value.series : []).length;
  const session = entrySession.current;
  while (session.keys.length < entryCount) session.keys.push(`${entryOwner}:${session.next++}`);
  if (session.keys.length > entryCount) session.keys.length = entryCount;
  useEffect(() => { setOpenEntry(null); setFormulaEntry(null); }, [entryOwner]);
  const markEntryInvalid = useCallback((key, bad) => {
    onInvalid(key, bad);
    setInvalidEntries((previous) => {
      if (previous.has(key) === bad) return previous;
      const next = new Set(previous);
      if (bad) next.add(key); else next.delete(key);
      return next;
    });
  }, [onInvalid]);
  const toggleEntry = (key) => {
    setFormulaEntry(null);
    setOpenEntry(openEntry === key ? null : key);
  };
  const closeEntry = (key) => {
    setFormulaEntry((opened) => opened === key ? null : opened);
    setOpenEntry((opened) => opened === key ? null : opened);
  };
  const returnToContent = (key) => {
    closeEntry(key);
    contentButtonRef.current?.focus({ preventScroll: true });
  };
  const removeEntry = (items, field, index) => {
    const [removed] = session.keys.splice(index, 1);
    onChange(mergeLayoutFields(value, { [field]: items.filter((_, i) => i !== index) }));
    if (openEntry === removed) setOpenEntry(null);
    if (formulaEntry === removed) setFormulaEntry(null);
  };
  const addEntry = (items, field, entry) => {
    const key = `${entryOwner}:${session.next++}`;
    session.keys.push(key);
    onChange(mergeLayoutFields(value, { [field]: [...items, entry] }));
    setOpenEntry(key);
  };
  const entryError = (entry, key) => {
    const brick = type === 'statRow'
      ? { type, layout: 'flex', cells: [entry] } : { type, series: [entry] };
    const refusal = layoutViewRefusal({ id: 'entry', kind: 'layout', title: '', rows: [{ cols: [{ span: null, frame: 'none', bricks: [brick] }] }] });
    if (refusal) return refusal;
    const expr = type === 'statRow' ? entry?.bind?.expr : entry?.expr;
    if (typeof expr === 'string') {
      // A stat-row cell is a window slot; a mini-chart line is a DATE slot and joins per day
      // (§2.5). Both scopes come from formulaScopeFor, so each already knows its own join.
      const scope = type === 'statRow' ? AGG_FORMULA_SCOPE : DATE_FORMULA_SCOPE;
      const check = validateFormula(expr, scope.contextKind, scope.fieldSet, { cm: scope.cm, cmRefusal: scope.cmRefusal });
      if (!check.ok) return check.error;
    }
    return [...invalidEntries].some((candidate) => candidate.startsWith(`${key}:`)) ? 'Finish editing the extra fields.' : null;
  };
  const set = (fields) => onChange(mergeLayoutFields(value, fields));
  const highlights = () => <HighlightChildren owner={value} ownerType={type}
    referencePreview={preview ? (kind) => kind === 'target' && value.target ? preview('atomTarget', {})
      : kind === 'marker' && value.tick ? preview('atomTick', {}) : null : undefined}
    noValue={type === 'header' || type === 'note' || (type === 'pill' && hasOwn(value, 'text'))}
    dependencies={{ target: !!value.target || layoutBindingHasIntrinsicTarget(value.bind)
      || type === 'unitBars' || type === 'rateRows' || type === 'detailCard' || type === 'flightBullet', marker: !!value.tick || type === 'unitBars' }}
    formulaScope={AGG_FORMULA_SCOPE} cm={brickCmSlot(AGG_FORMULA_SCOPE, value.bind?.expr)}
    onEditingChange={(bad) => markEntryInvalid(`${invalidKey}:highlights`, bad)}
    onOpen={() => { setOpenEntry(null); setFormulaEntry(null); }} onChange={(next) => set({ highlights: next })} />;
  const setMarker = (fields) => {
    const next = mergeLayoutFields(value, fields);
    onChange(next);
    if (!hasOwn(next, 'tick') && !hasOwn(next, 'tickLabel')) returnToContent(markerKey);
  };
  const preview = formulaPreview && widget && viewId ? (kind, fields, extra = {}) => formulaPreview({
    ...widget, spec: updateView(widget.spec, viewId, (node) => ({ ...node, brick: mergeLayoutFields(value, fields) })),
  }, { kind, viewId, ...extra }) : null;
  const previewBinding = (kind, field, current = value[field]) => preview
    ? (expr) => preview(kind, { [field]: mergeLayoutFields(current, { metric: undefined, reading: undefined, expr }) }) : undefined;
  const previewTarget = previewBinding('atomTarget', 'target');
  const bind = (label = 'Value') => (
    <BindEditor
      label={label}
      bind={value.bind}
      active={contentOpen}
      previewFormula={previewBinding('atomValue', 'bind')}
      invalidKey={`${invalidKey}:value`}
      onInvalid={markEntryInvalid}
      onChange={(next, entry) => {
        const fields = { bind: next, ...(entry && hasOwn(value, 'format') ? { format: bindingFormat(value.format, entry) } : {}) };
        const candidate = mergeLayoutFields(value, fields);
        const previousSuggested = suggestLayoutTarget(value);
        const targetWasSuggested = entry && hasOwn(value, 'target') && previousSuggested
          && JSON.stringify(value.target) === JSON.stringify(previousSuggested);
        if (targetWasSuggested) {
          fields.target = suggestLayoutTarget(candidate) || {};
          fields.invert = false;
        } else if (!hasOwn(candidate, 'target') && layoutBlockNeedsExplicitTarget(candidate)) {
          fields.target = suggestLayoutTarget(candidate) || {};
          fields.invert = false;
        }
        set(fields);
      }}
    />
  );
  const format = () => <FormatField value={value.format} onChange={(next) => set({ format: next })} />;
  const optionalLabel = (structureOnly = false) => (
    <OptionalText object={value} field="label" label={structureOnly ? 'Name in structure' : 'Label'} maxLength={LIMITS.label} onFields={set} />
  );
  const extras = () => (
    <UnknownFields
      value={value}
      knownKeys={LAYOUT_BLOCK_KEYS[type] || ['type']}
      label="Block"
      invalidKey={`${invalidKey}:extra`}
      onInvalid={markEntryInvalid}
      onChange={onChange}
    />
  );
  const target = () => <button type="button" className="wgf-add sp-content-add" onClick={() => {
    if (!hasOwn(value, 'target')) set({ target: suggestLayoutTarget(value) || {}, invert: false });
    setOpenEntry(targetKey);
  }}>{hasOwn(value, 'target') ? 'Edit target' : '+ Add target'}</button>;
  const supportsTarget = ['bigStat', 'moneyStat', 'kvRow', 'meter', 'gauge', 'pill', 'progressBar'].includes(type);
  const requiredTarget = layoutBlockNeedsExplicitTarget(value);
  const showTarget = supportsTarget && (hasOwn(value, 'target') || hasOwn(value, 'invert') || requiredTarget);
  const showMarker = type === 'progressBar' && (hasOwn(value, 'tick') || hasOwn(value, 'tickLabel'));
  const childError = (field, label) => bindingFormulaError(value[field], label)
    || ([...invalidEntries].some((key) => key.startsWith(`${invalidKey}:${field}:`)) ? 'Finish editing the settings.' : null);
  // The same mounted settings shell as a stat-row value or chart line. A closed
  // row still reports invalid stored fields and unfinished input; opening never
  // changes the brick or derives new defaults.
  const content = (children, settingsTitle = 'Value', summary = FORMAT_LABEL[value.format] || value.format,
    label = bindingSummary(value.bind)) => {
    const refusal = refusalText(layoutViewRefusal({ id: 'entry', kind: 'layout', title: '',
      rows: [{ cols: [{ span: null, frame: 'none', bricks: [value] }] }] }));
    const formulaError = ['bind', 'target', 'tick'].map((field) => bindingFormulaError(value[field],
      field === 'bind' ? 'Value' : field === 'target' ? 'Target' : 'Marker')).find(Boolean);
    const unfinished = [...invalidEntries].some((key) => key.startsWith(`${invalidKey}:`));
    renderedEntries.current.add(contentKey);
    if (showTarget) renderedEntries.current.add(targetKey);
    if (showMarker) renderedEntries.current.add(markerKey);
    return <div className="sp-rb-els"><LayoutContentEntry label={label} summary={summary} settingsTitle={settingsTitle} buttonRef={contentButtonRef}
      error={refusal || formulaError || (unfinished ? 'Finish editing the settings.' : null)}
      open={contentOpen} onOpen={() => toggleEntry(contentKey)} onClose={() => closeEntry(contentKey)}>
      {children}
    </LayoutContentEntry>
      {showTarget ? <LayoutContentEntry nested roleLabel="Target" label={bindingSummary(value.target)}
        summary={hasOwn(value, 'invert') ? (value.invert ? 'Lower is better' : 'Higher is better') : null}
        error={childError('target', 'Target') || (requiredTarget && !hasOwn(value, 'target') ? 'Choose a target.' : null)}
        open={openEntry === targetKey} onOpen={() => toggleEntry(targetKey)} onClose={() => closeEntry(targetKey)}>
        <TargetEditor required={requiredTarget} active={openEntry === targetKey}
          previewFormula={previewTarget} block={value} onFields={(fields) => {
            set(fields);
            if (hasOwn(fields, 'target') && fields.target === undefined) returnToContent(targetKey);
          }} invalidKey={invalidKey} onInvalid={markEntryInvalid} />
      </LayoutContentEntry> : null}
      {showMarker ? <LayoutContentEntry nested roleLabel="Marker" label={value.tickLabel || bindingSummary(value.tick)}
        summary={!hasOwn(value, 'tick') ? 'Not shown' : value.tickLabel ? bindingSummary(value.tick) : null} error={childError('tick', 'Marker')}
        open={openEntry === markerKey} onOpen={() => toggleEntry(markerKey)} onClose={() => closeEntry(markerKey)}>
        <Field label="Marker"><label className="sp-lay-present">
          <input type="checkbox" aria-label="Include marker" checked={hasOwn(value, 'tick')}
            onChange={(event) => setMarker({ tick: event.target.checked ? { expr: 'expIm' } : undefined })} />include
        </label></Field>
        {hasOwn(value, 'tick') ? <BindEditor label="Marker value" bind={value.tick} active={openEntry === markerKey}
          previewFormula={previewBinding('atomTick', 'tick')} invalidKey={`${invalidKey}:tick`}
          onInvalid={markEntryInvalid} onChange={(next) => set({ tick: next })} /> : null}
        <OptionalText object={value} field="tickLabel" label="Marker label" maxLength={LIMITS.label} onFields={setMarker} />
      </LayoutContentEntry> : null}
      {highlights()}
    </div>;
  };

  if (type === 'bigStat') return <>{optionalLabel()}{content(<>{bind()}{format()}{target()}{extras()}</>)}</>;
  if (type === 'meter') return <>{optionalLabel(true)}{content(<>{bind()}{format()}{target()}{extras()}</>)}</>;

  if (type === 'pill') {
    const hasText = hasOwn(value, 'text');
    const hasBind = hasOwn(value, 'bind');
    const mode = hasText && hasBind ? 'both' : (hasText ? 'text' : (hasBind ? 'value' : 'missing'));
    return (
      <>
        {optionalLabel(true)}
        <Field label="Shows">
          <SelectField
            label="Pill content"
            value={mode}
            options={[
              ['text', 'Authored words'], ['value', 'A value'],
            ]}
            onChange={(next) => {
              closeEntry(contentKey);
              if (next === 'text') set({ bind: undefined, format: undefined, target: undefined, invert: undefined,
                variant: hasOwn(value, 'variant') ? value.variant : 'status', text: hasOwn(value, 'text') ? value.text : 'On plan' });
              else if (next === 'value') {
                const nextBind = hasOwn(value, 'bind') ? value.bind : { expr: 'im' };
                const nextVariant = hasOwn(value, 'variant') ? value.variant : 'status';
                const candidate = { ...value, bind: nextBind, variant: nextVariant };
                set({ text: undefined, variant: nextVariant, bind: nextBind,
                  format: hasOwn(value, 'format') ? value.format : 'int',
                  ...(layoutBlockNeedsExplicitTarget(candidate) && !hasOwn(value, 'target')
                    ? { target: suggestLayoutTarget(candidate) || {}, invert: false }
                    : {}) });
              }
            }}
          />
        </Field>
        {hasText || mode === 'text' ? (
          <Field label="Words"><TextField label="Pill words" value={value.text} maxLength={LIMITS.label} onChange={(next) => set({ text: next })} /></Field>
        ) : null}
        {hasBind || mode === 'value' || hasOwn(value, 'format') || hasOwn(value, 'target') || hasOwn(value, 'invert')
          ? content(<>
            {bind()}{format()}{target()}
            {hasBind ? <Field label="Style">
              <SelectField label="Pill style" value={value.variant} options={pairs(LAYOUT_PILL_STYLES, PILL_LABEL)} onChange={(next) => {
                const candidate = { ...value, variant: next };
                set({
                  variant: next,
                  ...(layoutBlockNeedsExplicitTarget(candidate) && !hasOwn(value, 'target')
                    ? { target: suggestLayoutTarget(candidate) || {}, invert: false }
                    : {}),
                });
              }} />
            </Field> : null}
          </>) : null}
        {!hasBind && !hasOwn(value, 'format') && !hasOwn(value, 'target') && !hasOwn(value, 'invert') ? highlights() : null}
        {extras()}
      </>
    );
  }

  if (type === 'statRow') {
    const cells = arr(value.cells);
    const patchCell = (index, fields) => set({ cells: cells.map((cell, i) => (
      i === index ? mergeLayoutFields(isObj(cell) ? cell : {}, fields) : cell
    )) });
    return (
      <>
        {optionalLabel(true)}
        <Field label="Cell layout">
          <SelectField label="Stat row cell layout" value={value.layout} options={pairs(LAYOUT_STAT_LAYOUTS, STAT_LAYOUT_LABEL)} onChange={(next) => set({ layout: next })} />
        </Field>
        {cells.length === 0 ? <div className="sp-rb-empty">Add the first value to this block.</div> : null}
        <div className="sp-rb-els">{cells.map((cell, index) => {
          const current = isObj(cell) ? cell : {};
          const key = session.keys[index];
          const cellKey = `${invalidKey}:entry:${key}`;
          const binding = layoutBindingEntry(current.bind);
          const summary = [binding?.label || current.bind?.expr || current.bind?.reading || current.bind?.metric || 'Choose a value',
            FORMAT_LABEL[current.format] || current.format].filter(Boolean).join(' · ');
          return (
            <Fragment key={key}><LayoutContentEntry label={current.label || bindingSummary(current.bind)} summary={summary}
              error={entryError(cell, cellKey)} open={openEntry === key}
              onOpen={() => toggleEntry(key)} onClose={() => closeEntry(key)}
              removeLabel={`Remove value ${index + 1}`} onRemove={() => removeEntry(cells, 'cells', index)}>
              <Field label="Label"><TextField label={`Value ${index + 1} label`} value={current.label} maxLength={LIMITS.label} onChange={(next) => patchCell(index, { label: next })} /></Field>
              <BindEditor label="Reads" bind={current.bind} active={openEntry === key}
                previewFormula={preview ? (expr) => preview('atomCell', { cells: cells.map((cell, i) => i === index
                  ? mergeLayoutFields(current, { bind: mergeLayoutFields(current.bind, { metric: undefined, reading: undefined, expr }) }) : cell) }, { index }) : undefined} invalidKey={cellKey} onInvalid={markEntryInvalid} onChange={(next, entry) => patchCell(index, { bind: next, ...(entry ? { format: bindingFormat(current.format, entry) } : {}) })} />
              <FormatField value={current.format} onChange={(next) => patchCell(index, { format: next })} />
              <UnknownFields value={current} knownKeys={['label', 'bind', 'format', 'highlights']} label={`Value ${index + 1}`} invalidKey={`${cellKey}:extra`} onInvalid={markEntryInvalid} onChange={(next) => set({ cells: cells.map((item, i) => (i === index ? next : item)) })} />
            </LayoutContentEntry>
            <HighlightChildren owner={current} ownerType="cell" dependencies={{ target: layoutBindingHasIntrinsicTarget(current.bind) }}
              formulaScope={AGG_FORMULA_SCOPE} cm={brickCmSlot(AGG_FORMULA_SCOPE, current.bind?.expr)}
              onEditingChange={(bad) => markEntryInvalid(`${cellKey}:highlights`, bad)}
              onOpen={() => { setOpenEntry(null); setFormulaEntry(null); }} onChange={(next) => patchCell(index, { highlights: next })} />
            </Fragment>
          );
        })}</div>
        <button
          type="button"
          className="wgf-add sp-lay-inline-add"
          aria-disabled={cells.length >= LIMITS.layoutCells ? true : undefined}
          onClick={() => {
            if (cells.length >= LIMITS.layoutCells) return;
            addEntry(cells, 'cells', { label: `Value ${cells.length + 1}`, bind: { expr: 'im' }, format: 'int' });
          }}
        >
          + Add value <span className="sp-rb-cap">{` · ${cells.length} of ${LIMITS.layoutCells}`}</span>
        </button>
        {extras()}
      </>
    );
  }

  if (type === 'header') return (
    <>
      <Field label="Content"><SelectField label="Heading content" value={value.content || 'verdict'}
        options={pairs(LAYOUT_HEADER_CONTENTS, { text: 'Text', verdict: 'Campaign verdict' })} onChange={(content) => set({ content })} /></Field>
      <Field label={value.content === 'text' ? 'Heading' : 'Fallback heading'}><TextField label={value.content === 'text' ? 'Heading' : 'Fallback heading'} value={value.label} maxLength={LIMITS.label} onChange={(next) => set({ label: next })} /></Field>
      <OptionalText object={value} field="sub" label="Explanation" maxLength={LIMITS.label} onFields={set} />
      {highlights()}
      {extras()}
    </>
  );

  if (type === 'miniChart') {
    const series = arr(value.series);
    const patchSeries = (index, fields) => set({ series: series.map((line, i) => (
      i === index ? mergeLayoutFields(isObj(line) ? line : {}, fields) : line
    )) });
    return (
      <>
        {optionalLabel()}
        {series.length === 0 ? <div className="sp-rb-empty">Add the first line to this block.</div> : null}
        <div className="sp-rb-els">{series.map((line, index) => {
          const current = isObj(line) ? line : {};
          const key = session.keys[index];
          const lineKey = `${invalidKey}:entry:${key}`;
          const binding = layoutBindingEntry({ expr: current.expr });
          return (
            <Fragment key={key}><LayoutContentEntry label={current.label || binding?.label || current.expr || 'Choose a formula'} summary={binding?.label || current.expr}
              marker={<span className="sp-rb-sw" style={{ background: `var(--pal-${index % 2})` }} aria-hidden="true" />}
              error={entryError(line, lineKey)} open={openEntry === key}
              onOpen={() => toggleEntry(key)} onClose={() => closeEntry(key)}
              removeLabel={`Remove line ${index + 1}`} onRemove={() => removeEntry(series, 'series', index)}>
              <Field label="Line ID"><TextField label={`Line ${index + 1} ID`} value={current.id} maxLength={LIMITS.nodeId} onChange={(next) => patchSeries(index, { id: next })} /></Field>
              <Field label="Label"><TextField label={`Line ${index + 1} label`} value={current.label} maxLength={LIMITS.label} onChange={(next) => patchSeries(index, { label: next })} /></Field>
              <Field label="Formula">
                <FormulaField
                  key={`${lineKey}:formula`}
                  label={`Line ${index + 1} formula`}
                  value={current.expr}
                  {...DATE_FORMULA_SCOPE}
                  previewFormula={preview ? (expr) => preview('atomMiniSeries', { series: series.map((line, i) => i === index
                    ? mergeLayoutFields(current, { expr }) : line) }, { elementId: current.id, index }) : undefined}
                  startAdvanced
                  editorOpen={openEntry === key && formulaEntry === key}
                  onEditorOpenChange={(open) => setFormulaEntry(open ? key : null)}
                  onChange={(next) => patchSeries(index, { expr: next })}
                  onDraftState={(_, bad) => markEntryInvalid(`${lineKey}:formula`, bad)}
                />
              </Field>
              <UnknownFields value={current} knownKeys={['id', 'label', 'expr', 'highlights']} label={`Line ${index + 1}`} invalidKey={`${lineKey}:extra`} onInvalid={markEntryInvalid} onChange={(next) => set({ series: series.map((item, i) => (i === index ? next : item)) })} />
            </LayoutContentEntry>
            <HighlightChildren owner={current} ownerType="miniSeries" formulaScope={DATE_FORMULA_SCOPE}
              cm={brickCmSlot(DATE_FORMULA_SCOPE, current.expr)}
              onEditingChange={(bad) => markEntryInvalid(`${lineKey}:highlights`, bad)}
              onOpen={() => { setOpenEntry(null); setFormulaEntry(null); }} onChange={(next) => patchSeries(index, { highlights: next })} />
            </Fragment>
          );
        })}</div>
        <button
          type="button"
          className="wgf-add sp-lay-inline-add"
          aria-disabled={series.length >= LIMITS.layoutSeries ? true : undefined}
          onClick={() => {
            if (series.length >= LIMITS.layoutSeries) return;
            addEntry(series, 'series', { id: newLayoutNodeId(spec, 'line'), label: `Line ${series.length + 1}`, expr: 'im' });
          }}
        >
          + Add line <span className="sp-rb-cap">{` · ${series.length} of ${LIMITS.layoutSeries}`}</span>
        </button>
        {extras()}
      </>
    );
  }

  if (type === 'detailCard') {
    const sourcePresent = hasOwn(value, 'source');
    const bindPresent = hasOwn(value, 'bind');
    const mode = sourcePresent && bindPresent ? 'both' : (sourcePresent ? 'source' : (bindPresent ? 'bind' : 'missing'));
    return (
      <>
        <Field label="Label"><TextField label="Detail card label" value={value.label} maxLength={LIMITS.label} onChange={(next) => set({ label: next })} /></Field>
        <Field label="Draws">
          <SelectField
            label="Detail card content"
            value={mode}
            options={[
              ['source', 'Computed content'], ['bind', 'A value'],
            ]}
            onChange={(next) => {
              if (next === 'source') set({ bind: undefined, format: undefined,
                source: hasOwn(value, 'source') ? value.source : LAYOUT_DETAIL_SOURCES[0] });
              else if (next === 'bind') set({ source: undefined,
                bind: hasOwn(value, 'bind') ? value.bind : { expr: 'im' }, format: hasOwn(value, 'format') ? value.format : 'int' });
            }}
          />
        </Field>
        {content(<>
          {sourcePresent ? <Field label="Content"><SelectField label="Detail card canonical body" value={value.source} options={pairs(LAYOUT_DETAIL_SOURCES, DETAIL_LABEL)} onChange={(next) => set({ source: next })} /></Field> : null}
          {bindPresent || hasOwn(value, 'format') ? <>{bind()}{format()}</> : null}
          {extras()}
        </>, bindPresent ? 'Value' : 'Content', bindPresent
          ? [bindingSummary(value.bind), FORMAT_LABEL[value.format] || value.format].filter(Boolean).join(' · ')
          : null, bindPresent ? bindingSummary(value.bind) : DETAIL_LABEL[value.source] || (typeof value.source === 'string' ? value.source : 'Choose content'))}
        <OptionalText object={value} field="sub" label="Supporting text" maxLength={LIMITS.support} onFields={set} />
      </>
    );
  }

  if (type === 'unitBars') return content(<><UnitFields units={value.units} options={LAYOUT_DELIVERY_UNITS} onChange={(units) => set({ units })} />{extras()}</>, 'Units', value.units === undefined ? 'Campaign default' : arr(value.units).map((unit) => UNIT_LABEL[unit] || unit).join(', ') || 'Choose units', 'Delivery units');

  if (type === 'gauge') return (
    <>
      {optionalLabel(true)}{content(<>{bind()}{format()}{target()}
      <Field label="Spread"><NumberField label="Gauge spread" value={value.spread} min={0.000001} max={100} onChange={(next) => set({ spread: next })} /><span className="sp-lay-help">Over 0, up to 100.</span></Field>
      {extras()}</>)}
    </>
  );

  if (type === 'moneyStat') return (
    <>
      {optionalLabel()}
      {content(<>{bind()}
      <Field label="Money side"><SelectField label="Money side" value={value.role} options={pairs(LAYOUT_MONEY_SIDES, ROLE_LABEL)} onChange={(next) => set({ role: next })} /></Field>
      {target()}{extras()}</>)}
    </>
  );

  if (type === 'kvRow') return (
    <>
      <Field label="Label"><TextField label="Key/value label" value={value.label} maxLength={LIMITS.label} onChange={(next) => set({ label: next })} /></Field>
      {content(<>{bind()}{format()}{target()}
      <Field label="Emphasis"><SelectField label="Key/value emphasis" value={value.emphasis} options={pairs(LAYOUT_EMPHASIS, EMPHASIS_LABEL)} onChange={(next) => set({ emphasis: next })} /></Field>
      {extras()}</>)}
      <OptionalText object={value} field="sub" label="Supporting text" maxLength={LIMITS.label} onFields={set} />
    </>
  );

  if (type === 'rateRows') return <>{content(
    <>
      <Field label="Rate series"><SelectField label="Rate rows series" value={value.series} options={pairs(LAYOUT_RATE_SERIES, RATE_LABEL)} onChange={(next) => set({ series: next, units: normalizeRateUnitsForSeries(next, value.units) })} /></Field>
      <UnitFields units={value.units} options={LAYOUT_RATE_UNITS} unavailable={value.series === 'dynamic' ? [] : ['CPA']} onChange={(units) => set({ units })} />
      {extras()}
    </>, 'Rates', value.units === undefined ? 'Campaign default' : arr(value.units).join(', ') || 'Choose units',
    RATE_LABEL[value.series] || value.series || 'Choose rates')}
    {value.series !== 'dynamic' && arr(value.units).includes('CPA')
      ? <div className="sp-lay-help" role="status">CPA only belongs to Dynamic rates. Remove it or choose Dynamic rates.</div>
      : null}
  </>;

  if (type === 'progressBar') {
    return (
      <>
        {optionalLabel(true)}{content(<>{bind()}{target()}
        <button type="button" className="wgf-add sp-content-add" onClick={() => {
          if (!hasOwn(value, 'tick')) set({ tick: { expr: 'expIm' } });
          setOpenEntry(markerKey);
        }}>{hasOwn(value, 'tick') ? 'Edit marker' : '+ Add marker'}</button>
        <Field label="Colour"><SelectField label="Progress colour" value={value.tone || 'auto'}
          options={[['auto', 'Automatic'], ['neutral', 'Neutral']]}
          onChange={(next) => set({ tone: next === 'neutral' ? next : undefined })} /></Field>
        <Field label="Thickness"><SelectField label="Progress thickness" value={value.size || 'regular'}
          options={[['regular', 'Regular'], ['compact', 'Compact']]}
          onChange={(next) => set({ size: next === 'compact' ? next : undefined })} /></Field>
        {extras()}</>)}
      </>
    );
  }

  if (type === 'flightBullet') return <><div className="sp-lay-help">It follows the Widget's effective flight. Highlights check the current flight day against the total days.</div>{highlights()}{extras()}</>;

  if (type === 'note') {
    const sourcePresent = hasOwn(value, 'source');
    const textPresent = hasOwn(value, 'text');
    const mode = sourcePresent && textPresent ? 'both' : (sourcePresent ? 'source' : (textPresent ? 'text' : 'missing'));
    const currentText = sourcePresent ? preview?.('atomNote', {}) : null;
    return (
      <>
        <Field label="Words">
          <SelectField
            label="Note content"
            value={mode}
            options={[
              ['text', 'Authored text'], ['source', 'Computed line'],
            ]}
            onChange={(next) => {
              if (next === 'source') set({ text: undefined, align: hasOwn(value, 'align') ? value.align : 'start',
                source: hasOwn(value, 'source') ? value.source : LAYOUT_NOTE_SOURCES[0] });
              else if (next === 'text') set({ source: undefined, align: hasOwn(value, 'align') ? value.align : 'start',
                text: hasOwn(value, 'text') ? value.text : 'Note' });
            }}
          />
        </Field>
        {sourcePresent || mode === 'source' ? (
          content(<>
            <Field label="Content"><SelectField label="Note canonical line" value={value.source} options={pairs(LAYOUT_NOTE_SOURCES, LAYOUT_NOTE_LABELS)} onChange={(next) => set({ source: next })} /></Field>
            {currentText?.status === 'ready' ? <div className="sp-lay-help">{currentText.formatted}</div> : null}
          </>, 'Content', currentText?.status === 'ready' ? currentText.formatted : null,
          LAYOUT_NOTE_LABELS[value.source] || (typeof value.source === 'string' ? value.source : 'Choose content'))
        ) : null}
        {textPresent || mode === 'text' ? (
          <Field label="Text"><TextField label="Note text" value={value.text} maxLength={LIMITS.support} onChange={(next) => set({ text: next })} /></Field>
        ) : null}
        {!sourcePresent && mode !== 'source' ? highlights() : null}
        <Field label="Text style"><SelectField label="Note style" value={value.style || 'note'}
          options={[['note', 'Note'], ['headline', 'Headline'], ['caption', 'Caption']]}
          onChange={(next) => set({ style: next === 'note' ? undefined : next })} /></Field>
        <Field label="Alignment"><SelectField label="Note alignment" value={value.align} options={[['start', 'Start'], ['center', 'Centre']]} onChange={(next) => set({ align: next })} /></Field>
        {extras()}
      </>
    );
  }

  return (
    <>
      <div className="sp-lay-help">This block type is not known to this Builder. Its stored fields remain below.</div>
      {extras()}
    </>
  );
}

function BlockPanel({ block, spec, rowIndex, colIndex, blockIndex, count, onMove, onRemove, onChange, onRetype, onInvalid }) {
  const type = isObj(block) ? block.type : '';
  return (
    <section className="sp-lay-block">
      <div className="sp-lay-head">
        <span className="sp-lay-count">{`Block ${blockIndex + 1} of ${count}`}</span>
        <SelectField label={`Block ${blockIndex + 1} type`} value={type} options={LAYOUT_BLOCK_CHOICES.map(([value, label]) => [value, label])} onChange={onRetype} />
        <span className="sp-rb-btns">
          <button type="button" className="sp-rb-btn" aria-label={`Move block ${blockIndex + 1} up`} aria-disabled={blockIndex === 0 ? true : undefined} onClick={() => { if (blockIndex > 0) onMove(-1); }}>▲</button>
          <button type="button" className="sp-rb-btn" aria-label={`Move block ${blockIndex + 1} down`} aria-disabled={blockIndex === count - 1 ? true : undefined} onClick={() => { if (blockIndex < count - 1) onMove(1); }}>▼</button>
          <button type="button" className="sp-rb-btn sp-rb-btn--rm" aria-label={`Remove block ${blockIndex + 1}`} onClick={onRemove}>×</button>
        </span>
      </div>
      <div className="sp-lay-help">{LAYOUT_BLOCK_HINTS[type] || 'Unknown stored block; no field is discarded.'}</div>
      <BlockEditor
        block={block}
        spec={spec}
        path={`${rowIndex}:${colIndex}:${blockIndex}`}
        onChange={onChange}
        onInvalid={onInvalid}
      />
    </section>
  );
}

export function BadgeEditor({ col, onFields, invalidKey, onInvalid, allowHide = false, widget, viewId, formulaPreview }) {
  const badge = own(col, 'badge');
  const present = hasOwn(col, 'badge');
  let mode = 'none';
  if (present && typeof badge === 'string') mode = 'text';
  else if (isObj(badge) && typeof badge.words === 'string') mode = badge.words;
  else if (present) mode = 'unknown';
  const [open, setOpen] = useState(false);
  const [modeRefusal, setModeRefusal] = useState(null);
  const [invalidEntries, setInvalidEntries] = useState(() => new Set());
  useEffect(() => { setOpen(false); }, [invalidKey, mode]);
  const markInvalid = useCallback((key, bad) => {
    onInvalid(key, bad);
    if (!bad && key === `${invalidKey}:badge-extra`) setModeRefusal(null);
    setInvalidEntries((previous) => {
      if (previous.has(key) === bad) return previous;
      const next = new Set(previous);
      if (bad) next.add(key); else next.delete(key);
      return next;
    });
  }, [onInvalid, invalidKey]);
  const hasReading = mode === 'pace' || mode === 'margin' || (isObj(badge) && hasOwn(badge, 'bind'));
  const extraFields = isObj(badge) ? <UnknownFields value={badge} knownKeys={['words', 'text', 'bind']} label="Badge"
    invalidKey={`${invalidKey}:badge-extra`} onInvalid={markInvalid} onChange={(next) => onFields({ badge: next })} /> : null;
  const refusal = hasReading ? refusalText(layoutViewRefusal({ id: 'badge', kind: 'layout', title: '',
    rows: [{ cols: [{ span: null, frame: 'card', badge, bricks: [{ type: 'note', text: 'Badge', align: 'start' }] }] }] })) : null;
  const readingError = refusal || bindingFormulaError(badge?.bind, 'Badge value')
    || ([...invalidEntries].some((key) => key.startsWith(`${invalidKey}:badge`)) ? 'Finish editing the settings.' : null);
  const setMode = (next) => {
    setOpen(false);
    // Any pick that is not refused below takes a standing refusal down with it.
    setModeRefusal(null);
    if (next === 'hidden') { onFields({ hideBadge: true }); return; }
    const show = allowHide ? { hideBadge: undefined } : {};
    if (next === mode) { onFields(show); return; }
    // Plain text/no badge cannot carry object fields. Keep unfinished input
    // editable until it is repaired; object-to-object changes retain it in place.
    if (['none', 'text'].includes(next) && invalidEntries.has(`${invalidKey}:badge-extra`)) {
      setModeRefusal('Finish editing the badge extra fields before changing to plain text or removing the badge.');
      return;
    }
    const objectBadge = (fields) => mergeLayoutFields(isObj(badge) ? badge : {}, { words: next, text: undefined, bind: undefined, ...fields });
    if (next === 'none') onFields({ badge: undefined, ...show });
    else if (next === 'text') onFields({ badge: 'Badge', ...show });
    else if (next === 'currency') onFields({ badge: objectBadge({ text: 'Client side' }), ...show });
    else if (next === 'pace') onFields({ badge: objectBadge({ bind: { metric: 'paceDeltaImpr' } }), ...show });
    else if (next === 'margin') onFields({ badge: objectBadge({ bind: { expr: '(dc-sp)/dc*100-mTgt' } }), ...show });
  };
  return (
    <div className="sp-lay-badge">
      <Field label="Badge">
        <SelectField
          label="Column badge"
          value={allowHide && present && col.hideBadge ? 'hidden' : mode}
          options={[
            ['none', 'No badge'], ...(allowHide && present ? [['hidden', 'Hidden (keep content)']] : []),
            ['text', 'Authored words'], ...pairs(LAYOUT_BADGES, BADGE_LABEL),
          ]}
          onChange={setMode}
        />
      </Field>
      {modeRefusal ? <div className="sp-lay-refusal" role="status">{modeRefusal}</div> : null}
      {mode === 'text' ? (
        <Field label="Badge words"><TextField label="Badge words" value={badge} maxLength={LIMITS.label} onChange={(next) => onFields({ badge: next })} /></Field>
      ) : null}
      {mode === 'currency' || (isObj(badge) && hasOwn(badge, 'text')) ? (
        <Field label="Currency words"><TextField label="Currency badge words" value={badge?.text} maxLength={LIMITS.label} onChange={(next) => onFields({ badge: mergeLayoutFields(badge, { text: next }) })} /></Field>
      ) : null}
      {hasReading ? (
        <div className="sp-rb-els"><LayoutContentEntry label={bindingSummary(badge?.bind)} settingsTitle="Badge value"
          error={readingError} open={open} onOpen={() => setOpen((previous) => !previous)} onClose={() => setOpen(false)}>
        <BindEditor label="Badge reading" bind={badge?.bind} active={open}
          previewFormula={formulaPreview && widget && viewId ? (expr) => formulaPreview({ ...widget,
            spec: updateView(widget.spec, viewId, (node) => ({ ...node, badge: mergeLayoutFields(badge,
              { bind: mergeLayoutFields(badge?.bind, { metric: undefined, reading: undefined, expr }) }) })),
          }, { kind: 'containerBadge', viewId }) : undefined} invalidKey={`${invalidKey}:badge`} onInvalid={markInvalid} onChange={(next) => onFields({ badge: mergeLayoutFields(badge, { bind: next }) })} />
        </LayoutContentEntry></div>
      ) : null}
      {extraFields}
    </div>
  );
}

function ColumnPanel({ col, spec, rowIndex, colIndex, count, totalBlocks, onMove, onRemove, onChange, onAddBlock, onMoveBlock, onRemoveBlock, onPatchBlock, onInvalid, onAskRetype }) {
  const value = isObj(col) ? col : {};
  const blocks = layoutBlocks(value);
  const atColCap = blocks.length >= LIMITS.layoutBricksPerCol;
  const atTotalCap = totalBlocks >= LIMITS.layoutBricks;
  const [newType, setNewType] = useState(LAYOUT_BLOCK_CHOICES[0][0]);
  const set = (fields) => onChange(mergeLayoutFields(value, fields));
  const invalidKey = `column:${rowIndex}:${colIndex}`;
  const spans = Array.from({ length: LIMITS.layoutSpan }, (_, index) => [String(index + 1), `${index + 1} of ${LIMITS.layoutSpan}`]);
  return (
    <section className="sp-lay-col">
      <div className="sp-lay-head">
        <b>{`Column ${colIndex + 1} of ${count}`}</b>
        <span className="sp-rb-cap">{`${blocks.length} of ${LIMITS.layoutBricksPerCol} blocks`}</span>
        <span className="sp-rb-btns">
          <button type="button" className="sp-rb-btn" aria-label={`Move column ${colIndex + 1} left`} aria-disabled={colIndex === 0 ? true : undefined} onClick={() => { if (colIndex > 0) onMove(-1); }}>◀</button>
          <button type="button" className="sp-rb-btn" aria-label={`Move column ${colIndex + 1} right`} aria-disabled={colIndex === count - 1 ? true : undefined} onClick={() => { if (colIndex < count - 1) onMove(1); }}>▶</button>
          <button type="button" className="sp-rb-btn sp-rb-btn--rm" aria-label={`Remove column ${colIndex + 1}`} onClick={onRemove}>×</button>
        </span>
      </div>
      <Field label="Width">
        <SelectField
          label={`Column ${colIndex + 1} width`}
          value={!hasOwn(value, 'span') ? 'missing' : (value.span === null ? 'auto' : String(value.span))}
          options={[['auto', 'Share the row'], ...spans]}
          onChange={(next) => set({ span: next === 'missing' ? undefined : (next === 'auto' ? null : Number(next)) })}
        />
      </Field>
      <Field label="Frame">
        <SelectField label={`Column ${colIndex + 1} frame`} value={value.frame} options={pairs(LAYOUT_FRAMES_LIST, FRAME_LABEL)} onChange={(next) => set({ frame: next })} />
      </Field>
      {/* Chrome stays visible even on an unframed column. If stored there it is invalid,
          and hiding it would leave no way to see or remove the strict refusal. */}
      <OptionalText object={value} field="title" label="Frame title" maxLength={LIMITS.label} onFields={set} />
      <OptionalText object={value} field="sub" label="Frame subtitle" maxLength={LIMITS.support} onFields={set} />
      <BadgeEditor col={value} onFields={set} invalidKey={invalidKey} onInvalid={onInvalid} />

      {blocks.length === 0 ? <div className="sp-rb-empty">Add the first block to this column.</div> : null}
      {blocks.map((block, blockIndex) => (
        <BlockPanel
          key={`block:${blockIndex}`}
          block={block}
          spec={spec}
          rowIndex={rowIndex}
          colIndex={colIndex}
          blockIndex={blockIndex}
          count={blocks.length}
          onMove={(direction) => onMoveBlock(blockIndex, direction)}
          onRemove={() => onRemoveBlock(blockIndex)}
          onChange={(next) => onPatchBlock(blockIndex, next)}
          onRetype={(type) => onAskRetype(blockIndex, block, type)}
          onInvalid={onInvalid}
        />
      ))}

      <div className="sp-lay-addline">
        <SelectField label={`Block type for column ${colIndex + 1}`} value={newType} options={LAYOUT_BLOCK_CHOICES.map(([type, label]) => [type, label])} onChange={setNewType} />
        <button
          type="button"
          className="wgf-add sp-lay-add"
          aria-disabled={atColCap || atTotalCap ? true : undefined}
          onClick={() => { if (!atColCap && !atTotalCap) onAddBlock(newType); }}
        >
          + Add block <span className="sp-rb-cap">{` · ${totalBlocks} of ${LIMITS.layoutBricks}`}</span>
        </button>
      </div>
      <UnknownFields value={value} knownKeys={LAYOUT_COLUMN_KEYS} label="Column" invalidKey={`${invalidKey}:extra`} onInvalid={onInvalid} onChange={onChange} />
    </section>
  );
}

function RowPanel({ row, spec, rowIndex, count, totalBlocks, onMove, onRemove, onChange, onAddCol, onMoveCol, onRemoveCol, onPatchCol, onAddBlock, onMoveBlock, onRemoveBlock, onPatchBlock, onInvalid, onAskRetype }) {
  const value = isObj(row) ? row : {};
  const cols = layoutCols(value);
  const atCap = cols.length >= LIMITS.layoutCols;
  return (
    <section className="sp-lay-row">
      <div className="sp-lay-head">
        <b>{`Row ${rowIndex + 1} of ${count}`}</b>
        <span className="sp-rb-cap">{`${cols.length} of ${LIMITS.layoutCols} columns`}</span>
        <span className="sp-rb-btns">
          <button type="button" className="sp-rb-btn" aria-label={`Move row ${rowIndex + 1} up`} aria-disabled={rowIndex === 0 ? true : undefined} onClick={() => { if (rowIndex > 0) onMove(-1); }}>▲</button>
          <button type="button" className="sp-rb-btn" aria-label={`Move row ${rowIndex + 1} down`} aria-disabled={rowIndex === count - 1 ? true : undefined} onClick={() => { if (rowIndex < count - 1) onMove(1); }}>▼</button>
          <button type="button" className="sp-rb-btn sp-rb-btn--rm" aria-label={`Remove row ${rowIndex + 1}`} onClick={onRemove}>×</button>
        </span>
      </div>
      {cols.length === 0 ? <div className="sp-rb-empty">Add the first column to this row.</div> : null}
      {cols.map((col, colIndex) => (
        <ColumnPanel
          key={`column:${colIndex}`}
          col={col}
          spec={spec}
          rowIndex={rowIndex}
          colIndex={colIndex}
          count={cols.length}
          totalBlocks={totalBlocks}
          onMove={(direction) => onMoveCol(colIndex, direction)}
          onRemove={() => onRemoveCol(colIndex)}
          onChange={(next) => onPatchCol(colIndex, next)}
          onAddBlock={(type) => onAddBlock(colIndex, type)}
          onMoveBlock={(blockIndex, direction) => onMoveBlock(colIndex, blockIndex, direction)}
          onRemoveBlock={(blockIndex) => onRemoveBlock(colIndex, blockIndex)}
          onPatchBlock={(blockIndex, next) => onPatchBlock(colIndex, blockIndex, next)}
          onInvalid={onInvalid}
          onAskRetype={(blockIndex, block, type) => onAskRetype(colIndex, blockIndex, block, type)}
        />
      ))}
      <button
        type="button"
        className="wgf-add sp-lay-add"
        aria-disabled={atCap ? true : undefined}
        onClick={() => { if (!atCap) onAddCol(); }}
      >
        + Add column <span className="sp-rb-cap">{` · ${cols.length} of ${LIMITS.layoutCols}`}</span>
      </button>
      <UnknownFields value={value} knownKeys={LAYOUT_ROW_KEYS} label="Row" invalidKey={`row:${rowIndex}:extra`} onInvalid={onInvalid} onChange={onChange} />
    </section>
  );
}

export default function LayoutCard({
  view, spec, patch, first, last, onMove, onDropAt, onRemove, onDraftInvalid,
}) {
  const rows = layoutRows(view);
  const totalBlocks = countLayoutBlocks(view);
  const refusal = layoutViewRefusal(view);
  const localInvalid = useRef(new Set());
  const [pendingRetype, setPendingRetype] = useState(null);

  const markInvalid = useCallback((key, bad) => {
    if (bad) localInvalid.current.add(key);
    else localInvalid.current.delete(key);
    onDraftInvalid?.(localInvalid.current.size > 0);
  }, [onDraftInvalid]);
  useEffect(() => () => onDraftInvalid?.(false), [onDraftInvalid]);

  const patchBlock = (rowIndex, colIndex, blockIndex, next) => patch((current) => (
    patchLayoutBlock(current, view.id, rowIndex, colIndex, blockIndex, () => next)
  ));
  const askRetype = (rowIndex, colIndex, blockIndex, block, type) => {
    if (type === block?.type) return;
    const conversion = convertLayoutBlock(block, type, spec);
    if (!conversion.incompatible.length) {
      patchBlock(rowIndex, colIndex, blockIndex, conversion.brick);
      return;
    }
    setPendingRetype({ rowIndex, colIndex, blockIndex, type, from: block?.type, incompatible: conversion.incompatible });
  };

  return (
    <ViewFrame
      view={view}
      spec={spec}
      first={first}
      last={last}
      onMove={onMove}
      onDropAt={onDropAt}
      onRemove={onRemove}
      onTitle={(title) => patch((current) => patchLayoutView(current, view.id, { title }))}
    >
      <div className="sp-rb-row sp-rb-row--view">
        <span className="sp-rb-chip">{`Rows ${rows.length} of ${LIMITS.layoutRows}`}</span>
        <span className="sp-rb-chip">{`Blocks ${totalBlocks} of ${LIMITS.layoutBricks}`}</span>
      </div>

      {refusal ? (
        <div className="sp-lay-refusal" role="status">
          <b>Not savable yet:</b> {refusal}
        </div>
      ) : null}

      {rows.length === 0 ? <div className="sp-rb-empty">Add the first row to this Layout.</div> : null}
      <div className="sp-lay-tree">
        {rows.map((row, rowIndex) => (
          <RowPanel
            key={`row:${rowIndex}`}
            row={row}
            spec={spec}
            rowIndex={rowIndex}
            count={rows.length}
            totalBlocks={totalBlocks}
            onMove={(direction) => patch((current) => moveLayoutRow(current, view.id, rowIndex, direction))}
            onRemove={() => patch((current) => removeLayoutRow(current, view.id, rowIndex))}
            onChange={(next) => patch((current) => replaceLayoutRow(current, view.id, rowIndex, next))}
            onAddCol={() => patch((current) => addLayoutCol(current, view.id, rowIndex))}
            onMoveCol={(colIndex, direction) => patch((current) => moveLayoutCol(current, view.id, rowIndex, colIndex, direction))}
            onRemoveCol={(colIndex) => patch((current) => removeLayoutCol(current, view.id, rowIndex, colIndex))}
            onPatchCol={(colIndex, next) => patch((current) => replaceLayoutCol(current, view.id, rowIndex, colIndex, next))}
            onAddBlock={(colIndex, type) => patch((current) => addLayoutBlock(current, view.id, rowIndex, colIndex, type))}
            onMoveBlock={(colIndex, blockIndex, direction) => patch((current) => moveLayoutBlock(current, view.id, rowIndex, colIndex, blockIndex, direction))}
            onRemoveBlock={(colIndex, blockIndex) => patch((current) => removeLayoutBlock(current, view.id, rowIndex, colIndex, blockIndex))}
            onPatchBlock={(colIndex, blockIndex, next) => patchBlock(rowIndex, colIndex, blockIndex, next)}
            onInvalid={markInvalid}
            onAskRetype={(colIndex, blockIndex, block, type) => askRetype(rowIndex, colIndex, blockIndex, block, type)}
          />
        ))}
      </div>

      <button
        type="button"
        className="wgf-add sp-lay-add"
        aria-disabled={rows.length >= LIMITS.layoutRows ? true : undefined}
        onClick={() => { if (rows.length < LIMITS.layoutRows) patch((current) => addLayoutRow(current, view.id)); }}
      >
        + Add row <span className="sp-rb-cap">{` · ${rows.length} of ${LIMITS.layoutRows}`}</span>
      </button>

      <UnknownFields
        value={view}
        knownKeys={LAYOUT_VIEW_KEYS}
        label="Layout view"
        invalidKey="layout-view-extra"
        onInvalid={markInvalid}
        onChange={(next) => patch((current) => replaceLayoutView(current, view.id, next))}
      />

      {pendingRetype ? (
        <ConfirmModal
          title="Change this block?"
          message={`Change to ${LAYOUT_BLOCK_LABELS[pendingRetype.type] || pendingRetype.type}? These settings do not transfer: ${pendingRetype.incompatible.map((field) => field.label).join(', ')}. Compatible settings are kept.`}
          confirmLabel="Change block"
          onConfirm={() => {
            const pending = pendingRetype;
            patch((current) => patchLayoutBlock(
              current, view.id, pending.rowIndex, pending.colIndex, pending.blockIndex,
              (block) => convertLayoutBlock(block, pending.type, current).brick,
            ));
            setPendingRetype(null);
          }}
          onCancel={() => setPendingRetype(null)}
        />
      ) : null}
    </ViewFrame>
  );
}
