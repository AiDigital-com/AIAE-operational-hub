// workspace/src/pages/Dashboard/components/Settings/Widgets/TokenField.jsx — the chip field (spec §6.3).
// Plain data under it (chips/tokens.js): tokens, a caret, one word being typed in a hidden input.
// Chips are buttons (a click opens their settings), operators and numbers are text, the
// suggestion list is a combobox listbox inline under the field, so a headless test can read it.
// The host owns the draft: a change that alters the holder is handed to `onChange` inside the
// event that made it (not from an effect: the host suites run no effects between two
// keystrokes), with the word still being typed appended as a word token, so a half-typed word
// rides in the host's draft and nothing typed is lost (spec §6.3).
// Three ways text reaches the parser (decision m): keystrokes run the word buffer; paste and a
// drop land at the caret; a FILL (the hidden input handed a whole value, as a suite or a gate
// does and as the input this field replaces was filled) REPLACES the field's content.
import { useId, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { initialState, reduce, holderFromTokens, textOf, suggest, tokensFromHolder, resolvedTokens, numText, chipKey } from '../chips/tokens.js';
import { chipFace, chipTip } from '../chips/info.js';
import './TokenField.css';

const OP_CHARS = new Set(['+', '-', '*', '/', '(', ')', ',', '<', '>', '=', '!']);
// The first key of a two-character comparison (`<=`, `>=`, `==`, `!=`): the field waits for the '='.
const HALF_COMPARISON = new Set(['<', '>', '=', '!']);
const MOVES = { ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' };
const sameHolder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The tokens the host's draft is made of: the committed ones with the pending word at the caret.
const draftTokens = (s) => (s.word ? [...s.tokens.slice(0, s.caret), { t: 'word', text: s.word }, ...s.tokens.slice(s.caret)] : s.tokens);
const holderOf = (s) => holderFromTokens(draftTokens(s));
// One step of the field. `fill` is the field's own step over the reducer: the whole content is
// replaced by what the parser reads (the same read as a paste), the caret stands at the end and
// one history entry is kept (the reducer's own cap of 50 applies), so undo brings the previous
// formula back. Everything else is the reducer's.
function step(s, action, placement, env) {
  if (action.type !== 'fill') return reduce(s, action, placement, env);
  // A fill replaces everything, so the text alone decides its CM360 reading (tokensFromText
  // reads `im` as the matched half beside a CM name), not the chips it replaces.
  const tokens = tokensFromHolder(action.text, { ...placement, cm: false });
  return { ...s, tokens, caret: tokens.length, selection: null, word: '', active: 0, history: [...s.history.slice(-49), { tokens: s.tokens, caret: s.caret }], future: [] };
}
// The ref each chip token gets, by holderFromTokens's own rule: first appearance, equal chips share one.
function refsOf(tokens) {
  const seen = new Map();
  return tokens.map((tk) => {
    if (tk.t !== 'chip') return null;
    const k = chipKey(tk.chip);
    if (!seen.has(k)) seen.set(k, `_c${seen.size + 1}`);
    return seen.get(k);
  });
}

/** The field's state as a hook, for a host that draws its own frame. `onChange(holder)` fires on
 *  every reducer step that changes the holder, `onDraft({ tokens, word })` on every step;
 *  `dispatch` answers whether the step changed anything. A `value` from the host replaces the
 *  tokens only when it READS as another formula: both sides go through the same read path (text
 *  or holder → tokens → holder), so the host's echo of this field's own draft, the stored legacy
 *  spelling of the same formula (the gate commits a valid draft on every keystroke and the slot
 *  may store it as text), and the same chips on another placement leave the caret and the
 *  half-typed word alone; a reset, another slot, or a placement that reads the text as other
 *  chips replace them. */
export function useTokenField(value, placement, env, { onChange, onDraft } = {}) {
  const [state, setState] = useState(() => initialState(tokensFromHolder(value, placement)));
  // What the reducer reads: two dispatches inside one event each see the other's result, which
  // React's queued state cannot give until the next render. Written only where the state is.
  const live = useRef(state);
  useEffect(() => {
    const read = (h) => holderFromTokens(tokensFromHolder(h, placement));
    if (sameHolder(read(value), read(holderOf(live.current)))) return;
    const fresh = initialState(tokensFromHolder(value, placement));
    live.current = fresh;
    setState(fresh);
  }, [value, placement]);
  const dispatch = (action) => {
    const prev = live.current;
    const next = step(prev, action, placement, env);
    if (next === prev) return false;
    live.current = next;
    setState(next);
    onDraft?.({ tokens: next.tokens, word: next.word });
    const holder = holderOf(next);
    if (!sameHolder(holderOf(prev), holder)) onChange?.(holder);
    return true;
  };
  const holder = useMemo(() => holderOf(state), [state]);
  // `current()` is the state after the last dispatch, for a caller inside the same event.
  return { state, dispatch, holder, legacyText: textOf(state.tokens, placement), current: () => live.current };
}

export default function TokenField({
  value, placement, env, label = 'Formula', onChange, onDraft, onOpenChip, selectedChip = null,
  invalidRefs = null, refusedRef = null, ariaDescribedBy, ariaInvalid, autoFocus = false, disabled = false,
  // The hint an empty field shows, as the input this field replaces did.
  placeholder = 'e.g. sp / im * 1000',
  // A host's own ref for the hidden input (the formula dialog focuses it on open), used in place
  // of this field's; and a plain ref object the field fills with `{ paste(text), focus() }` so
  // the host's palette and drag-drop insert at the caret without lifting the field's state.
  inputRef: externalInputRef = null, actions = null,
  // The hidden input's id, so a host's visible <label htmlFor> focuses the field on a click.
  inputId,
}) {
  const field = useTokenField(value, placement, env, { onChange, onDraft });
  const { state } = field;
  const listId = useId();
  const ownInputRef = useRef(null);
  const inputRef = externalInputRef || ownInputRef;
  // The input stands at the caret, so a step that moves the caret (an arrow, a word committed
  // mid-formula, a click in a gap) moves the input node among its siblings, and a browser blurs
  // a node the moment it is re-inserted. The focus the input had is given back before paint;
  // only when the input itself was active, so a click on a chip keeps the focus on the chip for
  // its panel.
  const refocus = useRef(false);
  const dispatch = (action) => {
    refocus.current = typeof document !== 'undefined' && !!inputRef.current && document.activeElement === inputRef.current;
    const changed = field.dispatch(action);
    if (!changed) refocus.current = false;
    return changed;
  };
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    inputRef.current?.focus();
  }, [state]);
  // Escape closes the list and keeps the word (spec §6.3: typed text is never dropped); the next key reopens it.
  const [dismissed, setDismissed] = useState(null);
  const suggestions = useMemo(() => (state.word ? suggest(state.word, placement, env) : []), [state.word, placement, env]);
  const open = suggestions.length > 0 && dismissed !== state.word;
  const active = Math.min(state.active, Math.max(0, suggestions.length - 1));
  // The ref each chip carries in the HOST's draft: read off the draft as the host reads it, so a
  // pending legacy word (the chip it commits to, with a ref of its own) numbers the chips after
  // it the way the host's gate does and an outline the host reports lands on the right chip;
  // the word's own slot is dropped. A draft the text reads as other tokens keeps the field's own count.
  const refs = useMemo(() => {
    const all = refsOf(resolvedTokens(holderOf(state), placement));
    const own = state.word ? [...all.slice(0, state.caret), ...all.slice(state.caret + 1)] : all;
    return own.length === state.tokens.length ? own : refsOf(state.tokens);
  }, [state, placement]);
  const bad = (ref) => !!ref && ((refusedRef != null && ref === refusedRef) || (!!invalidRefs && invalidRefs.has(ref)));
  const focusInput = () => inputRef.current?.focus();
  // The host's handle, renewed every render so it never dispatches on a stale closure; cleared
  // when the field goes away. `commit()` lands the word still being typed (as a space would) and
  // answers the draft after it, or null when there was none: a host's Apply reads that holder
  // inside the same event, before the render that would show it.
  useLayoutEffect(() => {
    if (!actions) return undefined;
    actions.current = {
      paste: (text) => dispatch({ type: 'paste', text }),
      focus: focusInput,
      commit: () => (dispatch({ type: 'commit' }) ? holderOf(field.current()) : null),
    };
    return () => { actions.current = null; };
  });
  const commitWord = () => {
    const pick = open && !suggestions[active].reason ? suggestions[active] : undefined;
    dispatch({ type: 'commit', pick });
  };
  // Leaving the field lands the word where it stands, as a space would, so what the host stores
  // is the chip the word spells and not its letters. A press on a chip of this field (Chrome
  // moves the focus to the button) or on its suggestion list is not a leave.
  const onBlur = (event) => {
    if (!state.word) return;
    const to = event.relatedTarget;
    if (to && typeof to.closest === 'function' && to.closest('.wgf-tf-wrap')) return;
    dispatch({ type: 'commit' });
  };

  const onInput = (event) => {
    const text = event.target.value;
    const word = state.word;
    setDismissed(null);
    if (text.length > word.length + 1) {
      // The word grown by several characters at once (a predictive keyboard, an IME) is still the
      // word; any other whole value is a fill and replaces the content (see the header).
      const grown = !!word && text.startsWith(word) && ![...text.slice(word.length)].some((c) => OP_CHARS.has(c) || c === ' ');
      dispatch(grown ? { type: 'word', text } : { type: 'fill', text });
      return;
    }
    const appended = text.length === word.length + 1 && text.startsWith(word);
    if (!appended) {
      // An edit inside the word (the input's own caret moved): a plain word, or the parser when an operator got in.
      if ([...text].some((c) => OP_CHARS.has(c) || c === ' ')) { dispatch({ type: 'word', text: '' }); dispatch({ type: 'paste', text }); }
      else dispatch({ type: 'word', text });
      return;
    }
    const last = text.slice(-1);
    const half = HALF_COMPARISON.has(word.slice(-1)) ? word.slice(-1) : '';
    if (half) {
      // The pending half closes now: as the two-character comparison when '=' follows, else on its own.
      dispatch({ type: 'word', text: word.slice(0, -1) });
      if (last === '=') { dispatch({ type: 'op', v: `${half}=` }); return; }
      dispatch({ type: 'op', v: half });
      if (last === ' ') return;
      if (HALF_COMPARISON.has(last)) { dispatch({ type: 'word', text: last }); return; }
      if (OP_CHARS.has(last)) { dispatch({ type: 'op', v: last }); return; }
      dispatch({ type: 'word', text: last });
      return;
    }
    if (last === ' ') { dispatch({ type: 'commit' }); return; }
    if (HALF_COMPARISON.has(last)) { dispatch({ type: 'word', text }); return; }   // wait for a possible '='
    if (OP_CHARS.has(last)) { dispatch({ type: 'op', v: last }); return; }   // the operator commits the word first
    dispatch({ type: 'word', text });
  };
  const onKeyDown = (event) => {
    const k = event.key;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && (k === 'z' || k === 'Z')) { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
    if (meta && (k === 'y' || k === 'Y')) { event.preventDefault(); dispatch({ type: 'redo' }); return; }
    // Cmd+Left / Cmd+Right are the Mac's Home and End; with a word pending the input's own caret takes them.
    if (meta && !state.word && (k === 'ArrowLeft' || k === 'ArrowRight')) { event.preventDefault(); dispatch({ type: k === 'ArrowLeft' ? 'home' : 'end' }); return; }
    if (meta) return;   // the host's own shortcuts (Ctrl/Cmd+Enter applies)
    if (k === 'Enter' || (k === 'Tab' && state.word)) {
      if (state.word || open) { event.preventDefault(); commitWord(); }
      return;   // a bare Enter or Tab is the host's
    }
    if (k === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setDismissed(state.word); }
      return;
    }
    if (k === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      if (!open) setDismissed(null);
      else if (active < suggestions.length - 1) dispatch({ type: 'activeDown' });
      return;
    }
    if (k === 'ArrowUp' && open) { event.preventDefault(); if (active > 0) dispatch({ type: 'activeUp' }); return; }
    if (state.word) return;   // inside a word the input's own caret and editing apply
    const move = MOVES[k];
    if (move) { event.preventDefault(); dispatch({ type: move }); return; }
    if (k === 'Backspace') { event.preventDefault(); dispatch({ type: 'backspace' }); return; }
    if (k === 'Delete') { event.preventDefault(); dispatch({ type: 'delete' }); }
  };
  const onPaste = (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    dispatch({ type: 'paste', text });
  };
  // Text dropped on the input lands at the caret like a paste; left to the browser it would
  // become the input's value and read as a fill, replacing the formula.
  const onDrop = (event) => {
    const text = event.dataTransfer?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    focusInput();
    dispatch({ type: 'paste', text });
  };
  // The clipboard gets the legacy spelling where one exists, the chip's face elsewhere (decision o):
  // the selected chip alone when one is selected, the whole formula otherwise. A selection inside
  // the word being typed is the input's own copy.
  const onCopy = (event) => {
    if (state.word) return;
    const text = state.selection != null ? textOf([state.tokens[state.selection]], placement) : textOf(state.tokens, placement);
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  };
  const onFieldCopy = (event) => { if (!event.defaultPrevented && event.target?.tagName !== 'INPUT') onCopy(event); };

  const nodes = [];
  // An empty field prints its hint beside the caret slot; the first typed character replaces it.
  if (!state.tokens.length && !state.word && placeholder) nodes.push(<span key="ph" className="wgf-tf-ph" aria-hidden="true">{placeholder}</span>);
  // Focus first, then move the caret: the step may move the input node, and the focus it has at
  // that moment is the one the layout effect above gives back.
  const gap = (index) => (
    <span key={`g${index}`} className="wgf-tf-gap" aria-hidden="true"
      onMouseDown={(e) => { e.preventDefault(); focusInput(); dispatch({ type: 'caret', index }); }} />
  );
  // A press on a text token (an operator, a number, a function name, a red word) places the
  // caret at the nearer of its two sides, as a press on a letter does in a text field; without
  // it the browser default would blur the hidden input and the caret would vanish.
  const placeBeside = (index) => (e) => {
    e.preventDefault();
    focusInput();
    const rect = e.currentTarget?.getBoundingClientRect?.();
    const after = !rect || e.clientX > rect.left + rect.width / 2;
    dispatch({ type: 'caret', index: after ? index + 1 : index });
  };
  // The field's own surface: a press anywhere but the input or a chip keeps the focus in the
  // input (the token handlers above have placed the caret by then); the empty area moves it to the end.
  const onFieldMouseDown = (e) => {
    const t = e.target;
    if (t === inputRef.current || (t && t.closest && t.closest('button'))) return;
    e.preventDefault();
    focusInput();
    if (t === e.currentTarget) dispatch({ type: 'end' });
  };
  for (let i = 0; i <= state.tokens.length; i++) {
    if (i === state.caret) {
      // The bar stands in for the input's caret between tokens; while a word is typed the input shows its own.
      if (!state.word) nodes.push(<span key="caret" className="wgf-tf-caret" aria-hidden="true" />);
      nodes.push(<input key="input" ref={inputRef} id={inputId} className={`wgf-tf-input${state.word ? ' wgf-tf-input--word' : ''}`} role="combobox"
        aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={ariaInvalid || undefined} aria-describedby={ariaDescribedBy} autoFocus={autoFocus} disabled={disabled}
        value={state.word} spellCheck={false} autoComplete="off" autoCapitalize="none" autoCorrect="off"
        style={{ width: `${Math.max(1, state.word.length + 1)}ch` }}
        onChange={onInput} onKeyDown={onKeyDown} onBlur={onBlur} onPaste={onPaste} onDrop={onDrop} onCopy={onCopy} />);
    } else nodes.push(gap(i));
    const tk = state.tokens[i];
    if (!tk) continue;
    if (tk.t === 'chip') {
      const face = chipFace(tk.chip);
      const selected = state.selection === i || selectedChip === i;
      // The host reads its draft with the word still being typed riding at the caret as a token
      // of its own, so the index it is handed counts that word where it stands before this chip.
      const draftIndex = state.word && state.caret <= i ? i + 1 : i;
      // The face prints the non-default settings; the full list, defaults included, shows on
      // hover (the native title: one setting per line), so a clipped long face is still readable.
      nodes.push(<button key={`t${i}`} type="button"
        className={`wgf-tf-chip${selected ? ' wgf-tf-chip--sel' : ''}${bad(refs[i]) ? ' wgf-tf-chip--bad' : ''}`}
        aria-label={`${face}. Open settings`} title={chipTip(tk.chip)}
        onClick={(e) => { dispatch({ type: 'select', index: i }); onOpenChip?.(draftIndex, e.currentTarget); }}>{face}</button>);
    } else if (tk.t === 'word') {
      nodes.push(<span key={`t${i}`} className="wgf-tf-word wgf-tf-word--bad" title={`Unknown field "${tk.text}"`} onMouseDown={placeBeside(i)}>{tk.text}</span>);
    } else {
      nodes.push(<span key={`t${i}`} className={tk.t === 'num' ? 'wgf-tf-num' : tk.t === 'fn' ? 'wgf-tf-fn' : 'wgf-tf-op'} onMouseDown={placeBeside(i)}>
        {tk.t === 'num' ? numText(tk.v) : tk.t === 'fn' ? tk.name : tk.v}
      </span>);
    }
  }
  return (
    <div className="wgf-tf-wrap">
      <div className={`wgf-tf${disabled ? ' wgf-tf--disabled' : ''}`} data-formula-field="1" data-legacy-text={field.legacyText}
        onMouseDown={onFieldMouseDown} onCopy={onFieldCopy}>
        {nodes}
      </div>
      {open ? (
        <ul id={listId} className="wgf-tf-sugg" role="listbox" aria-label="Suggestions">
          {suggestions.map((s, i) => (
            <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-disabled={s.reason ? true : undefined}
              className={`wgf-tf-opt${i === active ? ' wgf-tf-opt--on' : ''}${s.reason ? ' wgf-tf-opt--off' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); if (!s.reason) { focusInput(); dispatch({ type: 'commit', pick: s }); } }}>
              <span className="wgf-tf-opt-face">{s.face}</span>
              {s.alias && s.alias !== s.face ? <span className="wgf-tf-opt-alias"> · {s.alias}</span> : null}
              {s.reason ? <span className="wgf-tf-opt-why">{s.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
