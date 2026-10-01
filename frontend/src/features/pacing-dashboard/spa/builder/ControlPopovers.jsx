// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/ControlPopovers.jsx
//
// The five panels behind the Controls row (widget-builder v2 §6, mockup §2). One file
// because they are one idiom asked four times — a control names a question the VIEWER
// answers, so each panel is «what may they choose», «which one do they start on», and «what
// is the question called». All use the same options list and initial-choice field.
//
// Four rules shape all of them:
//
//   · A LABEL IS TYPED, NEVER DERIVED. `normControl` refuses a blank one outright: a control
//     has no value to name itself from, unlike a series or a column. So each panel carries a
//     Label row, each control is MINTED with a sensible one, and an emptied field is refused
//     BY NAME (§9) rather than silently refilled.
//   · A SWITCH NEEDS TWO. One option is a label, not a choice. The floor is stated on the
//     panel — `Choose at least two.` — rather than only in the refusal that follows.
//   · THE CATALOG IS THE MAP, AND THE DRAFT IS THE JUDGE. §6's own rule is that a metric
//     switch offers free metric choices, so the catalog refuses nothing here; whether an
//     option is legal depends on the elements that FOLLOW the switch, which only the draft
//     knows. Each unpicked option is therefore asked of `validateReportDraft` on the very
//     draft that pick would produce, and the offender is named in place.
//   · EVERY REFUSAL IS THE GRAMMAR'S OWN SENTENCE. What is already wrong with this control
//     is read off `validateReportDraft`'s problems by ELEMENT (T2's own routing), printed
//     verbatim under the panel's title.
//
// Removal is the CALLER's: `onRemove` goes back to the builder, which owns the confirm —
// removing the metric switch re-fixes every bound element (§6), and a confirm has to name
// them before it happens.
import { useId, useMemo, useRef, useState } from 'react';
import Popover from '../Popover.jsx';
import Spotlight from '../Spotlight.jsx';
import { LIMITS, PROJECTION_MODES, PERIOD_CHOICES, leafViews } from '../report-v2.js';
import { CATALOG, entryOf, mintValue } from '../metric-catalog.js';
import {
  boundElements, CONTROL_LABEL, datasetTypeOf, newNodeId, removeControl, setControl, validateReportDraft,
} from '../report-draft.js';
import { autoLabel, resolveValue } from '../report-render.js';
// The pre-step's own reading of `defaultBy`, so the row below is offered exactly where the
// rule can fire.
import { buyUnitDefaultApplies } from '../auto-controls.js';
import { askOn } from './ask-grammar.js';
import { dimLabel } from './view-text.js';
import { RANGE_LABEL } from '../report/ReportWidget.jsx';
import { sourcesFor, spotlightItems } from '../spotlight-items.js';
import { PopRow } from './rows.jsx';
import './ControlPopovers.css';

const arr = (v) => (Array.isArray(v) ? v : []);
/** §6's floor, in the words the brief pins. Said on the panel, because a floor the author
 *  only meets as a refusal is a floor they had to walk into. */
const MIN_TWO = 'Choose at least two.';
/** …and the Period switch's whole promise, which is what makes the floor worth stating: two
 *  ranges is the smallest thing a viewer can switch BETWEEN. */
const PERIOD_NOTE = `${MIN_TWO} Auto follows the dashboard period.`;
/** …and the way out of the one tick this panel offers no ACTION for. «Auto» already means
 *  «follow the dashboard», so removing the switch leaves the widget exactly where the single
 *  tick was pointing — which makes the removal below the honest path and a second button
 *  writing the same bytes a decision offered twice. Said, so the reader does not have to
 *  work that out from a refusal that only tells them what is missing. */
const AUTO_ALONE = 'Auto alone follows the dashboard. Remove this switch to keep that behavior.';
/** What a metric switch does to the elements bound to it — the same fact §6 states, in the
 *  words this builder already prints under a bound element. */
const METRIC_NOTE = MIN_TWO;
/** …and what «follow the buy type» means, in the words the viewer would use: the option the
 *  tile opens on is chosen on the pacing rather than frozen here (sections cutover
 *  2026-09-07). A switch with no option in that unit keeps the one ticked below. */
export const BUY_UNIT_NOTE = 'Starts on impressions, clicks or completes to match this pacing. Uses the fallback if no option matches.';
/** The names each control is MINTED with, so a newborn one is never born blank (the grammar
 *  refuses a blank label). The author may type over them.
 *
 *  Re-exported, not declared: `addView('compare')` mints two controls of its own, and the
 *  draft layer may not import a React module — so the ONE table lives beside the mutators
 *  (`report-draft.js`) and every panel that prints it as a placeholder reads it from here. */
export { CONTROL_LABEL };
/** What a switch says on its chip before it has been given anything to switch between. A
 *  chip in a row of chips has to say what it IS, and the Controls row and the Compare card
 *  both wear one — so the words live beside the panel that fills them, said once. */
export const NO_OPTIONS = {
  __proto__: null, metric: 'no options yet', period: 'no ranges yet', dimension: 'no dimensions yet',
};

/**
 * What the grammar says is wrong with THIS control right now, or null.
 *
 * Not `refusalAt`: that answers «would this edit break something», by diffing a candidate
 * against the draft in hand. This is the other question — «is the control the panel is open
 * on already refused» — and the answer is a problem the draft ALREADY has, which a diff
 * would filter out. The refusal is found by ELEMENT (T2's routing), so a pointer that counts
 * a different list is still matched by type.
 *
 * A ROW-LEVEL problem carries no type: `/spec/controls` with no index routes to a bare
 * `{kind:'control'}`, because the grammar addressed the LIST. Two of those sentences are
 * nevertheless about exactly one control — «a CM360 report … carries no period control» and
 * «a breakdown control … needs a deliveryCm360 dataset» — and matching them by words would
 * be a third copy of a rule that already exists twice. So the draft is asked instead: take
 * THIS control out, and if the sentence goes with it, it was about this control. Anything
 * that survives the removal was about the row, and the panel says nothing rather than
 * printing another chip's refusal over this one.
 *
 * A COMPARE VIEW's problem can be a sentence about this control too — see `comparesHere`.
 */
export function controlRefusal(widget, type) {
  const { problems } = validateReportDraft(widget);
  const ofControl = (p) => p.element && p.element.kind === 'control';
  const mine = problems.find((p) => ofControl(p) && p.element.controlType === type);
  if (mine) return mine.detail;
  const named = problems.find((p) => comparesHere(widget && widget.spec, p.element, type));
  if (named) return named.detail;
  const row = problems.find((p) => ofControl(p) && p.element.controlType === undefined);
  if (!row) return null;
  const key = (p) => `${p.pointer} ${p.detail}`;
  const without = validateReportDraft({ ...widget, spec: removeControl(widget && widget.spec, type) });
  return without.problems.some((p) => key(p) === key(row)) ? null : row.detail;
}

/** The control of one type this draft carries, or null (Table C: at most one of each). */
const controlOfType = (spec, type) => arr(spec && spec.controls).find((c) => c && c.type === type) || null;

/**
 * Is a refusal raised on a COMPARE VIEW a sentence about the metric switch this panel is
 * open on? §5.5 gives that switch a second consumer the control pointer cannot show: a
 * compare view names it BY ID and every option it offers has to be dual-source, so the
 * offender is the switch while the pointer is `/spec/views/N`. Without this the author is
 * sent to the Compare card for a fault they made in the switch panel.
 *
 * Attributed in `normCompareView`'s OWN order rather than by matching words: that function
 * judges the dataset, then the metric reference, then the breakdown reference, and only
 * then the options. So a compare view on a CM360 widget whose two references both resolve
 * has passed everything before the option rule — and the option rule is this panel's. A
 * view that is failing on either reference is not attributed here, which is what keeps the
 * metric panel from printing «breakdownControlId names no breakdown control».
 */
function comparesHere(spec, element, type) {
  if (type !== 'metric') return false;
  if (!element || element.kind !== 'view' || !element.viewId) return false;
  if (datasetTypeOf(spec) !== 'deliveryCm360') return false;
  const v = leafViews(spec?.views).find((x) => x && x.id === element.viewId);
  if (!v || v.kind !== 'compare') return false;
  const mc = controlOfType(spec, 'metric');
  const bc = controlOfType(spec, 'breakdown');
  return !!mc && mc.id === v.metricControlId && !!bc && bc.id === v.breakdownControlId;
}

/* ── the metric switch ────────────────────────────────────────────────────── */

/**
 * MetricSwitchPopover — the options a viewer may switch between, which one they start on,
 * and what the switch is called.
 *
 *   widget     the whole draft widget: the option check judges a candidate against it
 *   control    the metric control itself
 *   anchorRef  the chip this panel hangs from
 *   firstRef   where focus lands on open (§3) — the label field
 *   patch      the builder's ONE write path
 *   onRemove   ask the BUILDER to remove it; it names the bound elements first
 */
export function MetricSwitchPopover({
  widget, control, anchorRef, firstRef, patch, onRemove, onClose, footer, buildOption = withOption, candidateReason, hideRefusal = false,
}) {
  const [adding, setAdding] = useState(false);
  const addedRef = useRef(null);
  const addedEntryRef = useRef(null);
  const spec = widget.spec;
  const datasetType = datasetTypeOf(spec);
  const options = arr(control.options);
  const chosen = new Map(options.map((o) => [entryIdOf(o, datasetType), o]));
  const full = options.length >= LIMITS.metricOptions;

  const catalogItems = useMemo(
    () => spotlightItems('switch', { datasetType, hasMetricControl: true, grain: null }),
    [datasetType],
  );

  /**
   * Which metrics this switch may NOT be given, and the grammar's sentence for each.
   *
   * Asked ONLY when something follows the switch, and TWO things can: a bound element
   * follows it by type (§6: «every option must be legal for every bound element»), and a
   * COMPARE VIEW names it by id and requires every option to be dual-source (§5.5) with
   * nothing bound anywhere. That second one is the state the builder itself builds —
   * `+ Add source → CM360` then `+ Add view → Compare` mints this switch and binds nothing
   * — and reading only the bound half offered all 58 rows as legal on it. A switch nothing
   * follows still skips the 58 candidate validations, which would answer null 58 times.
   *
   * A picked option is never asked about — it would answer with the fault it is already
   * causing, which the panel's own refusal line already prints.
   */
  const refusals = useMemo(() => {
    const out = new Map();
    if (!adding) return out;
    const followed = boundElements(spec).length
      || leafViews(spec?.views).some((v) => v && v.kind === 'compare' && v.metricControlId === control.id);
    if (!followed) return out;
    // ONE baseline for all 58 questions — `askOn` is the shared module's own answer to the
    // cost of asking about several candidates at once. `/spec` as the pointer, because a
    // refusal about this pick can land anywhere: on a bound element that cannot take it, or
    // on the compare view whose comparison it breaks.
    const ask = askOn(widget);
    for (const row of catalogItems) {
      if (row.g || chosen.has(row.id)) continue;
      const candidate = buildOption(spec, control, CATALOG.find((e) => e.id === row.id), datasetType);
      if (!candidate) { out.set(row.id, 'This source does not carry this option'); continue; }
      const why = candidateReason ? candidateReason(candidate) : ask({ ...widget, spec: candidate }, '/spec');
      if (why) out.set(row.id, why);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, widget, catalogItems]);

  // Every write reads the control off the SPEC IT IS WRITING, never off this render's
  // closure: two ticks that landed in one batch would otherwise both build from the option
  // list as it was before either of them, and the first would vanish under the second.
  const live = (s) => arr(s && s.controls).find((c) => c && c.type === 'metric') || control;

  const removeOption = (optionId) => {
    patch((s) => {
      const cur = live(s);
      const gone = arr(cur.options).find((o) => o.id === optionId);
      if (!gone) return s;
      const next = arr(cur.options).filter((o) => o !== gone);
      return setControl(s, {
        type: 'metric',
        options: next,
        // Removing the default deterministically starts on the first remaining stored row.
        defaultOptionId: gone.id === cur.defaultOptionId ? (next[0] && next[0].id) : cur.defaultOptionId,
      });
    });
  };

  const addOption = (row) => {
    if (full || chosen.has(row.id)) return;
    const entry = CATALOG.find((e) => e.id === row.id);
    patch((s) => {
      const next = buildOption(s, live(s), entry, datasetTypeOf(s));
      return next && !candidateReason?.(next) ? next : s;
    });
    addedEntryRef.current = row.id;
    setAdding(false);
  };

  // Spotlight owns the catalog. Selected and unavailable entries stay visible there with
  // their reason; the small settings panel below contains no catalog rows at all.
  const items = catalogItems.map((row) => {
    if (row.g) return row;
    if (chosen.has(row.id)) return { ...row, disabled: true, reason: 'Already added' };
    const blocked = refusals.get(row.id)
      || (!arr(row.chips).length ? 'This Widget reads no source that carries it' : null)
      || (full ? 'This switch already has the maximum number of options' : null);
    return blocked ? { ...row, disabled: true, reason: blocked } : row;
  });

  const why = hideRefusal ? null : controlRefusal(widget, 'metric');
  const capWhy = full ? ' Maximum reached; remove an option to add another.' : '';
  const hasAdded = !!addedEntryRef.current && options.some((opt) => entryIdOf(opt, datasetType) === addedEntryRef.current);

  if (adding) {
    return (
      <Spotlight
        open
        context={{ label: 'Metric switch', anchor: 'switch' }}
        items={items}
        step={null}
        formulaSlot={null}
        onPick={addOption}
        onClose={() => setAdding(false)}
      />
    );
  }

  return (
    <Popover
      anchorRef={anchorRef} open onClose={onClose} title="Metric switch"
      width={400}
      initialFocus={hasAdded ? addedRef : firstRef}
    >
      <div className="sp-control-form">
        {why ? <div className="sp-pop-bad">{why}</div> : null}
        <LabelRow type="metric" control={control} patch={patch} inputRef={firstRef} />

        <PopRow label="Options" note={`${METRIC_NOTE}${capWhy}`}>
          <div className="sp-pop-list sp-pop-list--selected" role="group" aria-label="Selected switch options">
            {options.map((opt) => {
              const focusAdded = entryIdOf(opt, datasetType) === addedEntryRef.current && !!addedEntryRef.current;
              return (
                <div className="sp-pop-list-r" key={opt.id}>
                  <span className="sp-pop-list-nm sp-pop-list-l" tabIndex={-1} ref={focusAdded ? addedRef : null}>
                    {optionName(opt, spec, datasetType)}
                  </span>
                  <button
                    type="button" className="sp-rb-btn"
                    aria-label={`Remove ${optionName(opt, spec, datasetType)}`}
                    onClick={() => removeOption(opt.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {!options.length && <div className="sp-pop-note">No options selected yet.</div>}
            <button type="button" className="sp-pop-set" onClick={() => setAdding(true)}>
              + Add option
            </button>
          </div>
        </PopRow>

        {buyUnitDefaultApplies(control) || control.defaultBy === 'buyUnit' ? (
          <PopRow label="Start rule" note={control.defaultBy === 'buyUnit' ? BUY_UNIT_NOTE : null}>
            <select
              className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
              aria-label="Start rule" value={control.defaultBy === 'buyUnit' ? 'buyUnit' : 'fixed'}
              onChange={(e) => patch((s) => setControl(s, { type: 'metric', defaultBy: e.target.value === 'buyUnit' ? 'buyUnit' : null }))}
            >
              <option value="fixed">Fixed option</option>
              <option value="buyUnit">Match buy type</option>
            </select>
          </PopRow>
        ) : null}
        <StartRow
          label={control.defaultBy === 'buyUnit' ? 'Fallback' : 'Starts with'}
          value={control.defaultOptionId}
          options={options.map((opt) => [opt.id, optionName(opt, spec, datasetType)])}
          onChange={(id) => patch((s) => setControl(s, { type: 'metric', defaultOptionId: id }))}
        />

        {footer}
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
          Remove metric switch
        </button> : null}
      </div>
    </Popover>
  );
}

const optionName = (option, spec, datasetType) => {
  if (typeof option?.label === 'string' && option.label.trim()) return option.label.trim();
  const entry = entryOf(option && option.value, datasetType);
  return (entry && entry.label) || autoLabel(resolveValue(option && option.value, spec, null)) || 'Untitled option';
};

/** The catalog id a stored option was minted from — `entryOf`'s own read-back, so an option
 *  stored under its CM name on a CM360 widget still ticks its own row. A formula option (the
 *  grammar allows one) is minted from no entry and ticks nothing. */
const entryIdOf = (option, datasetType) => {
  const hit = entryOf(option && option.value, datasetType);
  return hit ? hit.id : null;
};

/** The spec with one more option on the switch, or null when this report reads no source
 *  that carries the entry. The id is minted against the spec being written, so two ticks in
 *  a row never collide. */
function withOption(spec, control, entry, datasetType) {
  const source = sourcesFor(entry, { datasetType })[0];
  if (!entry || !source) return null;
  const id = newNodeId(spec, 'o');
  const options = [...arr(control.options), {
    id, label: '', labelAuto: true, value: mintValue(entry, { source, datasetType }),
  }];
  return setControl(spec, {
    type: 'metric',
    options,
    // The first option a switch is given is what it starts on. Filling an empty default is
    // allowed (§1.1.4); replacing one the author chose is not.
    defaultOptionId: control.defaultOptionId || id,
  });
}

/* ── the period switch ────────────────────────────────────────────────────── */

/**
 * PeriodSwitchPopover — which windows the viewer may pick between, and which one the tile
 * opens on. The vocabulary is the grammar's `PERIOD_CHOICES` — `Auto` first, then the six
 * ranges — and the words are the tile's own (`RANGE_LABEL`), so the chip, the panel and the
 * pill the viewer clicks all say `Flight`. Auto is what makes «one period» a real switch:
 * `auto + 7d` is two choices, and the grammar's floor is satisfied (unified spec §4.2).
 *
 * ONE TICK IS A DEAD END, AND THIS PANEL IS THE WAY OUT OF IT. «A period switch needs at
 * least 2 choices» is a true refusal with an untrue implication: an author who ticked one
 * range usually did not want a switch at all, they wanted that one window — which lives on
 * the Data row's period, one panel away, and is reached today by removing this switch, going
 * there and picking the range again. So the refusal keeps its words and gains an action that
 * says the outcome: `onPinWindow(range)`, ONE patch that takes the switch and writes the
 * window. It is the builder's, like `onRemove`, because it reaches past this control.
 *
 * The AUTO-only tick has no second action, on purpose: «auto» IS «follow the dashboard», so
 * the honest way out is the removal already on this panel, and a second button writing the
 * same bytes would be one decision offered twice. It gets the sentence instead.
 */
export function PeriodSwitchPopover({
  widget, control, anchorRef, firstRef, patch, onRemove, onPinWindow, onClose, footer, hideRefusal = false,
}) {
  const picked = arr(control.options);
  const why = hideRefusal ? null : controlRefusal(widget, 'period');
  // The single tick, when there IS exactly one and it is a real window. A junk option that
  // rode in from a picker's bug (`assembleControl` keeps it; the validator names it) is not a
  // window and must not be offered as one.
  const only = picked.length === 1 ? picked[0] : null;
  const pinnable = only && only !== 'auto' && PERIOD_CHOICES.indexOf(only) !== -1 ? only : null;

  // Read off the SPEC being written, not this render's closure — the metric panel's rule,
  // for the same reason: two ticks batched into one update would both build from the list as
  // it was before either of them.
  const toggle = (range) => patch((s) => {
    const cur = arr(s && s.controls).find((c) => c && c.type === 'period') || control;
    const now = arr(cur.options);
    const next = now.includes(range) ? now.filter((r) => r !== range) : [...now, range];
    return setControl(s, {
      type: 'period',
      options: next,
      // A default naming a range that is gone is refused, and the author never chose to
      // lose it — so it moves to what is left rather than dangling.
      defaultOption: next.includes(cur.defaultOption) ? cur.defaultOption : next[0],
    });
  });

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Period switch" width={400} initialFocus={firstRef}>
      <div className="sp-control-form">
        {why ? <div className="sp-pop-bad">{why}</div> : null}
        <LabelRow type="period" control={control} patch={patch} inputRef={firstRef} />

        <PopRow label="Options" note={PERIOD_NOTE}>
          <div className="sp-pop-list sp-pop-list--flat sp-control-choices" role="group" aria-label="Switch options">
            {PERIOD_CHOICES.map((range) => (
              <div className="sp-pop-list-r" key={range}>
                <label className="sp-pop-ck sp-pop-list-l">
                  <input
                    type="checkbox" className="sp-rb-ck"
                    checked={picked.includes(range)} onChange={() => toggle(range)}
                  />
                  <span className="sp-pop-list-nm">{RANGE_LABEL[range] || range}</span>
                </label>
              </div>
            ))}
          </div>
        </PopRow>
        <StartRow
          value={control.defaultOption}
          options={picked.map((range) => [range, RANGE_LABEL[range] || range])}
          onChange={(range) => patch((s) => setControl(s, { type: 'period', defaultOption: range }))}
        />

        {pinnable && onPinWindow ? (
          <button
            type="button" className="sp-pop-rm sp-pop-rm--go"
            onClick={() => { onClose(); onPinWindow(pinnable); }}
          >
            {`Make ${RANGE_LABEL[pinnable] || pinnable} the fixed window instead`}
          </button>
        ) : null}
        {only === 'auto' ? <div className="sp-pop-note">{AUTO_ALONE}</div> : null}
        {footer}
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
          Remove period switch
        </button> : null}
      </div>
    </Popover>
  );
}

/* ── the dimension switch ─────────────────────────────────────────────────── */

/** …and the dimension switch's own promise, the reason its floor is worth stating: two
 *  dimensions is the smallest thing a viewer can switch BETWEEN. */
const DIMENSION_NOTE = MIN_TWO;
/** …and the OTHER shape the same switch has since the sections cutover (2026-09-07): the
 *  list resolved on the pacing in front of the viewer instead of frozen at authoring time.
 *  Said on the panel, because «Auto» on its own does not tell the reader what it follows. */
export const DIMENSION_AUTO_NOTE = 'Auto includes new dimensions as they become available.';
/** Why «Pick» is closed on a pacing that carries fewer than two dimensions: the list it would
 *  store is the one this panel is offering, and a switch with one option is not a switch. */
export const PICK_NEEDS_TWO = 'A stored list needs two dimensions this pacing has.';

/**
 * What Auto resolves to on the pacing in front of the author — and, when that is fewer than
 * two cuts, what the tile does INSTEAD of drawing a switch.
 *
 * The three answers are three different facts, not one sentence with a shorter tail (fix
 * round 1). `resolveAutoControls` COLLAPSES an auto dimension switch below two cuts: the
 * control is not drawn at all and every view that followed it is fixed to the one dimension.
 * A panel that answered «On this pacing: Audience» there would be promising a switch this
 * pacing never shows — and that is the ordinary case, not the odd one: `autoDimensionOptions`
 * never offers Channel, so a pacing whose only cuts are Audience and Channel resolves to one.
 */
export function autoPacingSay(labels) {
  const list = (Array.isArray(labels) ? labels : []).filter(Boolean);
  if (list.length >= 2) return `On this pacing: ${list.join(', ')}`;
  if (list.length === 1) {
    return `On this pacing only ${list[0]} applies, so this Widget draws no switch `
      + 'and every view it cuts is fixed to it.';
  }
  return 'This pacing records no dimension yet, so this Widget draws no switch '
    + 'and every view it cuts is fixed to Audience.';
}

/**
 * DimensionSwitchPopover — which dimensions a viewer may cut by, which one the tile opens
 * on, and what the question is called.
 *
 * The opposite trade from the breakdown panel one section down: THIS switch stores its
 * options, so there IS something to pick from — the pacing's own dimensions, out of
 * `dimensionEntries`, each with the reason it cannot be offered when this pacing has no
 * values for it (§1.1.3: listed, never dropped).
 *
 * An unavailable dimension is DISABLED rather than hidden and rather than refused: the
 * grammar accepts it (a key is a key), and it is the tile that would draw an empty view.
 * The reader is told before the pick instead of after it.
 *
 * SINCE THE SECTIONS CUTOVER (2026-09-07) the panel asks one question before that one: does
 * this switch store a list at all, or does it follow the pacing (`optionsAuto`)? An auto
 * switch has no options row, because there is nothing to tick — the sentence under the mode
 * says what the pacing in front of the author actually offers today.
 *
 *   autoOptions  the RESOLVED list for the open pacing — what the tile would draw. The panel
 *                never computes it: `resolveAutoControls` is the tile's pre-step and the
 *                builder runs the same one, so a second answer here would be a second rule.
 *   onAskAuto    the CALLER's confirm for the one direction that destroys something — the
 *                same hand-off `onRemove` makes, and for the same reason. Choosing Auto drops
 *                the list the author picked, and Pick does not give it back: it stores
 *                whatever this pacing carries today. Optional: the contextual dialog passes
 *                none, because its whole draft is local and its Cancel writes nothing.
 */
export function DimensionSwitchPopover({
  widget, control, dims, autoOptions = [], anchorRef, firstRef, patch, onRemove, onAskAuto, onClose, footer, candidateReason, hideRefusal = false,
}) {
  const uid = useId();
  const picked = arr(control.options);
  const auto = control.optionsAuto === true;
  const why = hideRefusal ? null : controlRefusal(widget, 'dimension');
  const offered = useMemo(
    () => (Array.isArray(dims) ? dims : []).filter((d) => d && d.kind === 'dim'),
    [dims],
  );
  // What «Pick» would store: this pacing's dimensions, the ones it actually carries. A list
  // that opened with the unavailable ones would be a switch whose first chip draws nothing.
  //
  // The RESOLVED list when the caller has one (final review 2026-09-08). `autoDimensionOptions`
  // and `dimensionEntries` are two different rules — Channel is offered by the second and never
  // by the first, `aux:creative` the other way round — so judging this half on `env.dims` while
  // the sentence below reads `env.autoDims` put «On this pacing only Audience applies, so this
  // Widget draws no switch» directly above an OPEN Pick radio on the ordinary
  // Audience+Channel pacing. One list, one verdict. `autoOptions` is empty exactly when the
  // draft carries no auto switch — there is nothing resolved to prefer, and the stored-list
  // path below is unchanged.
  const resolvedNow = arr(autoOptions);
  const listNow = resolvedNow.length ? resolvedNow : offered.filter((d) => d.available).map((d) => d.key);
  // Why «Pick» is closed, or null. Only ever asked of an AUTO switch: a stored list is
  // already the shape Pick asks for, and disabling the mode it is on would leave the row
  // with no reachable answer.
  const pickShut = auto && listNow.length < 2 ? PICK_NEEDS_TWO : null;
  const whyId = `${uid}-pick-why`;
  // Through the shared namer, not through `offered` alone: the resolved list carries keys
  // this panel's own `dims` never lists (fix round 1), and a raw `aux:creative` in a sentence
  // is an internal name printed at the reader.
  const labelOf = (key) => dimLabel(offered, key) || key;
  const onThisPacing = autoPacingSay(resolvedNow.map(labelOf));
  // Auto stores no list, so choosing it DROPS the one the author picked. The caller owns that
  // question (`onAskAuto`), the way it owns removal; with nothing to lose — or with no caller
  // to ask, which is the contextual dialog — the write goes straight through.
  const goAuto = () => patch((s) => setControl(s, { type: 'dimension', optionsAuto: true }));
  const chooseAuto = () => ((picked.length && onAskAuto) ? onAskAuto() : goAuto());

  // Read off the SPEC being written, not this render's closure — the metric panel's rule,
  // for the same reason: two ticks batched into one update would both build from the list
  // as it was before either of them.
  const toggle = (key) => patch((s) => {
    const cur = arr(s && s.controls).find((c) => c && c.type === 'dimension') || control;
    const now = arr(cur.options);
    const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    return setControl(s, {
      type: 'dimension',
      options: next,
      // A default naming a dimension that is gone is refused, and the author never chose to
      // lose it — so it moves to what is left rather than dangling (the period panel's rule).
      defaultOption: next.includes(cur.defaultOption) ? cur.defaultOption : next[0],
    });
  });

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Dimension switch" width={400} initialFocus={firstRef}>
      <div className="sp-control-form">
        {why ? <div className="sp-pop-bad">{why}</div> : null}
        <LabelRow type="dimension" control={control} patch={patch} inputRef={firstRef} />

        <PopRow label="Dimensions" note={auto ? DIMENSION_AUTO_NOTE : null}>
          <select
            className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
            aria-label="Which dimensions" value={auto ? 'auto' : 'choose'}
            aria-describedby={pickShut ? whyId : undefined}
            onChange={(e) => {
              if (e.target.value === 'auto') chooseAuto();
              else if (!pickShut) patch((s) => setControl(s, {
                type: 'dimension', optionsAuto: false, options: listNow, defaultOption: listNow[0],
              }));
            }}
          >
            <option value="auto">Auto</option>
            <option value="choose" disabled={!!pickShut}>Choose</option>
          </select>
        </PopRow>
        {pickShut ? <div className="sp-pop-list-why sp-control-note" id={whyId}>{pickShut}</div> : null}
        {auto ? <div className="sp-pop-note sp-control-note" aria-live="polite">{onThisPacing}</div> : (
          <>
          <PopRow label="Options" note={DIMENSION_NOTE}>
            <div className="sp-pop-list sp-control-choices" role="group" aria-label="Switch options">
              {offered.map((d) => {
                const on = picked.includes(d.key);
                // Selected unavailable dimensions stay removable; additions keep the same
                // source and candidate checks used by the contextual creation flow.
                const blocked = !on ? ((!d.available ? (d.reason || null) : null) || candidateReason?.(setControl(widget.spec, { type: 'dimension', options: [...picked, d.key], defaultOption: control.defaultOption || d.key }))) : null;
                const reasonId = `${uid}-dim-${d.key}`;
                return (
                  <div className="sp-pop-list-r" key={d.key}>
                    <label className="sp-pop-ck sp-pop-list-l" title={blocked || undefined}>
                      <input
                        type="checkbox" className="sp-rb-ck"
                        checked={on} disabled={!!blocked}
                        aria-describedby={blocked ? reasonId : undefined}
                        onChange={() => toggle(d.key)}
                      />
                      <span className="sp-pop-list-nm">{d.label}</span>
                    </label>
                    {blocked ? <span className="sp-pop-list-why" id={reasonId}>{blocked}</span> : null}
                  </div>
                );
              })}
            </div>
          </PopRow>
          <StartRow
            value={control.defaultOption} options={picked.map((key) => [key, labelOf(key)])}
            onChange={(key) => patch((s) => setControl(s, { type: 'dimension', defaultOption: key }))}
          />
          </>
        )}

        {footer}
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
          Remove dimension switch
        </button> : null}
      </div>
    </Popover>
  );
}

/* ── the breakdown control ────────────────────────────────────────────────── */

/**
 * BreakdownPopover — how many mapping dimensions the viewer may hold at once, and what the
 * question is called. That is the WHOLE stored rule (§6): which dimensions it offers is
 * resolved at runtime from the effective mapping, which is what makes the widget portable
 * across pacings, so there is nothing here to pick from.
 */
export function BreakdownPopover({
  widget, control, anchorRef, firstRef, patch, onRemove, onClose, footer, hideRefusal = false,
}) {
  const uid = useId();
  const why = hideRefusal ? null : controlRefusal(widget, 'breakdown');

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Breakdown switch" width={400} initialFocus={firstRef}>
      <div className="sp-control-form">
        <LabelRow type="breakdown" control={control} patch={patch} inputRef={firstRef} />
        {why ? <div className="sp-pop-bad">{why}</div> : null}

        <PopRow
          label="At once"
          note="Available dimensions come from the mapping."
        >
          <input
            id={`${uid}-max`}
            type="number"
            className="sp-inp sp-inp--sm sp-rb-num"
            aria-label="Dimensions at once"
            min={1}
            max={LIMITS.breakdownMaxSelected}
            value={control.maxSelected == null ? '' : control.maxSelected}
            onChange={(e) => {
              const raw = String(e.target.value).trim();
              // Nothing is clamped (§9): what was typed is stored, an emptied field included,
              // and the validator names a number outside 1..20 rather than snapping it back.
              if (raw === '') { patch((s) => setControl(s, { type: 'breakdown', maxSelected: null })); return; }
              const n = Number(raw);
              if (Number.isInteger(n)) patch((s) => setControl(s, { type: 'breakdown', maxSelected: n }));
            }}
          />
          {/* The range is ON the panel, not only in a tooltip (§1.1.3). */}
          <span className="sp-control-range">{`1 to ${LIMITS.breakdownMaxSelected}`}</span>
        </PopRow>

        {footer}
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
          Remove breakdown switch
        </button> : null}
      </div>
    </Popover>
  );
}

/* ── the projection control ───────────────────────────────────────────────── */

/** ProjectionPopover — the fifth normal viewer control. Its option vocabulary is fixed by
 * the wire grammar rather than copied into every Widget: Plan is the runtime default and
 * Reforecast is the alternate. The authored parts are therefore its label and whether the
 * control exists; projection series decide independently whether they follow it. */
export function ProjectionPopover({
  widget, control, anchorRef, firstRef, patch, onRemove, onClose, footer, hideRefusal = false,
}) {
  const why = hideRefusal ? null : controlRefusal(widget, 'projection');
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Projection switch" width={400} initialFocus={firstRef}>
      <div className="sp-control-form">
        <LabelRow type="projection" control={control} patch={patch} inputRef={firstRef} />
        {why ? <div className="sp-pop-bad">{why}</div> : null}

        <PopRow label="Options" note="Starts with Plan.">
          <span className="sp-control-fixed">
            {PROJECTION_MODES.map((mode) => (mode === 'reforecast' ? 'Reforecast' : 'Plan')).join(' / ')}
          </span>
        </PopRow>

        {footer}
        {onRemove ? <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
          Remove projection switch
        </button> : null}
      </div>
    </Popover>
  );
}

/** Initial choice is independent of the available options. Keep a saved but missing
 * default visible so the grammar can explain it rather than silently choosing for it. */
function StartRow({ label = 'Starts with', value, options, onChange }) {
  const known = options.some(([id]) => id === value);
  return (
    <PopRow label={label}>
      <select
        className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
        aria-label={label} value={value || ''} disabled={!options.length}
        onChange={(e) => onChange(e.target.value)}
      >
        {!known ? <option value={value || ''} disabled>{value ? `Unavailable: ${value}` : 'Choose an option'}</option> : null}
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </PopRow>
  );
}

/* ── the label row every control shares ───────────────────────────────────── */

/** What the viewer sees above the control. Typed, never derived (`normControl`), so the
 *  placeholder repeats the name the control was minted with rather than promising a
 *  fallback: an emptied label is refused by name, and the panel's own refusal line says so. */
function LabelRow({ type, control, patch, inputRef = null }) {
  return (
    <PopRow label="Label">
      <input
        type="text"
        ref={inputRef}
        className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp"
        aria-label="Label"
        maxLength={LIMITS.label}
        value={control.label || ''}
        placeholder={CONTROL_LABEL[type]}
        onChange={(e) => {
          const label = e.target.value.slice(0, LIMITS.label);
          patch((s) => setControl(s, { type, label }));
        }}
      />
    </PopRow>
  );
}
