// Compact formula field used by Widget inspectors. Quick edits stay in place;
// the shared editor dialog owns discovery, help and longer expressions.

import { useEffect, useId, useMemo, useState } from 'react';
import {
  FIELDS_DAILY, FIELDS_EXPECTED, FIELDS_RATES, FIELDS_PLAN, FIELDS_CM, NO_CM_JOIN,
} from '../widget-formula.js';
import { isCmBearing } from '../cm-formula-context.js';
import { TS_FIELDS, DIM_FIELDS_SET, DIM_DECLARED_FIELDS_SET } from '../widget-data.js';
import { FIELD_LABELS } from '../metric-catalog.js';
import { chipAt, withChipAt, rebase, legacyNameOf, tokensFromHolder } from '../chips/tokens.js';
import FormulaEditorDialog, {
  ratioLint, formulaAvailability, toHolder, holderPlacement, checkHolder, storedForm, draftSpelling, legacySpelling, judgeOn,
} from './FormulaEditorDialog.jsx';
import TokenField from './TokenField.jsx';
import ChipSettingsPanel from './ChipSettingsPanel.jsx';
import { usePacingCm360 } from './PacingCm360.jsx';
import { useDashboardStore } from '../store.js';

export { FIELD_LABELS, ratioLint, formulaAvailability };

export function fieldSetFor(contextKind, isDim, planEligible = false) {
  if (isDim) return planEligible ? DIM_DECLARED_FIELDS_SET : DIM_FIELDS_SET;
  return TS_FIELDS;
}

const fieldLabel = (name, labels) => Object.prototype.hasOwnProperty.call(labels || {}, name)
  ? labels[name] : FIELD_LABELS[name];
const extraFields = (allowed) => [...allowed].filter((name) => !TS_FIELDS.has(name));
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Controlled formula input.
 * onChange receives every inline edit, including invalid/empty text, as a holder in the
 * spelling its host stores. onCommit is valid-only, with the stored form. Opening and
 * cancelling the spacious editor does not replace the inline draft; Apply sends the valid
 * editor value through the same contract.
 */
export default function FormulaField({
  value, onCommit, onChange, contextKind, isDim = false, fieldSet: scopedFields, fieldLabels,
  label = 'Formula', sample, previewFormula, allowEmpty = false, onDraftState, onFieldPicked, startAdvanced = false,
  editorOpen, onEditorOpenChange, hideEditorTrigger = false, requireEditorValue = false,
  // The slot's CM360 join and sentence (§2.5), and the pacing's own sentence. They ride in on
  // the same scope object as `contextKind` and `fieldSet`. `cmOnly` is the fourth: this slot's
  // owner is cm-fed, so a plain delivery expression beside it describes another population and
  // the validator refuses it — the field asks the same question the Apply button asks, or the
  // two would disagree about the same text.
  cm = null, cmRefusal = NO_CM_JOIN, cmOnly = false, cmUnavailable: ownCmUnavailable,
  // The slot's grain type (`formulaScopeFor`'s `grain`), the slot itself (compile.js's words)
  // and its role: what the chips are judged on and which stored form a valid formula gets.
  grain = 'agg', slot = 'value', role = 'row',
}) {
  // The pacing's sentence. A card that computed it hands it in (null included: «this pacing
  // serves CM360»); a field handed nothing reads the builder's own answer, so a Layout block,
  // a mini-chart line and a highlight rule explain a CM360 field the way a column's palette
  // does. Outside the builder the context is null, which is what this field printed before.
  const pacingCm360 = usePacingCm360();
  const cmUnavailable = ownCmUnavailable === undefined ? pacingCm360 : ownCmUnavailable;
  // The draft is the holder the field holds, compared by its bytes: a host handing an equal
  // object each render, or echoing the spelling this field just handed it, does not reset it.
  const valueHolder = toHolder(value);
  const valueKey = JSON.stringify(valueHolder);
  const [draft, setDraft] = useState(valueHolder);
  const [localEditorOpen, setLocalEditorOpen] = useState(false);
  // The chip whose settings panel is open: the field's token index and the chip button.
  const [panel, setPanel] = useState(null);
  // A word is being typed: the field is in progress, so the red ring and the refusal line wait
  // for the word to land (space, operator, Enter, blur); the suggestions are the feedback until
  // then. The host still learns the draft is invalid (onDraftState), so Save stays off.
  const [typing, setTyping] = useState(false);
  const availableMetrics = useDashboardStore((s) => s.availableMetrics);
  const dialogOpen = editorOpen ?? localEditorOpen;
  const formulaLabel = /formula/i.test(label) ? label : `${label} formula`;
  const fieldId = useId();
  const fieldSet = scopedFields || fieldSetFor(contextKind, isDim);
  const scope = useMemo(() => ({ grain, cm, cmRefusal, fieldSet }), [grain, cm, cmRefusal, fieldSet]);
  const placementFor = (holder) => holderPlacement(scope, holder, role);
  const rules = { contextKind, fieldSet, cm, cmRefusal, cmOnly, allowEmpty, slot };
  // The one field a holder is: a bare legacy identifier the simple picker can show, as text or
  // as the one chip that spells it on this placement. A bare CM360 identifier is a PICK, not an
  // expression (§2.10): it belongs in the simple picker beside the delivery metrics.
  const bareName = (holder, placement) => {
    let name;
    if (holder.chips) {
      const tokens = tokensFromHolder(holder, placement);
      if (tokens.length !== 1 || tokens[0].t !== 'chip') return null;
      name = legacyNameOf(tokens[0].chip, placement);
    } else name = (holder.expr || '').trim();
    if (!name || !ID_RE.test(name)) return null;
    return fieldSet.has(name) || (!!cm && FIELDS_CM.has(name)) ? name : null;
  };
  const isBare = (holder) => bareName(holder, placementFor(holder)) != null;
  const [advanced, setAdvanced] = useState(() => (
    startAdvanced || (!!valueHolder.expr.trim() && !isBare(valueHolder))
  ));

  useEffect(() => { setDraft((current) => (JSON.stringify(current) === valueKey ? current : toHolder(value))); }, [valueKey]);

  const placement = useMemo(() => placementFor(draft), [scope, draft, role]);
  const env = useMemo(() => ({ fieldSet, cm, cmRefusal, cmUnavailable, contextKind, judge: (chip) => judgeOn(chip, placement, slot) }),
    [fieldSet, cm, cmRefusal, cmUnavailable, contextKind, placement, slot]);
  const check = useMemo(() => checkHolder(draft, placement, rules),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, placement, contextKind, fieldSet, cm, cmRefusal, cmOnly, allowEmpty, slot]);
  const written = useMemo(() => (check.ok && draft.expr.trim() ? storedForm(draft, placement, slot) : null), [check.ok, draft, placement, slot]);
  const refusal = written && written.form === 'refused' ? written : null;
  const legacy = legacySpelling(draft, placement);
  const bad = !check.ok || !!refusal;

  // A scope/axis change can make a standing draft valid. Commit it at that point
  // so the visible green expression and saved expression cannot disagree.
  useEffect(() => {
    if (!draft.expr.trim()) return;
    const p = placementFor(draft);
    if (!checkHolder(draft, p, rules).ok) return;
    const w = storedForm(draft, p, slot);
    if (w.form === 'refused') return;
    // Compared through the same write on both sides: a stored holder that spells its defaults
    // out is the same formula as its clean form, not a change to commit on mount.
    const have = storedForm(valueHolder, placementFor(valueHolder), slot);
    if (have.form !== 'refused' && JSON.stringify(w.holder) === JSON.stringify(have.holder)) return;
    onCommit?.(w.holder);
    // The JOIN belongs in this list for the reason the field set does: moving a table from
    // line-item rows to date rows makes a standing `cmIm / im` draft legal, and the visible
    // green expression and the saved one must not disagree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKind, isDim, fieldSet, cm]);

  useEffect(() => {
    onDraftState?.(fieldId, bad);
    return () => onDraftState?.(fieldId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bad]);

  const apply = (next) => {
    setDraft(next);
    const p = placementFor(next);
    const ok = checkHolder(next, p, rules).ok;
    onChange?.(draftSpelling(next, p, slot, ok));
    if (allowEmpty && !next.expr.trim()) { onCommit?.({ expr: '' }); return; }
    if (!ok) return;
    const w = storedForm(next, p, slot);
    if (w.form !== 'refused') onCommit?.(w.holder);
  };
  const setEditorVisible = (next) => {
    if (editorOpen === undefined) setLocalEditorOpen(next);
    onEditorOpenChange?.(next);
  };
  const openEditor = () => setEditorVisible(true);
  const applyDialog = (next) => {
    apply(next);
    setAdvanced(startAdvanced || !isBare(next));
    setEditorVisible(false);
  };
  const panelChip = panel ? chipAt(draft, panel.index, placement) : null;
  // The sample, the ratio lint and the inventory sentence read the legacy spelling where the
  // chips have one: a chip formula is still the raw math the lint warns about, and still names
  // the fields the inventory may lack.
  const sampleText = check.ok && sample ? sample(legacy ?? draft.expr) : null;
  const lint = check.ok ? ratioLint(legacy ?? draft) : null;
  // §3.6: the formula is legal and this pacing's data does not carry one of the fields it
  // names. Rendered below, OUTSIDE the simple/advanced ternary — the bare metric a reader
  // picks from the `<select>` needs the sentence exactly as much as a typed expression does.
  const availability = check.ok ? formulaAvailability(legacy ?? draft, availableMetrics) : null;
  const groups = [
    ['Delivery', [...FIELDS_DAILY]], ['Expected', [...FIELDS_EXPECTED]],
    ['Rates', [...FIELDS_RATES]], ['Plan', [...FIELDS_PLAN]],
    ['Source fields', extraFields(fieldSet)],
    // Only where the slot HAS a join. A `<select>` is a list of things you can choose, and a
    // group that is dead on every delivery grain is noise rather than discovery; the full
    // editor's palette lists them always, with the reason, because that surface can print a
    // sentence and this one cannot.
    ...(cm ? [['CM360', [...FIELDS_CM]]] : []),
  ];

  return (
    <div className="wgf-field">
      {!advanced ? (
        <div className="wgf-row wgf-row--tight">
          <select
            className="sp-inp sp-inp--sans wgf-pick"
            aria-label={label}
            value={bareName(draft, placement) || ''}
            onChange={(event) => {
              // The simple mode keeps the native picker and writes the bare name (decision i).
              const next = event.target.value;
              const holder = { expr: next };
              setDraft(holder); onChange?.(holder);
              if (next || allowEmpty) onCommit?.(holder);
              if (next) onFieldPicked?.(next);
            }}
          >
            <option value="">{allowEmpty ? '— none' : '— pick a metric'}</option>
            {groups.map(([group, names]) => {
              // The CM360 three are in no field set by construction (§2.1), so the ordinary
              // gate would drop the group it was just asked to show.
              const list = group === 'CM360' ? names : names.filter((name) => fieldSet.has(name));
              return list.length ? (
                <optgroup key={group} label={group} disabled={group === 'CM360' && !!cmUnavailable}>
                  {list.map((name) => <option key={name} value={name}>{fieldLabel(name, fieldLabels) || name}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
          {!hideEditorTrigger ? (
            <button type="button" className="wgf-adv" onClick={openEditor} aria-label={`Edit ${formulaLabel}`}>
              ƒx formula
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="wgf-row wgf-row--tight wgf-row--stretch">
            <TokenField value={draft} placement={placement} env={env} label={label} onChange={apply}
              onDraft={({ word }) => setTyping(!!word)}
              invalidRefs={check.refs || null} refusedRef={refusal ? refusal.ref : null}
              ariaInvalid={bad && !!draft.expr.trim() && !typing}
              onOpenChip={(index, el) => setPanel({ index, el })} />
            {!hideEditorTrigger ? (
              <button type="button" className="wgf-adv" onClick={openEditor} aria-label={`Open ${formulaLabel} editor`}>
                ƒx edit
              </button>
            ) : null}
            {isBare(draft) && !hideEditorTrigger ? (
              <button type="button" className="wgf-adv" onClick={() => setAdvanced(false)}>
                ↩ simple
              </button>
            ) : null}
          </div>
          {panel && panelChip ? (
            <ChipSettingsPanel open chip={panelChip} placement={placement} slot={slot} anchorEl={panel.el} judge={env.judge}
              onChange={(chip) => apply(withChipAt(draft, panel.index, chip, placement))}
              onReplace={(base) => apply(withChipAt(draft, panel.index, rebase(panelChip, base), placement))}
              onClose={() => setPanel(null)} />
          ) : null}
          {!check.ok && draft.expr.trim() && !typing ? (
            <div className="wgf-err">{check.error}{check.hint ? <> — <b>{check.hint}</b></> : null}</div>
          ) : null}
          {refusal && !typing ? <div className="wgf-err">{refusal.message}</div> : null}
          {lint ? <div className="wgf-lint">{lint}</div> : null}
        </>
      )}
      {availability ? <div className="wgf-lint">{availability}</div> : null}
      {/* The PACING's sentence, and only once the draft actually names CM360: a slot that
          joins is almost every slot, so printing it unconditionally would put «this pacing
          has no CM360» under every formula field on the dashboard. It renders in the same
          `.wgf-lint` column as the ratio lint and the inventory sentence, so it stacks where
          those already do and moves nothing above it. */}
      {cmUnavailable && isCmBearing(draft) ? <div className="wgf-lint">{cmUnavailable}</div> : null}
      {sampleText ? <div className="wgf-sample">{sampleText}</div> : null}
      <FormulaEditorDialog
        open={dialogOpen}
        value={draftSpelling(draft, placement, slot, check.ok)}
        label={label}
        contextKind={contextKind}
        fieldSet={fieldSet}
        fieldLabels={fieldLabels}
        cm={cm}
        cmRefusal={cmRefusal}
        cmOnly={cmOnly}
        cmUnavailable={cmUnavailable}
        grain={grain}
        slot={slot}
        role={role}
        sample={sample}
        previewFormula={previewFormula}
        allowEmpty={allowEmpty}
        requireValue={requireEditorValue}
        availableMetrics={availableMetrics}
        onApply={applyDialog}
        onCancel={() => setEditorVisible(false)}
      />
    </div>
  );
}
