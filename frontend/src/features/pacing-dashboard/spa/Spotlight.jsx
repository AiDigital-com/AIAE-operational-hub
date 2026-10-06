// workspace/src/components/ui/Spotlight.jsx
//
// The one way anything is ADDED in the v2 builder (spec 2026-08-19 §4). An anchor
// fixes the context — «Add to: Chart», «Table rows», «Pie slices» — and the shell
// shows the map it is handed, searches it, and hands one item back. It builds no
// list of its own: `items` arrives grouped and already judged (T5/T6 mint it from
// the metric catalog), so the same shell serves every anchor.
//
// The three rules that shape the map, all §1.1.3 — nothing is hidden silently:
//   • available first. Each group lists what it CAN offer; what it cannot sits
//     behind «▸ N unavailable here», one click from the reason.
//   • a search never hides a match. Unavailable matches come inline, dimmed, with
//     the reason in place — a search that silently drops them is what makes people
//     believe a metric does not exist.
//   • a group with nothing to show disappears, rather than leaving an empty header.
//
// Keyboard: the input keeps focus and `aria-activedescendant` names the active row
// (the combobox wiring FilterSpotlight already uses), so the arrows walk the
// ENABLED options only — headers, counters and dimmed rows are not stops. Escape
// clears a non-empty query first and closes on the second press, on a window
// CAPTURE listener: a Spotlight Escape that reaches the drawer closes the drawer
// and drops the edit, which the spec calls stop-ship.
//
// Props:
//   open         render it or not
//   context      {label, anchor} — `label` is the pill in the head; `anchor` is the
//                caller's own note about which slot this is, and is not read here
//   items        [{g:'Group'} | {id, label, note, chips:[], disabled, reason, family}]
//                — `family` is the display glyph '#' (metric) / 'ƒ' (calculation) /
//                '▦' (dimension); `reason` is shown in place of `note` when disabled.
//                A chip is `{id, label, off, title}`: the SOURCES this metric has, with
//                `off` for one this pacing cannot serve — muted rather than dropped, so
//                the reader learns the metric HAS a CM360 side before they learn this
//                pacing has none (§1.1.3, spec 2026-08-25 §4). `title` is that sentence;
//                the whole of it also arrives on the second step, which is the surface
//                that can print a sentence rather than hint one
//   onPick       (item) => void, an enabled row was chosen
//   onClose      asked to close: Escape with no query, or a click on the scrim
//   formulaSlot  {contextKind, fieldSet, fieldLabels?, grain?, cm?, cmRefusal?, cmUnavailable?,
//                value?, availableMetrics?, onCommit(expr, family), onDraftState(bad)} —
//                `cm` / `cmRefusal` are the SLOT's CM360 join and its sentence, and they
//                arrive with the rest of `formulaScopeFor`'s scope, which the caller spreads
//                in whole; `cmUnavailable` is the PACING's own sentence (spotlight-items'
//                cmRefusal), which only a caller holding the store's source facts can answer.
//                the escape hatch at the bottom of the map, or null where formulas do
//                not apply. `value` seeds an existing formula and its authored unit.
//                `availableMetrics` is the caller's mart-metrics inventory, handed on to
//                the editor so this door says what FormulaField and the full dialog say;
//                undefined when the caller has none, and then the rule stays silent.
//                `onDraftState` is how the caller hears that a formula is
//                half typed, which is what blocks the drawer's Save.
//   step         {question, options:[{id,label,disabled,reason}], onPick} — the second
//                question (⇄ / BQ / CM), which replaces the map until the user types again
//   id           the DOM id AND the coordinator key; generated when absent
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  openCombobox, openNativeSelect, usePopups, useFocusOnOpen, useOpenerRestore, useInertBackground,
} from './PopupCoordinator.jsx';
import { fieldSetFor } from './builder/FormulaField.jsx';
import { FormulaEditorContent } from './builder/FormulaEditorDialog.jsx';

const PLACEHOLDER = 'Search metrics, dimensions, tools…';
const BACK_HINT = '← type to search again, Esc to close';
const FORMULA_TITLE = 'Custom formula';
const FORMULA_NOTE = 'When no ready-made brick fits: im / days_left, cross-metric math';
const NO_EXPANDED = new Set();
// The empty default the user may overwrite (§1.1.4). `number` and not the
// vocabulary's first member `count`: count formats to whole units (auto/int), so it
// prints 0.7 as 1 for the ratios this slot exists to write, while number carries
// decimals and asserts no unit. The vocabulary itself still comes from the door.
const DEFAULT_FAMILY = 'number';

/**
 * The map as ROWS, plus the flat list the keyboard walks.
 *
 * @param {Array} items    group headers `{g}` interleaved with item rows
 * @param {{query?:string, expanded?:Set<string>}} opts
 * @returns {{rows:Array, options:Array}}
 *   rows — `{kind:'group',g}` | `{kind:'option',item,optIdx}` | `{kind:'off',item}`
 *          | `{kind:'more',g,count}`. No rows at all is the empty state; a counter
 *          row counts as something to show, because it is.
 *   options — every enabled row, in render order. `optIdx` indexes THIS list, which
 *          is what makes the arrows skip headers, counters and dimmed rows without
 *          any of them having to be filtered again at the keyboard.
 */
export function spotlightRows(items, { query = '', expanded = null } = {}) {
  const q = (query || '').trim().toLowerCase();
  const matches = (item) => !q || String(item.label || '').toLowerCase().includes(q);

  const sections = [];
  let current = null;
  for (const item of items || []) {
    if (!item) continue;
    if (item.g) { current = { g: item.g, enabled: [], disabled: [] }; sections.push(current); continue; }
    // An item before any header still belongs somewhere: an anonymous section
    // renders it with no caption rather than dropping it on the floor.
    if (!current) { current = { g: null, enabled: [], disabled: [] }; sections.push(current); }
    (item.disabled ? current.disabled : current.enabled).push(item);
  }

  const rows = [];
  const options = [];
  for (const section of sections) {
    const enabled = section.enabled.filter(matches);
    const disabled = section.disabled.filter(matches);
    if (!enabled.length && !disabled.length) continue;
    if (section.g) rows.push({ kind: 'group', g: section.g });
    for (const item of enabled) {
      rows.push({ kind: 'option', item, optIdx: options.length });
      options.push(item);
    }
    if (!disabled.length) continue;
    // While searching the unavailable matches come inline; at rest they are one
    // click away behind their count, so honesty does not become noise.
    if (q || expanded?.has(section.g)) {
      for (const item of disabled) rows.push({ kind: 'off', item });
    } else {
      rows.push({ kind: 'more', g: section.g, count: disabled.length });
    }
  }
  return { rows, options };
}

/**
 * What a key does here, as a decision the component then applies. One function
 * because two callers ask: the input's onKeyDown (arrows, Enter) and the window
 * capture listener (Escape) — and two copies of this rule would drift.
 *
 * @returns {{type:'move',index:number}|{type:'pick',item:object}|{type:'clear'}|{type:'close'}|null}
 *   null = not ours; the browser and the input keep the key.
 */
export function spotlightKey(key, { query = '', options = [], activeIdx = 0, step = null } = {}) {
  if (key === 'Escape') {
    // Under the second step the query is not what is on screen, and the step's own
    // hint promises Esc closes.
    return !step && query ? { type: 'clear' } : { type: 'close' };
  }
  if (step) return null;
  const n = options.length;
  if (!n) return null;
  const i = Math.min(Math.max(activeIdx, 0), n - 1);
  if (key === 'ArrowDown') return { type: 'move', index: (i + 1) % n };
  if (key === 'ArrowUp') return { type: 'move', index: (i - 1 + n) % n };
  if (key === 'Enter') return { type: 'pick', item: options[i] };
  return null;
}

export function SpotlightPanel({
  id, context, items, onPick, onClose, formulaSlot = null, step = null,
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [expanded, setExpanded] = useState(NO_EXPANDED);
  const [dismissedStep, setDismissedStep] = useState(null);
  const storedFormula = formulaSlot?.value?.kind === 'formula' ? formulaSlot.value : null;
  const [formulaOpen, setFormulaOpen] = useState(() => !!storedFormula);
  const [formulaVisited, setFormulaVisited] = useState(() => !!storedFormula);
  const formulaInvalid = useRef(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const formulaRef = useRef(null);
  const popups = usePopups();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The caller owns `step`; typing has to leave it without asking the caller to
  // take it back. Remembering WHICH step was typed past (rather than a boolean)
  // means a new one from the caller shows on its own.
  const activeStep = step && step !== dismissedStep ? step : null;
  const { rows, options } = useMemo(
    () => spotlightRows(items, { query, expanded }), [items, query, expanded],
  );
  const active = options.length ? Math.min(activeIdx, options.length - 1) : -1;
  const showList = !activeStep && !formulaOpen && rows.length > 0;
  const listId = `${id}-list`;
  const optionId = (i) => `${id}-opt-${i}`;

  // Read by the window listener, which closes over the render it was created in.
  const stateRef = useRef(null);
  stateRef.current = { query, options, activeIdx: active, step: activeStep };

  useLayoutEffect(() => {
    function onEscape(e) {
      if (e.key !== 'Escape') return;
      // An open suggestion list in the formula field is the field's: its own handler dismisses
      // the list and stops the key. The search is a combobox too, and ITS list is this panel's.
      if (e.target !== inputRef.current && openCombobox(e.target)) return;
      if (openNativeSelect(e.target)) { e.stopPropagation(); return; }
      // A chip settings panel open inside this Spotlight is a popup of its own and takes the
      // Escape aimed at it. This panel's root carries the same marker, and an Escape inside it
      // (the search, an option, the formula content) is this panel's own.
      const marked = e.target?.closest?.('[data-dp-popup="1"]');
      if (marked && marked !== rootRef.current) return;
      // A formula dialog opened from an inline field is a child modal. Let that
      // dialog consume Escape so cancelling it cannot also close this Spotlight.
      if (e.target?.closest?.('[data-dp-modal="1"]')) return;
      e.stopPropagation();
      if (spotlightKey('Escape', stateRef.current)?.type === 'clear') {
        setQuery('');
        setActiveIdx(0);
        return;
      }
      onCloseRef.current?.();
    }
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, []);

  // Stable functions, not the coordinator OBJECT: its memo lists `openId`, so the
  // object changes identity on every transition and depending on it would make this
  // popup unregister and re-register — re-opening itself over whatever had just
  // replaced it. (Popover.jsx carries the same three lines and the same reason.)
  const openPopup = popups?.open;
  const closePopup = popups?.close;
  const registerPortal = popups?.registerPortal;
  useEffect(() => {
    if (!openPopup) return undefined;
    openPopup(id, () => onCloseRef.current?.());
    const drop = registerPortal(id, rootRef.current);
    return () => { closePopup(id); drop(); };
  }, [openPopup, closePopup, registerPortal, id]);

  // `aria-modal="true"` is a PROMISE that nothing behind this is reachable, and the
  // drawer's focus trap alone does not keep it: the trap's roots are the drawer AND
  // every registered portal, so Tab would walk from the Spotlight back into the
  // drawer under the scrim. Inerting the rest makes the promise true and fixes the
  // trap at the same time — `reachable` drops an inert stop, so the cycle the
  // drawer rebuilds on the next Tab is the Spotlight's own. `keep` is the SCRIM,
  // which is a direct child of <body>, so the walk marks exactly its siblings
  // (#root, and any other body-level popup) and stops.
  useInertBackground(true, [rootRef]);
  useOpenerRestore(true);
  // The search owns focus on initial open and again when Back replaces the
  // formula workspace with the map.
  useFocusOnOpen(rootRef, !formulaOpen, inputRef);
  // The formula tile replaces its own trigger the same way the counter does, so
  // focus moves into what it opened — the first control of the editor, which is
  // where someone who just asked for a formula wants to be typing.
  useFocusOnOpen(formulaRef, formulaOpen);

  function onQueryChange(e) {
    setQuery(e.target.value);
    // The arrows go back to the top of a list that is no longer the same list —
    // which is also what makes Enter take the FIRST enabled match (§4).
    setActiveIdx(0);
    setDismissedStep(step);
  }

  function onKeyDown(e) {
    // Escape is not here: the capture listener above consumes it before React
    // dispatches, so a branch for it would be dead code that reads live.
    if (e.key === 'Escape') return;
    const action = spotlightKey(e.key, stateRef.current);
    if (!action) return;
    e.preventDefault();
    if (action.type === 'move') setActiveIdx(action.index);
    else if (action.type === 'pick') onPick?.(action.item);
  }

  // The counter button REPLACES itself with the rows it was hiding, so whoever
  // activated it is left holding a node that is gone — and focus on <body> inside a
  // trapped dialog sends the next Tab to the top of the cycle. It goes back to the
  // input, which is also where it has to be for the arrows to walk the map.
  const expand = (g) => {
    setExpanded((prev) => new Set(prev).add(g));
    inputRef.current?.focus({ preventScroll: true });
  };

  const fieldSet = formulaSlot?.fieldSet || null;
  // FormulaField derives its own field set from (contextKind, isDim), so `fieldSet`
  // on the slot is the caller naming which FACE it wants. Read by CONTENT and not
  // by identity: a dim caller may hand a SUPERSET of the dim set (dimFieldSetFor
  // adds the source's own custom metrics), and an identity test would call that the
  // time-series face and offer the expected/plan fields — which have no per-dim
  // curve and read as a silent 0 in a dim bucket. Missing anything the full
  // time-series set has ⇒ the dim face.
  const isDim = !!fieldSet
    && [...fieldSetFor(formulaSlot.contextKind, false)].some((f) => !fieldSet.has(f));
  const formulaFields = fieldSet || fieldSetFor(formulaSlot?.contextKind, isDim);

  return (
    <div
      ref={rootRef}
      id={id}
      data-dp-popup="1"
      className="sp-spot-scrim"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}
    >
      <div className="sp-spot" role="dialog" aria-modal="true" aria-label="Add">
        <div className="sp-spot-top">
          <i className="ri-search-line sp-spot-icon" aria-hidden="true" />
          {formulaOpen ? (
            <div className="sp-spot-search sp-spot-search--label">{FORMULA_TITLE}</div>
          ) : (
            <input
              ref={inputRef}
              type="text"
              className="sp-spot-search"
              value={query}
              onChange={onQueryChange}
              onKeyDown={onKeyDown}
              placeholder={PLACEHOLDER}
              autoComplete="off"
              role="combobox"
              aria-expanded={showList}
              aria-autocomplete="list"
              aria-controls={showList ? listId : undefined}
              aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            />
          )}
          {context?.label ? <span className="sp-spot-ctx">{context.label}</span> : null}
        </div>

        <div className="sp-spot-body">
          {activeStep ? (
            <div className="sp-spot-step">
              <div className="sp-spot-q">{activeStep.question}</div>
              <div className="sp-spot-opts">
                {/* An option the caller cannot honour is DISABLED with its reason in place
                    (§1.1.3), never missing: «Both sources» adds two elements, and a reader
                    who has read about it must find out why it is not offered rather than
                    look for it. */}
                {(activeStep.options || []).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`sp-spot-opt${option.disabled ? ' sp-spot-opt--off' : ''}`}
                    disabled={!!option.disabled}
                    title={option.reason || undefined}
                    onClick={() => activeStep.onPick?.(option)}
                  >
                    {option.label}
                    {option.disabled && option.reason
                      ? <span className="sp-spot-opt-rs">{option.reason}</span>
                      : null}
                  </button>
                ))}
              </div>
              <div className="sp-spot-back">{BACK_HINT}</div>
            </div>
          ) : null}

          {showList ? (
            <div className="sp-spot-grid" role="listbox" id={listId} aria-label={context?.label || 'Add'}>
              {/* Keys are kind-prefixed, and the two rows that carry no id of their
                  own take the row index: a group name repeated by the caller, or an
                  item that is enabled in one group and unavailable in another, are
                  both legal maps — and duplicate keys would drop one of the pair. */}
              {rows.map((row, i) => {
                if (row.kind === 'group') {
                  // Plain muted text, never a rail or a bar (project ban), and
                  // aria-hidden because a listbox's children are its options.
                  return <div key={`g:${i}`} className="sp-spot-g" aria-hidden="true">{row.g}</div>;
                }
                if (row.kind === 'more') {
                  return (
                    <button
                      key={`m:${i}`}
                      type="button"
                      className="sp-spot-more"
                      aria-expanded="false"
                      onClick={() => expand(row.g)}
                    >
                      {`▸ ${row.count} unavailable here`}
                    </button>
                  );
                }
                const off = row.kind === 'off';
                const { item } = row;
                const on = !off && row.optIdx === active;
                const note = off ? item.reason : item.note;
                return (
                  <div
                    key={`${off ? 'off' : 'opt'}:${item.id}`}
                    id={off ? undefined : optionId(row.optIdx)}
                    role="option"
                    aria-selected={off ? undefined : on}
                    aria-disabled={off ? true : undefined}
                    className={`sp-spot-it${off ? ' sp-spot-it--off' : ''}${on ? ' sp-spot-it--on' : ''}`}
                    onMouseEnter={off ? undefined : () => setActiveIdx(row.optIdx)}
                    onClick={off ? undefined : () => onPick?.(item)}
                  >
                    <span className="sp-spot-fam" aria-hidden="true">{item.family || '#'}</span>
                    <span className="sp-spot-nm">
                      <span className="sp-spot-lbl">{item.label}</span>
                      {note ? <span className="sp-spot-rs">{note}</span> : null}
                    </span>
                    {item.chips?.length ? (
                      <span className="sp-spot-chips">
                        {item.chips.map((chip) => (
                          <span
                            key={chip.id}
                            className={`sp-spot-chip${chip.off ? ' sp-spot-chip--off' : ''}`}
                            title={chip.title || undefined}
                          >
                            {chip.label}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {!activeStep && !formulaOpen && rows.length === 0 && query.trim()
            ? <div className="sp-spot-empty">{`Nothing matches “${query.trim()}”`}</div>
            : null}

          {!activeStep && formulaSlot ? <>
            {formulaVisited && (
              <div className={`sp-spot-fx${formulaOpen ? ' sp-spot-fx--open' : ''}`} ref={formulaRef}
                hidden={!formulaOpen} inert={formulaOpen ? undefined : ''}
                style={formulaOpen ? undefined : { display: 'none' }}>
                <FormulaEditorContent
                  // The stored value is the holder (formula chips P1-editor): the content reads
                  // its `expr` and `chips` and ignores `kind` and `unitFamily`, which are its own props.
                  value={storedFormula || ''}
                  unitFamily={storedFormula?.unitFamily ?? DEFAULT_FAMILY}
                  contextKind={formulaSlot.contextKind}
                  fieldSet={formulaFields}
                  fieldLabels={formulaSlot.fieldLabels}
                  cm={formulaSlot.cm}
                  cmRefusal={formulaSlot.cmRefusal}
                  cmUnavailable={formulaSlot.cmUnavailable}
                  grain={formulaSlot.grain}
                  slot={formulaSlot.slot || 'value'}
                  previewFormula={formulaSlot.previewFormula}
                  availableMetrics={formulaSlot.availableMetrics}
                  requireValue
                  applyLabel={formulaSlot.value ? 'Apply' : 'Add'}
                  cancelLabel="Back"
                  onApply={(stored, family) => formulaSlot.onCommit?.(stored, family)}
                  onCancel={() => {
                    formulaSlot.onDraftState?.(false);
                    setFormulaOpen(false);
                  }}
                  onDraftState={(invalid) => {
                    formulaInvalid.current = !!invalid;
                    if (formulaOpen) formulaSlot.onDraftState?.(!!invalid);
                  }}
                />
              </div>
            )}
            {!formulaOpen && (
              // Closed by default: the formula slot is the escape hatch, never the
              // front door (§1.1.6), and it opens in place at the bottom of the map.
              <button type="button" className="sp-spot-fx" onClick={() => {
                setFormulaVisited(true);
                setFormulaOpen(true);
                formulaSlot.onDraftState?.(formulaInvalid.current);
              }}>
                <span className="sp-spot-fam" aria-hidden="true">ƒ</span>
                <span className="sp-spot-nm">
                  <span className="sp-spot-lbl">{FORMULA_TITLE}</span>
                  <span className="sp-spot-rs">{FORMULA_NOTE}</span>
                </span>
              </button>
            )}
          </> : null}
        </div>
      </div>
    </div>
  );
}

export default function Spotlight({
  open, context, items, onPick, onClose, formulaSlot = null, step = null, id,
}) {
  const autoId = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <SpotlightPanel
      id={id || `sp-spot-${autoId}`}
      context={context}
      items={items}
      onPick={onPick}
      onClose={onClose}
      formulaSlot={formulaSlot}
      step={step}
    />,
    document.body,
  );
}
