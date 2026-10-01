// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/KpiPopover.jsx
//
// A KPI's settings (widget-builder v2 §5.3, mockup §2): the panel the value chip opens.
// The chip is the thing, this is its settings — §1.1.5's one mental primitive, and the chip
// stays legible without it (§3: popovers are for editing only).
//
// It is the whole VIEW's panel, not one slot's, because a KPI is one value: what it reads,
// where from, how it prints, whether it carries the Δ-vs-CM360 line, and what it is called. More holds basis
// and density. Its dependent target owns comparison direction and alert corridor.
// The footer removes
// the VIEW, because taking away the value would leave a KPI the grammar cannot store
// (`normKpiView` requires one).
//
// Two rules it shares with its two older twins:
//
//   · EVERY PICKER IS FILLED FROM THE GRAMMAR. The Value list is the catalog judged at the
//     `kpi` anchor — the same list the ƒx door's map shows — and the Format list is
//     `badCellFormat`'s own table minus `auto`, which §5.3 forbids here.
//   · A REFUSAL IS THE GRAMMAR'S OWN SENTENCE. The `Δ vs CM360` row does not know the rule:
//     it asks `validateReportDraft` what would happen if the line were switched on, and
//     prints what comes back — naming the dataset or the option, because the grammar names
//     them.
//
// WHAT «LABEL» IS. Table D gives a KPI no label of its own: the value carries none, and the
// VIEW has a `title` — which `ReportKpi` draws as the caption above the number and §6 hangs
// the ⇄ mark on. So the Label row writes that title, and the card's frame takes the name
// with it. (The mockup's own KPI panel has the same row, over a tile that falls back to the
// metric's name when it is empty; this tile prints no caption at all, so the placeholder
// says that rather than promising a fallback.)
import { SwitchAction } from './ContextualSwitch.jsx';
import { useId, useMemo, useState } from 'react';
import Popover from '../Popover.jsx';
import { LIMITS, KPI_BASES, KPI_DENSITIES } from '../report-v2.js';
import { entryOf } from '../metric-catalog.js';
import {
  datasetTypeOf, setDeltaVsOtherSource, setViewFormat, setViewTitle, setViewValue, setViewSettings,
} from '../report-draft.js';
import { refusalAt, viewAt } from './ask-grammar.js';
import { formatsFor, formatWord, pickViewValue } from './column-format.js';
import { valueName } from './view-text.js';
import { sourceEnv, spotlightItems } from '../spotlight-items.js';
import { PopRow, Seg } from './rows.jsx';
import ValueRow, { FollowsNote, SourceRow } from './ValueRow.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** No store under this panel: cm stays unpickable, which is what it was before the pacing's
 *  own facts reached the builder. */
const EMPTY_ENV = {};
/**
 * The support line's row, and ONE name for it (T13). T6 measured the tile's own phrase at
 * 60px against a shared 58px label column and shortened the ROW to «Δ vs CM» — which left
 * the panel calling it one thing while the card's chip and the tile called it another. The
 * label column is this window's to set, so it is 66px now and the phrase is the phrase.
 * The alternative was renaming the chip AND the tile, and the tile is P2's, rendering a
 * stored report on a dashboard where nothing about this task reaches.
 */
const DELTA_LABEL = 'Δ vs CM360';
/** What an empty title means here: the tile draws no caption at all. A placeholder naming
 *  the metric would promise a fallback this renderer does not have. */
const NO_TITLE = 'No label';

/**
 * KpiPopover — the settings of one KPI view.
 *
 *   widget       the whole draft widget; the Δ row judges a candidate against it
 *   view         the KPI itself
 *   anchorRef    the chip this panel hangs from
 *   valueRef     where focus lands on open (§3: the Value select)
 *   patch        the builder's ONE write path, `(mutate) => …`
 *   onPickValue  open the Spotlight on this KPI's value (the ƒx door)
 *   onPickTarget open the Spotlight on its target
 *   onRemove     remove this VIEW — the frame's own handle, so the confirm is the one the
 *                × already asks (a second confirm path would be a second answer)
 */
export default function KpiPopover({
  widget, view, anchorRef, valueRef, env = EMPTY_ENV, patch, onPickValue, onPickTarget, onEditTarget, onRemove, onClose, onMakeSwitchable, embedded = false,
}) {
  const [more, setMore] = useState(false);
  const spec = widget.spec;
  const value = view.value || null;
  const datasetType = datasetTypeOf(spec);
  const entry = entryOf(value, datasetType);
  const target = view.target || null;

  // The pacing's own half of a source verdict (spec 2026-08-25 §4), carried into BOTH the
  // map this panel shows and the Source row under it: two doors onto one slot, judged once.
  const srcEnv = useMemo(() => ({ ...sourceEnv(env), anchor: 'kpi' }), [env.sourceFacts, env.mappings, env.availableMetrics]);
  // The same list the ƒx door's map shows, judged in the same env — two doors onto one slot
  // that judged it twice would disagree about what may be picked.
  const items = useMemo(() => spotlightItems('kpi', {
    ...srcEnv,
    datasetType,
    hasMetricControl: arr(spec.controls).some((c) => c && c.type === 'metric'),
    // A KPI is one number over the WINDOW, not per row: there is no grain to compute it on.
    grain: null,
  }), [datasetType, spec.controls]);

  /** A value change carries the format rule with it (§1.1.4) — see `column-format.js`. */
  const setValue = (next, from) => patch((s) => pickViewValue(s, view.id, next, from));

  const content = (
    <>
      <ValueRow
        spec={spec} items={items} value={value} valueRef={valueRef} env={srcEnv}
        onFormula={onPickValue} onPick={setValue}
      />

      {onMakeSwitchable ? <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'value'}} onClick={onMakeSwitchable} /> : null}

      <SourceRow
        value={value} entry={entry} datasetType={datasetType} env={srcEnv}
        onPick={(next) => patch((p) => setViewValue(p, view.id, next))}
      />

      <PopRow label="Format">
        <select
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Format"
          value={view.format}
          onChange={(e) => { const f = e.target.value; patch((s) => setViewFormat(s, view.id, f)); }}
        >
          {/* No `auto`: §5.3 says a KPI names the format it prints, and «the renderer picks»
              is an answer only a table cell may give. */}
          {formatsFor(value, spec, view.format, false).map((f) => (
            <option key={f} value={f}>{formatWord(f)}</option>
          ))}
        </select>
      </PopRow>

      <PopRow label="Target">
        <button type="button" className="sp-pop-set" aria-label={target ? 'Edit target' : 'Set a target'} onClick={target ? onEditTarget : onPickTarget}>
          {target ? `Edit ${valueName(target.value, spec)}` : 'Set a target'}
        </button>
      </PopRow>

      {!embedded && <DeltaRow
        widget={widget} view={view}
        onPick={(on) => patch((s) => setDeltaVsOtherSource(s, view.id, on))}
      />}

      {!embedded && <PopRow label="Label">
        <input
          type="text"
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp"
          aria-label="Label"
          maxLength={LIMITS.title}
          value={view.title || ''}
          placeholder={NO_TITLE}
          onChange={(e) => {
            const title = e.target.value.slice(0, LIMITS.title);
            patch((s) => setViewTitle(s, view.id, title));
          }}
        />
      </PopRow>}

      <button type="button" className="sp-pop-more" aria-label="More KPI settings" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? '▾ Less' : '▸ More'}
      </button>
      {more ? <>
      {embedded && <DeltaRow
        widget={widget} view={view}
        onPick={(on) => patch((s) => setDeltaVsOtherSource(s, view.id, on))}
      />}
        <PopRow label="Basis">
          <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel" aria-label="KPI basis" value={view.basis || ''}
            onChange={(e) => { const basis = e.target.value || undefined; patch((s) => setViewSettings(s, view.id, { basis })); }}>
            <option value="">Default (current scope)</option>
            {KPI_BASES.map((basis) => <option key={basis} value={basis}>{({ campaign: 'Campaign', video: 'Video lines', audio: 'Audio lines', cpc: 'While paced on clicks' })[basis]}</option>)}
          </select>
        </PopRow>
        <PopRow label="Layout">
          <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel" aria-label="KPI layout" value={view.density || ''}
            onChange={(e) => { const density = e.target.value || undefined; patch((s) => setViewSettings(s, view.id, { density })); }}>
            <option value="">Stacked</option>
            {KPI_DENSITIES.map((density) => <option key={density} value={density}>One line</option>)}
          </select>
        </PopRow>

      </> : null}

      {!embedded && <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
        Remove KPI view
      </button>}
      <FollowsNote value={value} />
    </>
  );
  return <Popover anchorRef={anchorRef} open onClose={onClose} title="KPI settings" initialFocus={valueRef}>{content}</Popover>;
}

/* ── the Δ-vs-other-source line, and the grammar's own refusal ────────────── */

/**
 * §5.3's support line: how far CM360 is from delivery on the very field this KPI reads.
 * Two facts have to hold and the grammar owns both — a CM360 dataset, and a value both
 * sources carry (every option of it, when the switch moves it) — so this row asks by
 * TRYING: the candidate draft is judged by `validateReportDraft`, and a problem that is new
 * AND about this view is the answer.
 *
 * The refusal is PRINTED, not only hung on `title` — a tooltip is a reason only a mouse can
 * read (the Axis row's own rule, T6) — and since T13 the refused segment keeps its Tab stop
 * and names that sentence through `aria-describedby`, so one node serves both readers.
 */
function DeltaRow({ widget, view, onPick }) {
  const uid = useId();
  const on = !!view.deltaVsOtherSource;
  const why = useMemo(() => {
    // The value a control ALREADY holds is never refused — asking would answer with the
    // fault it is already causing, and a segment cannot be disabled on its own state.
    if (on) return null;
    return refusalAt(widget, setDeltaVsOtherSource(widget.spec, view.id, true), viewAt(widget.spec, view.id));
  }, [widget, view.id, on]);
  return (
    <PopRow label={DELTA_LABEL} note={why} noteId={`${uid}-delta-why`}>
      <Seg
        label={DELTA_LABEL}
        value={on}
        options={[[false, 'Off'], [true, 'On', why]]}
        onPick={onPick}
        describedBy={`${uid}-delta-why`}
      />
    </PopRow>
  );
}
