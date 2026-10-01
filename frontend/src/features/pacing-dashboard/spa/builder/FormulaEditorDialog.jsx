import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  openNativeSelect, useFocusOnOpen, useFocusTrap, useInertBackground, useOpenerRestore,
} from '../PopupCoordinator.jsx';
import {
  validate, identifiersOf, dateAxisRefusal, FIELDS_DAILY, FIELDS_EXPECTED, FIELDS_RATES, FIELDS_PLAN,
  FIELDS_CM, FUNCTIONS, NO_CM_JOIN,
} from '../widget-formula.js';
import {
  FIELD_LABELS, metricAvailability, PLAN_FOLLOWS_WINDOW, PLAN_WHOLE, COST_BUD_SPAN, BUDGET_TO_DATE_SPAN, CTR_TIP,
  CTR_TARGET_TIP,
} from '../metric-catalog.js';
import { UNIT_FAMILIES } from '../report-v2.js';
import './FormulaEditorDialog.css';

export const FORMULA_TOKEN_MIME = 'wgf/tok';

const FIELD_TIPS = {
  im: 'Impressions, summed under this Widget’s filters.',
  cl: 'Clicks.', sp: 'Media spend.', co: 'Completed views or listens.',
  coViews: 'Views volume across CPV, video and audio lines.',
  cv: 'Conversions.', pc: 'Post-click conversions.', pv: 'Post-view conversions.',
  dc: 'Client cost from the current pricing rule.',
  expIm: 'Expected impressions, cumulative to date.',
  expCo: 'Expected cost, cumulative to date.',
  expCl: 'Expected clicks, cumulative to date.',
  expVw: 'Expected views, cumulative to date.',
  ctr: CTR_TIP,
  vcr: 'VCR using video-eligible lines.', acr: 'ACR using audio lines.',
  cpm: 'CPM using the dashboard’s line eligibility rules.',
  cpc: 'Spend divided by clicks.', cpv: 'Spend divided by eligible views.',
  // The plan sums, their whole-plan twins and the prorated cost budget say what they cover in
  // the Spotlight's own words (metric-catalog.js), so the two surfaces cannot drift apart.
  budget: `Client budget of the effective line-item set. ${PLAN_FOLLOWS_WINDOW}`,
  costBud: COST_BUD_SPAN,
  costBudTotal: 'Cost budget for the whole flight; it does not follow the date window.',
  planImpr: `Planned impressions. ${PLAN_FOLLOWS_WINDOW}`,
  planClicks: `Planned clicks. ${PLAN_FOLLOWS_WINDOW}`,
  planViews: `Planned views. ${PLAN_FOLLOWS_WINDOW}`,
  budgetTotal: `Client budget. ${PLAN_WHOLE}`,
  budgetToDate: BUDGET_TO_DATE_SPAN,
  planImprTotal: `Planned impressions. ${PLAN_WHOLE}`,
  planClicksTotal: `Planned clicks. ${PLAN_WHOLE}`,
  planViewsTotal: `Planned views. ${PLAN_WHOLE}`,
  daysLeft: 'Flight days remaining.', daysPassed: 'Flight days elapsed.',
  mTgt: 'Margin target percentage.', ctrT: CTR_TARGET_TIP,
  vcrT: 'VCR target percentage.', acrT: 'ACR target percentage.',
  // Spec 2026-09-16 §2.3 asks the editor to name the pairing beside the field, and this is
  // where: im, cl and co inside a CM360 formula read the MATCHED delivery half, not the
  // widget's own delivery total, which is what makes cmIm / im a ratio of one population.
  cmIm: 'CM360 impressions for the rows this element joins; im beside it reads the matched delivery half.',
  cmCl: 'CM360 clicks for the rows this element joins; cl beside it reads the matched delivery half.',
  cmCo: 'CM360 completions for the rows this element joins; co beside it reads the matched delivery half.',
};
const FUNCTION_TIPS = {
  cumsum: 'Running total over the visible date window.',
  rolling: 'Trailing mean over a number of calendar days.',
  shift: 'Value a number of days earlier; zero before the window.',
  min: 'The smaller of two values.', max: 'The larger of two values.',
  abs: 'Absolute value.', round: 'Round to an optional number of digits.',
  if: 'Choose between two values using a condition.',
};
const FUNCTION_INSERT = {
  cumsum: 'cumsum(x)', rolling: 'rolling(x, 7)', shift: 'shift(x, 1)',
  min: 'min(a, b)', max: 'max(a, b)', abs: 'abs(x)', round: 'round(x, 2)',
  if: 'if(im > 0, a, b)',
};
// No cl / im entry: the ctr field counts every line (owner decision 2026-09-23), so
// cl / im * 100 IS ctr and a warning that they can differ would be false.
const RATIO_LINTS = [
  [/\bsp\s*\/\s*im\b/, 'cpm'],
  [/\bco\s*\/\s*im\b/, 'vcr'], [/\bsp\s*\/\s*cl\b/, 'cpc'],
  [/\bsp\s*\/\s*co\b(?!V)/, 'cpv'],
];

const fieldLabel = (name, labels) => Object.prototype.hasOwnProperty.call(labels || {}, name)
  ? labels[name] : FIELD_LABELS[name];

export function ratioLint(src) {
  for (const [pattern, field] of RATIO_LINTS) {
    if (pattern.test(src || '')) {
      return `Raw math counts every line literally; the ${field} field follows the dashboard’s rules and can differ on mixed campaigns.`;
    }
  }
  return null;
}

/** The mart-metrics inventory sentence for a formula, or null (spec 2026-09-08 §3.6). */
export function formulaAvailability(src, inventory) {
  if (inventory === undefined) return null;
  for (const k of identifiersOf(src)) {
    const why = metricAvailability(k, inventory, FIELD_LABELS[k]);
    if (why) return why;
  }
  return null;
}

export function formulaPaletteEntries({ contextKind, fieldSet, fieldLabels, cm = null, cmRefusal = NO_CM_JOIN, cmUnavailable = null }) {
  const allowed = fieldSet || new Set();
  const known = new Set([
    ...FIELDS_DAILY, ...FIELDS_EXPECTED, ...FIELDS_RATES, ...FIELDS_PLAN,
  ]);
  const groups = [
    ['Daily', [...FIELDS_DAILY]], ['Expected', [...FIELDS_EXPECTED]],
    ['Rates', [...FIELDS_RATES]], ['Plan', [...FIELDS_PLAN]],
    ['Source fields', [...allowed].filter((name) => !known.has(name))],
  ];
  const out = [];
  for (const [group, names] of groups) {
    for (const name of names) {
      if (!allowed.has(name)) continue;
      const label = fieldLabel(name, fieldLabels) || name;
      out.push({ id: `field:${name}`, group, token: name, label, insert: name, help: FIELD_TIPS[name] || `${label} (${name}).` });
    }
  }
  // The CM360 group, admitted PAST the field-set gate above (§2.10): the three identifiers
  // are in no field set by construction, so `allowed.has(name)` is false for every one of
  // them and the loop above can never reach one. It is listed even where the slot cannot
  // take one, disabled with the reason — a reader learns the numbers exist and why this slot
  // cannot read them, which is what they opened the palette to find out.
  //
  // Two sentences, and the order is the order a person can act on: the SLOT first (move the
  // formula, or change the grain), then the PACING (add the source, or map it).
  const cmReason = !cm ? cmRefusal : (cmUnavailable || null);
  for (const name of FIELDS_CM) {
    const label = fieldLabel(name, fieldLabels) || name;
    out.push({
      id: `field:${name}`, group: 'CM360', token: name, label, insert: name,
      disabled: !!cmReason, help: cmReason || FIELD_TIPS[name] || `${label} (${name}).`,
    });
  }
  for (const name of Object.keys(FUNCTIONS)) {
    const disabled = FUNCTIONS[name].tsOnly && contextKind !== 'ts';
    // The validator's own sentence, imported rather than retyped: the palette explains why this
    // function is greyed out, and the field under it refuses the same expression with the same
    // words. Two wordings of one refusal read as two different rules.
    const reason = dateAxisRefusal(name);
    out.push({
      id: `function:${name}`, group: 'Functions', token: `${name}()`, label: `${name}()`,
      insert: FUNCTION_INSERT[name], disabled, help: disabled ? reason : (FUNCTION_TIPS[name] || `${name}().`),
    });
  }
  return out;
}

export function FormulaPalette({
  contextKind, fieldSet, fieldLabels, onInsert, query = '', onHelp, tooltips = false,
  cm = null, cmRefusal = NO_CM_JOIN, cmUnavailable = null,
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const entries = formulaPaletteEntries({ contextKind, fieldSet, fieldLabels, cm, cmRefusal, cmUnavailable }).filter((entry) => (
    !normalized || `${entry.token} ${entry.label} ${entry.help} ${entry.group}`.toLocaleLowerCase().includes(normalized)
  ));
  const groups = [...new Set(entries.map((entry) => entry.group))];
  return (
    <div className="wgf-pal fxd-palette">
      {groups.map((group) => (
        <div className="wgf-pg" key={group}>
          <span className="wgf-pgl">{group}</span>
          {entries.filter((entry) => entry.group === group).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`wgf-tok${tooltips ? ' ui-tip' : ''}${entry.disabled ? ' wgf-tok--off' : ''}`}
              data-tip={tooltips ? entry.help : undefined}
              aria-disabled={entry.disabled || undefined}
              draggable={!entry.disabled}
              onFocus={() => onHelp?.(entry.help)}
              onMouseEnter={() => onHelp?.(entry.help)}
              onDragStart={(event) => {
                if (entry.disabled) return;
                event.dataTransfer.setData(FORMULA_TOKEN_MIME, entry.insert);
                event.dataTransfer.setData('text/plain', entry.insert);
              }}
              onClick={() => { if (!entry.disabled) onInsert(entry.insert); else onHelp?.(entry.help); }}
            >
              {entry.token}
              {entry.group !== 'Functions' && entry.label !== entry.token
                ? <span className="wgf-tok-h"> · {entry.label}</span> : null}
            </button>
          ))}
        </div>
      ))}
      {!entries.length ? <div className="fxd-empty">No fields or functions match this search.</div> : null}
    </div>
  );
}

const familyLabel = (family) => family.charAt(0).toUpperCase() + family.slice(1);

/** Build a bounded drawing without changing the evaluated series. Original array indexes
 * own x positions, and every missing value starts a new segment, so an absent date remains
 * an honest gap rather than being squeezed out or bridged by a line. */
export function sparklineSegments(points, maxPoints = 120) {
  const source = Array.isArray(points) ? points : [];
  const finite = [];
  let min = Infinity;
  let max = -Infinity;
  let run = -1;
  let afterGap = true;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]?.value;
    if (!Number.isFinite(value)) { afterGap = true; continue; }
    if (afterGap) { run += 1; afterGap = false; }
    finite.push({ index, run, value });
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!finite.length) return { segments: [], finiteCount: 0, plottedCount: 0 };

  const cap = Math.max(2, Math.floor(maxPoints) || 120);
  let plotted = finite;
  if (finite.length > cap) {
    plotted = [];
    let previous = -1;
    for (let slot = 0; slot < cap; slot += 1) {
      const position = Math.round((slot / (cap - 1)) * (finite.length - 1));
      if (position !== previous) plotted.push(finite[position]);
      previous = position;
    }
  }

  const spread = max - min || 1;
  const denominator = Math.max(1, source.length - 1);
  const segments = [];
  for (const point of plotted) {
    const coordinate = {
      x: source.length === 1 ? 50 : (point.index / denominator) * 100,
      y: 27 - ((point.value - min) / spread) * 23,
    };
    const segment = segments.at(-1);
    if (!segment || segment.run !== point.run) segments.push({ run: point.run, points: [coordinate] });
    else segment.points.push(coordinate);
  }
  return { segments, finiteCount: finite.length, plottedCount: plotted.length };
}

/** The shared, display-only result of an exact ReportWidget runtime preview. */
export function FormulaDataPreview({ result }) {
  if (!result) return null;
  const context = result.contextLabel || 'Current Widget context';
  if (result.status !== 'ready') {
    return (
      <section className={`fxd-data fxd-data--${result.status || 'empty'}`} aria-label="Live data preview"
        aria-live="polite" aria-busy={result.status === 'loading' || undefined}>
        <div className="fxd-data-head"><b>Live data preview</b><span>{context}</span></div>
        <p>{result.message || 'No preview is available.'}</p>
      </section>
    );
  }
  if (result.shape === 'series') {
    const points = Array.isArray(result.points) ? result.points : [];
    const finite = points.filter((point) => point.value != null);
    const recent = finite.slice(-3);
    const plot = sparklineSegments(points);
    return (
      <section className="fxd-data" aria-label="Live data preview" aria-live="polite">
        <div className="fxd-data-head"><b>{result.label || 'Live data preview'}</b><span>{context}</span></div>
        <svg className="fxd-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img"
          aria-label={`${plot.finiteCount} evaluated points`}>
          {plot.segments.map((segment) => {
            const path = segment.points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
            const only = segment.points.length === 1 ? segment.points[0] : null;
            return (
              <g key={segment.run}>
                <polyline points={path} fill="none" vectorEffect="non-scaling-stroke" />
                {only ? <circle cx={only.x} cy={only.y} r="1.5" vectorEffect="non-scaling-stroke" /> : null}
              </g>
            );
          })}
        </svg>
        <div className="fxd-data-values">
          {recent.map((point, index) => <span key={`${point.label}:${index}`}><small>{point.label}</small><b>{point.formatted}</b></span>)}
        </div>
        <p>{`${finite.length} of ${points.length} points have values.`}</p>
      </section>
    );
  }
  if (result.shape === 'rows') {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    return (
      <section className="fxd-data" aria-label="Live data preview" aria-live="polite">
        <div className="fxd-data-head"><b>{result.label || 'Live data preview'}</b><span>{context}</span></div>
        <div className="fxd-data-rows">
          {rows.slice(0, 5).map((row, index) => <span key={`${row.label}:${index}`}><small>{row.label}</small><b>{row.formatted}</b></span>)}
          {result.total ? <span className="fxd-data-total"><small>Total</small><b>{result.total.formatted}</b></span> : null}
        </div>
        <p>{rows.length > 5 ? `${rows.length} rows · first 5 shown.` : `${rows.length} row${rows.length === 1 ? '' : 's'}.`}
          {result.displayNote ? ` ${result.displayNote}` : ''}</p>
      </section>
    );
  }
  return (
    <section className="fxd-data" aria-label="Live data preview" aria-live="polite">
      <div className="fxd-data-head"><b>{result.label || 'Live data preview'}</b><span>{context}</span></div>
      <strong className="fxd-data-scalar">{result.formatted}</strong>
      {result.secondaryFormatted ? <span className="fxd-data-secondary">{result.secondaryFormatted}</span> : null}
      {result.warned ? <p>Some missing inputs were read as zero by the report engine.</p> : null}
    </section>
  );
}

export function FormulaEditorContent({
  value = '', label = 'Formula', contextKind = 'agg', fieldSet = new Set(), fieldLabels,
  sample, previewFormula, allowEmpty = false, unitFamily, unitFamilies = UNIT_FAMILIES,
  applyLabel = 'Apply', cancelLabel = 'Cancel', onApply, onCancel, onDraftState,
  inputRef: externalInputRef = null, requireValue = false, availableMetrics,
  // The slot's CM360 join and its sentence (§2.5), and the PACING's own sentence. All three
  // arrive on `formulaScopeFor`'s scope object, which every card already spreads into the
  // slot it hands down — so a new slot cannot forget them without also forgetting its field
  // set, which it would notice immediately.
  // …and `cmOnly`, the fourth: the inline field forwards it, and the spacious editor must
  // answer the same text the same way or its Apply would hand back an expression the field
  // beneath it refuses.
  cm = null, cmRefusal = NO_CM_JOIN, cmOnly = false, cmUnavailable = null,
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [family, setFamily] = useState(unitFamily);
  const [query, setQuery] = useState('');
  const [help, setHelp] = useState('Choose a field or function to insert it at the cursor.');
  const [previewResult, setPreviewResult] = useState(null);
  const ownInputRef = useRef(null);
  const inputRef = externalInputRef || ownInputRef;
  const formulaId = useId();
  const feedbackId = `${formulaId}-feedback`;
  const draftStateRef = useRef(onDraftState);
  draftStateRef.current = onDraftState;

  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => { setFamily(unitFamily); }, [unitFamily]);
  const check = useMemo(() => {
    if (!draft.trim()) return allowEmpty ? { ok: true } : { ok: false, error: 'Empty formula' };
    return validate(draft, contextKind, fieldSet, { cm, cmRefusal, cmOnly });
  }, [draft, contextKind, fieldSet, allowEmpty, cm, cmRefusal, cmOnly]);
  const previewKey = `${draft}\u0000${family ?? ''}`;
  useEffect(() => {
    draftStateRef.current?.(!check.ok);
    return () => draftStateRef.current?.(false);
  }, [check.ok]);

  const insertAtCaret = (token) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const pad = start > 0 && !/[\s(+\-*/,]$/.test(draft.slice(0, start)) ? ' ' : '';
    const next = draft.slice(0, start) + pad + token + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      const caret = start + pad.length + token.length;
      input.setSelectionRange(caret, caret);
    });
  };
  useEffect(() => {
    if (!previewFormula || !draft.trim()) { setPreviewResult(null); return undefined; }
    if (!check.ok) {
      setPreviewResult({ status: 'error', shape: 'scalar', message: 'Fix the formula to preview its data.' });
      return undefined;
    }
    // Model construction can walk a long date series or dimension table. Validation and
    // Apply still follow the current keystroke immediately; only this read waits for a
    // short pause, and the previous result is removed so it cannot describe newer text.
    setPreviewResult({ status: 'loading', shape: 'scalar', message: 'Updating preview…', _key: previewKey, _source: previewFormula });
    const timer = setTimeout(() => {
      try {
        const result = previewFormula(draft, family)
          || { status: 'empty', shape: 'scalar', message: 'No preview is available.' };
        setPreviewResult({ ...result, _key: previewKey, _source: previewFormula });
      } catch (error) {
        setPreviewResult({ status: 'error', shape: 'scalar', message: error instanceof Error ? error.message : String(error),
          _key: previewKey, _source: previewFormula });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [previewFormula, draft, family, check.ok, previewKey]);
  const visiblePreview = !previewFormula || !draft.trim() ? null
    : !check.ok ? { status: 'error', shape: 'scalar', message: 'Fix the formula to preview its data.' }
      : previewResult?._key === previewKey && previewResult?._source === previewFormula
        ? previewResult : { status: 'loading', shape: 'scalar', message: 'Updating preview…' };
  const sampleText = check.ok && sample ? sample(draft) : null;
  const lint = check.ok ? ratioLint(draft) : null;
  // §3.6: the expression parses and names a legal field, and this pacing's data still does not
  // carry it. Prop-driven like everything else here — the dialog reads no store.
  const availability = check.ok ? formulaAvailability(draft, availableMetrics) : null;
  const disabled = !check.ok || (requireValue && !draft.trim());
  const apply = () => { if (!disabled) onApply?.(draft, family); };

  return (
    <div className="fxd-content">
      <div className="fxd-workspace">
        <div className="fxd-compose">
          <label className="fxd-label" htmlFor={formulaId}>{label}</label>
          <textarea
            id={formulaId}
            ref={inputRef}
            className={`sp-inp fxd-input${!check.ok && draft.trim() ? ' wgf-inp--err' : ''}`}
            value={draft}
            aria-invalid={(!check.ok && !!draft.trim()) || undefined}
            aria-describedby={feedbackId}
            spellCheck={false}
            placeholder="e.g. sp / im * 1000"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !disabled) {
                event.preventDefault(); apply();
              }
            }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes(FORMULA_TOKEN_MIME)) event.preventDefault(); }}
            onDrop={(event) => {
              const token = event.dataTransfer.getData(FORMULA_TOKEN_MIME) || event.dataTransfer.getData('text/plain');
              if (!token) return;
              event.preventDefault(); insertAtCaret(token);
            }}
          />
          <div id={feedbackId} aria-live="polite">
            {!check.ok && draft.trim() ? <div className="wgf-err">{check.error}{check.hint ? <> — <b>{check.hint}</b></> : null}</div> : null}
            {!draft.trim() && !allowEmpty ? <div className="fxd-guidance">Enter a formula or insert a field below.</div> : null}
            {sampleText ? <div className="wgf-sample">{sampleText}</div> : null}
            {lint ? <div className="wgf-lint">{lint}</div> : null}
            {availability ? <div className="wgf-lint">{availability}</div> : null}
          </div>
          <FormulaDataPreview result={visiblePreview} />
          {unitFamily !== undefined ? (
            <label className="fxd-unit">
              <span>Unit</span>
              <select className="sp-inp sp-inp--sans" value={family}
                onChange={(event) => setFamily(event.target.value)}>
                {(unitFamilies.includes(family) ? unitFamilies : [family, ...unitFamilies]).map((item) => (
                  <option key={item} value={item}>{unitFamilies.includes(item) ? familyLabel(item) : `Stored unit: ${item}`}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="fxd-reference">
          <label className="fxd-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input className="sp-inp sp-inp--sans" value={query}
              aria-label="Search fields and functions"
              onChange={(event) => setQuery(event.target.value)} placeholder="Search fields and functions" />
          </label>
          <div className="fxd-palette-scroll">
            <FormulaPalette contextKind={contextKind} fieldSet={fieldSet} fieldLabels={fieldLabels}
              cm={cm} cmRefusal={cmRefusal} cmUnavailable={cmUnavailable}
              query={query} onHelp={setHelp} onInsert={insertAtCaret} />
          </div>
          <div className="fxd-help" aria-live="polite">{help}</div>
        </div>
      </div>
      <div className="fxd-actions">
        {onCancel ? <button type="button" className="sp-btn" onClick={onCancel}>{cancelLabel}</button> : null}
        <span className="fxd-shortcut">Ctrl/⌘ + Enter</span>
        <button type="button" className="sp-btn sp-btn-p" disabled={disabled} onClick={apply}>{applyLabel}</button>
      </div>
    </div>
  );
}

export function FormulaEditorDialogSurface({ label = 'Formula editor', onCancel, ...props }) {
  const uid = useId();
  const rootRef = useRef(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (openNativeSelect(event.target)) { event.stopPropagation(); return; }
      event.stopPropagation();
      cancelRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useInertBackground(true, [rootRef]);
  useOpenerRestore(true);
  useFocusOnOpen(boxRef, true, inputRef);
  useFocusTrap(boxRef, { active: true });
  return (
    <div ref={rootRef} className="fxd-scrim"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}>
      <section ref={boxRef} className="fxd-dialog" data-dp-modal="1" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
        <header className="fxd-head">
          <div><span>Formula</span><h3 id={`${uid}-title`}>{label}</h3></div>
          <button type="button" className="fxd-close" aria-label="Close formula editor" onClick={onCancel}>×</button>
        </header>
        <FormulaEditorContent {...props} label={label} inputRef={inputRef} onCancel={onCancel} />
      </section>
    </div>
  );
}

export default function FormulaEditorDialog({ open, ...props }) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<FormulaEditorDialogSurface {...props} />, document.body);
}
