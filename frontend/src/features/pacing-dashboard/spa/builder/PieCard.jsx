// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/PieCard.jsx
//
// THE PIE CARD (widget-builder v2 §5.4, mockup §2). One card in the builder's Views list:
// three chips — what is cut, what it is cut BY, and how many slices are drawn before the
// tail folds into Others.
//
// It takes the CARD INTERFACE `ChartCard.jsx` states — the same nine props, handed down by
// the builder's Views map.
//
// A PIE IS BORN COMPLETE. `addView('pie', {sliceByKey})` throws without a dimension —
// guessing one would cut the pie by rows that are not there — so `+ Add view` asks which
// one first (T5) and mints the value, the fold size and the format with it. Every chip here
// therefore CHANGES a setting; none of them fills an empty slot.
//
// TWO REFUSALS THIS CARD DOES NOT RESTATE. What a pie may cut is the catalog's answer, in
// the map that fills the Value select (canonical, CM360-fed, and the non-additive families);
// what a pie may not be given at all is the missing ƒx door, and `PieValuePopover` says why
// in place. Neither sentence is written twice.
import { SwitchAction, useContextualSwitch } from './ContextualSwitch.jsx';
import { useId, useMemo, useRef, useState } from 'react';
import Spotlight from '../Spotlight.jsx';
import { LIMITS } from '../report-v2.js';
import { setPieTopN, setSliceBy, setViewTitle, updateView } from '../report-draft.js';
import { spotlightItems, valueReadsCm } from '../spotlight-items.js';
import PieValuePopover from './PieValuePopover.jsx';
import { PopRow } from './rows.jsx';
import { formulaScopeFor } from '../formula-scope.js';
import ViewFrame from './ViewFrame.jsx';
import ContentRow from './ContentRow.jsx';
import HighlightChildren from './HighlightChildren.jsx';
import { highlightContextExpressionsAvailable, highlightCmSlots } from './highlight-capabilities.js';
import { grainName, valueName } from './view-text.js';
import { formatWord } from './column-format.js';

const NO_ITEMS = [];
/** The Spotlight's context pill — the mockup's own word for this door (§4). */
const SPOT_LABEL = 'Pie slices';
const SPOT_ANCHOR = 'piedim';
const DIM_PREFIX = 'piedim:';
/** The one row on that map that is not a dimension: it names the dimension SWITCH, and the
 *  viewer picks (M4). Its id is the whole discriminator, because the pie stores `{key}` or
 *  `{controlId}` and never a `type`. */
const CONTROL_ID = 'piedim:control';
/** The pie's slice dimension in the shape `grainName` reads — the other two cards store a
 *  `type` and this one does not, so the discriminator is which key is present. */
const sliceGrain = (view) => (view.sliceBy && Object.prototype.hasOwnProperty.call(view.sliceBy, 'controlId')
  ? { type: 'control', controlId: view.sliceBy.controlId }
  : { type: 'dim', key: view.sliceBy && view.sliceBy.key });

// `onDraftInvalid` is part of the card interface and is not called here: this card's one
// map is a DIMENSION picker, which carries no formula slot, so nothing on it can leave a
// half typed expression behind. Its value slot has no formula door either (see
// `PieValuePopover`).
export default function PieCard({
  view, spec, widget, env, patch, first, last, onMove, onDropAt, onRemove,
  embedded = false, onDraftInvalid,
}) {
  const switching = useContextualSwitch(widget, env, patch);
  const uid = useId();
  const chipRef = useRef(null);
  const valueRef = useRef(null);
  const sliceRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(false);

  // The draft's dimension switch, or null — what the slice map's «follows the switch» row
  // is offered from, and what the pick writes a reference to.
  const dimensionControl = (spec && Array.isArray(spec.controls) ? spec.controls : [])
    .find((c) => c && c.type === 'dimension') || null;
  const value = view.value || null;
  const bound = !!value && value.kind === 'bound';
  // `ColumnRow`'s own rule, so one pill means one thing across the window.
  const pill = bound ? null : valueReadsCm(value) ? 'CM' : value?.kind === 'metric' ? 'BQ' : null;

  const items = useMemo(
    () => (spot ? spotlightItems(SPOT_ANCHOR, { dims: env.dims, dimensionControl }) : NO_ITEMS),
    [spot, env.dims, dimensionControl],
  );

  const sliceControls = (<>
        <button
          type="button" className={embedded ? "sp-inp sp-inp--sans sp-inspector-pick" : "sp-rb-chip sp-rb-chip--act"}
          ref={sliceRef}
          onClick={() => { setOpen(false); setSpot(true); }}
        >
          {embedded ? grainName(env, sliceGrain(view), spec) : `Slice by: ${grainName(env, sliceGrain(view), spec)}`}
          {' '}
          <span className="sp-rb-caret" aria-hidden="true">▾</span>
        </button>
        <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'sliceBy'}} onClick={() => { setOpen(false); setSpot(false); switching.open({viewId:view.id,kind:'sliceBy'}, sliceRef); }} />
  </>);
  const sliceLimitInput = (
          <input
            id={`${uid}-topn`}
            aria-label="Top N"
            type="number"
            className="sp-inp sp-inp--sm sp-rb-num"
            min={1}
            max={LIMITS.pieTopN}
            value={view.topN == null ? '' : view.topN}
            onChange={(e) => {
              const raw = String(e.target.value).trim();
              // Nothing is clamped (§9), and there is no null that means «all»: a pie
              // ALWAYS folds its tail into Others, so `topN` is required. What was typed is
              // stored — an emptied field included, because snapping the number back would
              // be the field fighting the author mid-edit — and the validator names it.
              if (raw === '') { patch((s) => setPieTopN(s, view.id, null)); return; }
              const n = Number(raw);
              if (Number.isInteger(n)) patch((s) => setPieTopN(s, view.id, n));
            }}
          />
  );
  const sliceLimit = embedded ? (
    <PopRow label="Top N">
      {sliceLimitInput}
      <span className="sp-rb-cap">{`1 to ${LIMITS.pieTopN}`}</span>
    </PopRow>
  ) : (
    <span className="sp-rb-chip sp-rb-chip--num">
      <label className="sp-rb-chip-l" htmlFor={`${uid}-topn`}>Top N</label>
      {sliceLimitInput}
      <span className="sp-rb-cap">{` · 1 to ${LIMITS.pieTopN}`}</span>
    </span>
  );

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
          summary={`${formatWord(view.format)} · by ${grainName(env, sliceGrain(view), spec)}`}
          open={open}
          onOpen={() => { setSpot(false); setOpen(true); }}
        >
          {bound ? <>{' '}<span className="sp-rb-bind" role="img" aria-label="follows the metric switch">⇄</span></> : null}
          {pill ? <>{' '}<span className={`sp-rb-src${pill === 'CM' ? ' sp-rb-src--cm' : ''}`}>{pill}</span></> : null}
        </ContentRow>
        <HighlightChildren owner={view} ownerType="pie" formulaScope={formulaScopeFor(sliceGrain(view), env)}
          cm={highlightCmSlots(view, 'pie', view, spec, env)}
          allowContextExpressions={highlightContextExpressionsAvailable(view.value, spec)}
          onEditingChange={onDraftInvalid} onOpen={() => { setOpen(false); setSpot(false); }}
          onChange={(highlights) => patch((current) => updateView(current, view.id, (node) => {
            const next = { ...node }; if (highlights) next.highlights = highlights; else delete next.highlights; return next;
          }))} />
      </div>
      {embedded ? <details className="sp-inspector-details"><summary>Slice settings</summary><div className="sp-inspector-detail-body sp-inspector-fields">
        <PopRow label="Slice by">{sliceControls}</PopRow>
        {sliceLimit}
      </div></details> : <div className="sp-rb-row sp-rb-row--view">
        {sliceControls}
        {sliceLimit}
      </div>}

      {open ? (
        <PieValuePopover
          env={env}
          widget={widget}
          view={view}
          anchorRef={chipRef}
          valueRef={valueRef}
          patch={patch}
          onMakeSwitchable={() => { setOpen(false); switching.open({viewId:view.id,kind:'value'}, chipRef); }}
          onClose={() => setOpen(false)}
        />
      ) : null}

      <Spotlight
        open={spot}
        context={{ label: SPOT_LABEL, anchor: SPOT_ANCHOR }}
        items={items}
        step={null}
        // A dimension is not a value, so there is no formula to write here.
        formulaSlot={null}
        onPick={(item) => {
          patch((s) => setSliceBy(s, view.id, item.id === CONTROL_ID
            ? { controlId: dimensionControl && dimensionControl.id }
            : item.id.slice(DIM_PREFIX.length)));
          setSpot(false);
        }}
        onClose={() => setSpot(false)}
      />
      {switching.dialog}
    </ViewFrame>
  );
}
