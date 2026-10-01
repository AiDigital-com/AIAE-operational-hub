// Compact formula field used by Widget inspectors. Quick edits stay in place;
// the shared editor dialog owns discovery, help and longer expressions.

import { useEffect, useId, useMemo, useState } from 'react';
import {
  validate, FIELDS_DAILY, FIELDS_EXPECTED, FIELDS_RATES, FIELDS_PLAN, FIELDS_CM, NO_CM_JOIN,
} from '../widget-formula.js';
import { isCmBearing } from '../cm-formula-context.js';
import { TS_FIELDS, DIM_FIELDS_SET, DIM_DECLARED_FIELDS_SET } from '../widget-data.js';
import { FIELD_LABELS } from '../metric-catalog.js';
import FormulaEditorDialog, { ratioLint, formulaAvailability } from './FormulaEditorDialog.jsx';
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

/**
 * Controlled formula input.
 * onChange receives every inline edit, including invalid/empty text. onCommit is
 * valid-only. Opening and cancelling the spacious editor does not replace the
 * inline draft; Apply sends the valid editor value through the same contract.
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
}) {
  // The pacing's sentence. A card that computed it hands it in (null included: «this pacing
  // serves CM360»); a field handed nothing reads the builder's own answer, so a Layout block,
  // a mini-chart line and a highlight rule explain a CM360 field the way a column's palette
  // does. Outside the builder the context is null, which is what this field printed before.
  const pacingCm360 = usePacingCm360();
  const cmUnavailable = ownCmUnavailable === undefined ? pacingCm360 : ownCmUnavailable;
  const [draft, setDraft] = useState(value ?? '');
  const [localEditorOpen, setLocalEditorOpen] = useState(false);
  const availableMetrics = useDashboardStore((s) => s.availableMetrics);
  const dialogOpen = editorOpen ?? localEditorOpen;
  const formulaLabel = /formula/i.test(label) ? label : `${label} formula`;
  const fieldId = useId();
  const fieldSet = scopedFields || fieldSetFor(contextKind, isDim);
  const isBare = (src) => {
    const name = (src || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
    // A bare CM360 identifier is a PICK, not an expression (§2.10): it belongs in the simple
    // picker beside the delivery metrics. Without this the field would open in advanced mode
    // for `cmIm` and offer a «↩ simple» button that could not put it back.
    return fieldSet.has(name) || (!!cm && FIELDS_CM.has(name));
  };
  const [advanced, setAdvanced] = useState(() => (
    startAdvanced || (!!(value ?? '').trim() && !isBare(value))
  ));

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const check = useMemo(() => {
    if (!draft.trim()) return allowEmpty ? { ok: true } : { ok: false, error: 'Empty formula' };
    return validate(draft, contextKind, fieldSet, { cm, cmRefusal, cmOnly });
  }, [draft, contextKind, fieldSet, allowEmpty, cm, cmRefusal, cmOnly]);

  // A scope/axis change can make a standing draft valid. Commit it at that point
  // so the visible green expression and saved expression cannot disagree.
  useEffect(() => {
    const next = draft.trim();
    if (next && next !== (value ?? '').trim() && validate(next, contextKind, fieldSet, { cm, cmRefusal, cmOnly }).ok) {
      onCommit?.(draft);
    }
    // The JOIN belongs in this list for the reason the field set does: moving a table from
    // line-item rows to date rows makes a standing `cmIm / im` draft legal, and the visible
    // green expression and the saved one must not disagree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKind, isDim, fieldSet, cm]);

  useEffect(() => {
    onDraftState?.(fieldId, !check.ok);
    return () => onDraftState?.(fieldId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.ok]);

  const apply = (next) => {
    setDraft(next);
    onChange?.(next);
    if (allowEmpty && !next.trim()) { onCommit?.(''); return; }
    if (validate(next, contextKind, fieldSet, { cm, cmRefusal, cmOnly }).ok) onCommit?.(next);
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
  const sampleText = check.ok && sample ? sample(draft) : null;
  const lint = check.ok ? ratioLint(draft) : null;
  // §3.6: the formula is legal and this pacing's data does not carry one of the fields it
  // names. Rendered below, OUTSIDE the simple/advanced ternary — the bare metric a reader
  // picks from the `<select>` needs the sentence exactly as much as a typed expression does.
  const availability = check.ok ? formulaAvailability(draft, availableMetrics) : null;
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
            value={isBare(draft) ? draft.trim() : ''}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next); onChange?.(next);
              if (next || allowEmpty) onCommit?.(next);
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
            <input
              aria-label={label}
              className={`sp-inp wgf-inp${!check.ok && draft.trim() ? ' wgf-inp--err' : ''}`}
              style={{ flex: 1 }}
              value={draft}
              spellCheck={false}
              placeholder="e.g. sp / im * 1000"
              onChange={(event) => apply(event.target.value)}
            />
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
          {!check.ok && draft.trim() ? (
            <div className="wgf-err">{check.error}{check.hint ? <> — <b>{check.hint}</b></> : null}</div>
          ) : null}
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
        value={draft}
        label={label}
        contextKind={contextKind}
        fieldSet={fieldSet}
        fieldLabels={fieldLabels}
        cm={cm}
        cmRefusal={cmRefusal}
        cmOnly={cmOnly}
        cmUnavailable={cmUnavailable}
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
