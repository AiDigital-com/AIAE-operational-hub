import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  openCombobox, openNativeSelect, useFocusOnOpen, useFocusTrap, useInertBackground, useOpenerRestore,
} from '../PopupCoordinator.jsx';
import {
  validate, dateAxisRefusal, FIELDS_DAILY, FIELDS_EXPECTED, FIELDS_RATES, FIELDS_PLAN,
  FIELDS_CM, FUNCTIONS, NO_CM_JOIN, CM_FORMULA_ONLY, CM_BQ_ONLY,
} from '../widget-formula.js';
// Formula chips P0: a holder is legacy text or `{expr, chips}`; both lints ask the one reader.
import { holderInfo, isChipHolder, chipFace } from '../chips/info.js';
// Formula chips P1-editor: the field IS the chips. The content holds a holder, shows it in a
// TokenField, judges it with the client rules and writes the form the slot stores (decision h).
import {
  chipAt, withChipAt, rebase, unitOf, tokensFromHolder, resolvedTokens, namesCm, holderFromTokens, legacyTextOf, legacyNameOf, cleanChip,
} from '../chips/tokens.js';
import { compileClient, writerForm, judgeChip, SLOT_SERVED } from '../chips/compile.js';
import { chipNotYet } from '../chips/resolve.js';
import { chipPlacement } from '../report-draft.js';
import { isCmBearing } from '../cm-formula-context.js';
import TokenField from './TokenField.jsx';
import ChipSettingsPanel from './ChipSettingsPanel.jsx';
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
  and: 'Both conditions hold.', or: 'Either condition holds.',
};
const FUNCTION_INSERT = {
  cumsum: 'cumsum(x)', rolling: 'rolling(x, 7)', shift: 'shift(x, 1)',
  min: 'min(a, b)', max: 'max(a, b)', abs: 'abs(x)', round: 'round(x, 2)',
  if: 'if(im > 0, a, b)',
  and: 'and(a > 0, b > 0)', or: 'or(a > 0, b > 0)',
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
  // A chip names its rule in its settings, so the raw-math warning has nothing to warn about.
  if (isChipHolder(src)) return null;
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
  for (const k of holderInfo(src).identifiers) {
    const why = metricAvailability(k, inventory, FIELD_LABELS[k]);
    if (why) return why;
  }
  return null;
}

/* ── the holder a field edits, and the rules both the inline field and this content ask ─────
   One residence for the two surfaces (spec §6.1), so a formula the field admits is one the
   dialog admits, and the form each writes is the same. */

/** The holder a field edits: a string is `{ expr }`; a stored value's `kind` and `unitFamily`
 *  are the host's, not the field's. */
export function toHolder(value) {
  if (typeof value === 'string') return { expr: value };
  if (!value || typeof value !== 'object') return { expr: '' };
  const expr = typeof value.expr === 'string' ? value.expr : '';
  return value.chips && typeof value.chips === 'object' ? { expr, chips: value.chips } : { expr };
}

/** `toHolder`'s write twin: the stored `{ kind: 'formula' }` value a host writes from the holder
 *  the editor handed it (a plain string is read as text) and the family, in the stored key order
 *  `kind, expr, unitFamily, chips` (spec §3: the bytes are compared); a text holder carries no
 *  map, so a value without chips keeps its bytes. One residence for the three cards. */
export function formulaValue(stored, family) {
  const holder = typeof stored === 'string' ? { expr: stored } : stored;
  return { kind: 'formula', expr: holder.expr, unitFamily: family, ...(holder.chips ? { chips: holder.chips } : {}) };
}

/** The holder a field's draft READS as on its placement. The field hands its draft with the
 *  word still being typed riding as a word token (spec §6.3); read back through the tokens, a
 *  bare legacy word is the chip it commits to (`sp / cl` typed by keystrokes is Spend / Clicks
 *  before the space lands) and a word nobody knows stays a word, so the gate judges and writes
 *  what the field shows, on every keystroke (§6.2). A CM360 name arriving among plain delivery
 *  chips re-reads them as the matched half (resolvedTokens), as the typed text would be read.
 *  A text holder is read by the validator. */
export function resolvedHolder(holder, placement) {
  return holder.chips ? holderFromTokens(resolvedTokens(holder, placement)) : holder;
}

/** The placement a field judges and writes its holder on: the slot's grain, join and field set
 *  (`chipPlacement`, the draft gate's own residence) with `cm` the TEXT rule, which a text
 *  holder answers from its own words (`cmIm / im` reads `im` as the matched half) and a chip
 *  holder from its chips AND the word still being typed (`cmIm` pending beside `im` already
 *  reads CM360, so the suggestions and the gate see the same formula the commit will). */
export function holderPlacement(scope, holder, role = 'row') {
  const base = chipPlacement(scope, holder);
  const cm = base.cm || (holder.chips ? namesCm(tokensFromHolder(holder, base)) : isCmBearing(holder.expr));
  return { ...base, cm, role };
}

/** The legacy spelling of a holder on its placement: the text itself, or null when a chip has none. */
export const legacySpelling = (holder, placement) => (holder.chips ? legacyTextOf(resolvedTokens(holder, placement), placement) : holder.expr);

/** The validator names a field by its legacy spelling; the field shows chips. A refusal that
 *  quotes a name the holder spells as a chip on this placement names the chip's face instead
 *  (`Unexpected "Spend" after the end of the formula`, not `"sp"`) and carries that chip's ref,
 *  so the field outlines it. A hint keeps its identifiers: they are what a person types. */
function nameChips(v, holder, placement) {
  if (v.ok || typeof v.error !== 'string' || !v.error.includes('"')) return v;
  const read = holderFromTokens(resolvedTokens(holder, placement));
  if (!read.chips) return v;
  let error = v.error;
  const refs = new Set();
  for (const [ref, chip] of Object.entries(read.chips)) {
    const name = legacyNameOf(chip, placement);
    if (!name || !error.includes(`"${name}"`)) continue;
    error = error.split(`"${name}"`).join(`"${chipFace(chip)}"`);
    refs.add(ref);
  }
  return refs.size ? { ...v, error, refs } : v;
}

/** checkHolder(holder, placement, rules) → `{ ok }` | `{ ok: false, error, hint?, refs? }`.
 *  A text holder is the validator's. A chip holder is judged on its legacy spelling FIRST where
 *  it has one (the validator carries what the client rules do not: the slot's field set, the
 *  cm-fed owner's rule, «did you mean»), then on the client rules the server cannot know
 *  (`compileClient`), whose errors name the chip (`refs`) so the field outlines it. Either
 *  way a refusal names a chip by its face (`nameChips`). */
export function checkHolder(holder, placement, { contextKind, fieldSet, cm, cmRefusal, cmOnly, allowEmpty, slot }) {
  if (!holder.expr.trim()) return allowEmpty ? { ok: true } : { ok: false, error: 'Empty formula' };
  if (!holder.chips) return nameChips(validate(holder.expr, contextKind, fieldSet, { cm, cmRefusal, cmOnly }), holder, placement);
  const read = resolvedHolder(holder, placement);
  const legacy = legacySpelling(read, placement);
  if (legacy != null) {
    const v = validate(legacy, contextKind, fieldSet, { cm, cmRefusal, cmOnly });
    if (!v.ok) return nameChips(v, read, placement);
  } else if (cmOnly && !placement.cm) {
    // The cm-fed owner's rule has two doors, and the validator's is the legacy spelling: a chip
    // holder without one is judged here with the same sentences (a plain delivery chip beside a
    // cm-fed owner describes another population; with no join the BQ context cannot answer).
    return { ok: false, error: cm ? CM_FORMULA_ONLY : CM_BQ_ONLY };
  }
  const c = compileClient(read, placement, slot);
  if (c.ok) return { ok: true };
  return { ok: false, error: c.errors[0].message, refs: new Set(c.errors.map((e) => e.ref).filter(Boolean)) };
}

/** storedForm(holder, placement, slot) → `{ form: 'chips' | 'text', holder }` | `{ form: 'refused', ref, message }`:
 *  the form the slot stores (decision h, `writerForm`) for the holder the draft reads as, with
 *  the writer following the ENGINE one step further: a chip the engine does not read yet on a
 *  served slot is stored as the legacy text where every chip has one, and refused with the
 *  engine's own sentence where it has not, so no tile goes dark on what the editor wrote. */
export function storedForm(holder, placement, slot) {
  const read = resolvedHolder(holder, placement);
  const w = writerForm(read, placement, slot);
  if (w.form !== 'chips') return w;
  const ref = Object.keys(read.chips).find((r) => chipNotYet(read.chips[r]));
  if (!ref) return w;
  const text = legacySpelling(read, placement);
  return text != null ? { form: 'text', holder: { expr: text } } : { form: 'refused', ref, message: chipNotYet(read.chips[ref]) };
}

/** judgeOn(chip, placement, slot) → the sentence a suggestion or a settings option is dimmed with
 *  on this slot, or null: `judgeChip`'s answer, except that on a served slot the engine's own
 *  «not yet» is lifted where the chip has a legacy spelling, since `storedForm` stores such a
 *  holder as that text. A dimmed entry is one the field refuses a keystroke later (§6.3). */
export function judgeOn(chip, placement, slot) {
  const clean = cleanChip(chip);
  const why = judgeChip(clean, placement, slot);
  if (why && why === chipNotYet(clean) && SLOT_SERVED(slot, placement.grain) && !placement.cm && legacyNameOf(clean, placement)) return null;
  return why;
}

/** The spelling a host is handed for a draft (`onChange`): the stored form while the draft is
 *  valid and storable, the legacy text while it is not (every chip has a name), the chip holder
 *  the draft reads as when one has none. The host's own gate then judges exactly what it holds. */
export function draftSpelling(holder, placement, slot, ok) {
  if (!holder.expr.trim()) return { expr: '' };
  const read = resolvedHolder(holder, placement);
  if (ok) {
    const w = storedForm(read, placement, slot);
    return w.form === 'refused' ? read : w.holder;
  }
  const legacy = legacySpelling(read, placement);
  return legacy == null ? read : { expr: legacy };
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
  // The slot's grain type, the slot itself (compile.js's words) and its role: what the chips
  // are judged on and which stored form a valid formula gets (decision h).
  grain = 'agg', slot = 'value', role = 'row',
}) {
  // `value` is a holder or a string; the draft is the holder the field holds, compared by its
  // bytes so a host handing an equal object each render does not reset it.
  const valueHolder = toHolder(value);
  const valueKey = JSON.stringify(valueHolder);
  const [draft, setDraft] = useState(valueHolder);
  const [family, setFamily] = useState(unitFamily);
  const [query, setQuery] = useState('');
  const [help, setHelp] = useState('Choose a field or function to insert it at the cursor.');
  const [previewResult, setPreviewResult] = useState(null);
  // The chip whose settings panel is open: the field's token index and the chip button.
  const [panel, setPanel] = useState(null);
  // A word is being typed: the ring and the refusal lines wait for it to land; the suggestions
  // are the feedback until then (the preview and Apply still follow the draft's own state).
  const [typing, setTyping] = useState(false);
  // The FIRST ref: the hidden input the dialog focuses on open (`refs()[0]` in the host suites).
  const ownInputRef = useRef(null);
  const inputRef = externalInputRef || ownInputRef;
  const formulaId = useId();
  const feedbackId = `${formulaId}-feedback`;
  const draftStateRef = useRef(onDraftState);
  draftStateRef.current = onDraftState;
  // The field's handle for the palette and drag-drop: `{ paste(text), focus() }`.
  const actionsRef = useRef(null);
  // Decision l: a unit family the chips agree on is proposed for a NEW formula until the
  // author picks one; a stored formula keeps the family its author stored.
  const fresh = useRef(!valueHolder.expr.trim());
  const touched = useRef(false);

  useEffect(() => { setDraft((current) => (JSON.stringify(current) === valueKey ? current : toHolder(value))); }, [valueKey]);
  useEffect(() => { setFamily(unitFamily); }, [unitFamily]);
  const scope = useMemo(() => ({ grain, cm, cmRefusal, fieldSet }), [grain, cm, cmRefusal, fieldSet]);
  const placement = useMemo(() => holderPlacement(scope, draft, role), [scope, draft, role]);
  const env = useMemo(() => ({ fieldSet, cm, cmRefusal, cmUnavailable, contextKind, judge: (chip) => judgeOn(chip, placement, slot) }),
    [fieldSet, cm, cmRefusal, cmUnavailable, contextKind, placement, slot]);
  const rules = { contextKind, fieldSet, cm, cmRefusal, cmOnly, allowEmpty, slot };
  const check = useMemo(() => checkHolder(draft, placement, rules),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, placement, contextKind, fieldSet, cm, cmRefusal, cmOnly, allowEmpty, slot]);
  const written = useMemo(() => (check.ok && draft.expr.trim() ? storedForm(draft, placement, slot) : null), [check.ok, draft, placement, slot]);
  const refusal = written && written.form === 'refused' ? written : null;
  // What Apply hands over, and what the preview reads: the holder the slot would store.
  const stored = written && !refusal ? written.holder : null;
  const legacy = legacySpelling(draft, placement);
  const previewKey = `${JSON.stringify(stored)}\u0000${family ?? ''}`;
  useEffect(() => {
    draftStateRef.current?.(!check.ok || !!refusal);
    return () => draftStateRef.current?.(false);
  }, [check.ok, !!refusal]);
  const proposed = useMemo(() => unitOf(draft, placement), [draft, placement]);
  useEffect(() => {
    if (unitFamily === undefined || !proposed || !fresh.current || touched.current) return;
    setFamily(proposed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed]);

  // A palette click or a drop: the token lands at the field's caret through the real parser
  // (decision m); focus goes to the hidden input first, so the field keeps it across the step.
  const insert = (token) => {
    actionsRef.current?.focus();
    actionsRef.current?.paste(token);
  };
  const onFieldChange = (holder) => { setDraft(holder); };
  const panelChip = panel ? chipAt(draft, panel.index, placement) : null;
  useEffect(() => {
    if (!previewFormula || !draft.expr.trim()) { setPreviewResult(null); return undefined; }
    if (!check.ok || !stored) {
      setPreviewResult({ status: 'error', shape: 'scalar', message: refusal ? refusal.message : 'Fix the formula to preview its data.' });
      return undefined;
    }
    // Model construction can walk a long date series or dimension table. Validation and
    // Apply still follow the current keystroke immediately; only this read waits for a
    // short pause, and the previous result is removed so it cannot describe newer text.
    setPreviewResult({ status: 'loading', shape: 'scalar', message: 'Updating preview…', _key: previewKey, _source: previewFormula });
    const timer = setTimeout(() => {
      try {
        const result = previewFormula(stored, family)
          || { status: 'empty', shape: 'scalar', message: 'No preview is available.' };
        setPreviewResult({ ...result, _key: previewKey, _source: previewFormula });
      } catch (error) {
        setPreviewResult({ status: 'error', shape: 'scalar', message: error instanceof Error ? error.message : String(error),
          _key: previewKey, _source: previewFormula });
      }
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFormula, family, check.ok, previewKey]);
  const visiblePreview = !previewFormula || !draft.expr.trim() ? null
    : !check.ok || !stored ? { status: 'error', shape: 'scalar', message: refusal ? refusal.message : 'Fix the formula to preview its data.' }
      : previewResult?._key === previewKey && previewResult?._source === previewFormula
        ? previewResult : { status: 'loading', shape: 'scalar', message: 'Updating preview…' };
  // The sample, the ratio lint and the inventory sentence read the legacy spelling where the
  // chips have one: a chip formula is still the raw math the lint warns about, and still names
  // the fields the inventory may lack.
  const sampleText = check.ok && sample ? sample(legacy ?? draft.expr) : null;
  const lint = check.ok ? ratioLint(legacy ?? draft) : null;
  // §3.6: the expression parses and names a legal field, and this pacing's data still does not
  // carry it. Prop-driven like everything else here — the dialog reads no store.
  const availability = check.ok ? formulaAvailability(legacy ?? draft, availableMetrics) : null;
  const disabled = !check.ok || !!refusal || (requireValue && !draft.expr.trim());
  const apply = () => {
    if (disabled) return;
    // The word still being typed lands first (as a space would), so Apply stores the chip it
    // spells and not its letters; the holder after that step is judged and written here, since
    // the render that would show it has not happened yet. With no word pending, what is shown.
    const landed = actionsRef.current?.commit?.();
    if (!landed) { onApply?.(stored || { expr: '' }, family); return; }
    const p = holderPlacement(scope, landed, role);
    if (!checkHolder(landed, p, rules).ok) return;
    const w = storedForm(landed, p, slot);
    if (w.form !== 'refused') onApply?.(w.holder, family);
  };

  return (
    <div className="fxd-content">
      <div className="fxd-workspace">
        <div className="fxd-compose">
          <label className="fxd-label" htmlFor={formulaId}>{label}</label>
          <div
            className="fxd-field"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !disabled) {
                event.preventDefault(); apply();
              }
            }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes(FORMULA_TOKEN_MIME)) event.preventDefault(); }}
            onDrop={(event) => {
              // A drop on the hidden input itself is the field's own paste; this is the rest of the box.
              if (event.defaultPrevented) return;
              const token = event.dataTransfer.getData(FORMULA_TOKEN_MIME) || event.dataTransfer.getData('text/plain');
              if (!token) return;
              event.preventDefault(); insert(token);
            }}
          >
            <TokenField value={draft} placement={placement} env={env} label={label} onChange={onFieldChange}
              onDraft={({ word }) => setTyping(!!word)}
              invalidRefs={check.refs || null} refusedRef={refusal ? refusal.ref : null}
              ariaInvalid={(!check.ok || !!refusal) && !!draft.expr.trim() && !typing} ariaDescribedBy={feedbackId}
              inputRef={inputRef} inputId={formulaId} actions={actionsRef}
              onOpenChip={(index, el) => setPanel({ index, el })} />
          </div>
          {panel && panelChip ? (
            <ChipSettingsPanel open chip={panelChip} placement={placement} slot={slot} anchorEl={panel.el} judge={env.judge}
              onChange={(chip) => setDraft(withChipAt(draft, panel.index, chip, placement))}
              onReplace={(base) => setDraft(withChipAt(draft, panel.index, rebase(panelChip, base), placement))}
              onClose={() => setPanel(null)} />
          ) : null}
          <div id={feedbackId} aria-live="polite">
            {!check.ok && draft.expr.trim() && !typing ? <div className="wgf-err">{check.error}{check.hint ? <> — <b>{check.hint}</b></> : null}</div> : null}
            {refusal && !typing ? <div className="wgf-err">{refusal.message}</div> : null}
            {!draft.expr.trim() && !allowEmpty ? <div className="fxd-guidance">Enter a formula or insert a field below.</div> : null}
            {sampleText ? <div className="wgf-sample">{sampleText}</div> : null}
            {lint ? <div className="wgf-lint">{lint}</div> : null}
            {availability ? <div className="wgf-lint">{availability}</div> : null}
          </div>
          <FormulaDataPreview result={visiblePreview} />
          {unitFamily !== undefined ? (
            <label className="fxd-unit">
              <span>Unit</span>
              <select className="sp-inp sp-inp--sans" value={family}
                onChange={(event) => { touched.current = true; setFamily(event.target.value); }}>
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
              query={query} onHelp={setHelp} onInsert={insert} />
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
      // An open suggestion list is the field's (its own handler dismisses it and stops the key);
      // an open native list keeps the key; an Escape aimed at a chip settings panel open inside
      // this dialog is that layer's (it is a popup, not a modal).
      if (openCombobox(event.target)) return;
      if (openNativeSelect(event.target)) { event.stopPropagation(); return; }
      if (event.target?.closest?.('[data-dp-popup="1"]')) return;
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
