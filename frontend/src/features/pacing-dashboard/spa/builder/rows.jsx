// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/rows.jsx
//
// The three row primitives every builder popover is made of (widget-builder v2 §3, mockup
// §2): a labelled row, a segmented choice, and the eight-slot colour picker. They live here
// rather than inside one popover because T6-T10 open five of these panels on the same
// grammar — a series, a column, a KPI, a pie slice, a compare view — and a second row shape
// would make two panels that answer the same kind of question look like two products.
//
// A SEGMENT is a real radio group, not a row of toggle buttons: `role="radiogroup"` with
// `aria-checked` is what tells a screen reader that these three are one setting with one
// answer — and the group KEEPS that promise with the keyboard too (§10.3): one Tab stop for
// the whole group and the arrows walking inside it, which is what the role makes a reader
// expect. THE COLOUR PALETTE IS THE SAME CONTROL and reads the same `radioKeys`; it claimed
// the role with nine Tab stops and inert arrows until this fix wave. Colour is never the
// only distinction — the chosen segment carries the accent AND its pressed state, and the
// palette's chosen slot carries a check.
import { useId } from 'react';
import { COLOR_SLOTS, SEMANTIC_PAINTS } from '../report-v2.js';

/** One labelled row. The label is a `<span>` and the control names itself through
 *  `aria-label`: a `<label>` cannot point at a radiogroup, and a row that lied about the
 *  relationship would be worse than one that states it twice.
 *
 *  `noteId` is for the rows whose note is a REFUSAL: the refused control names it through
 *  `aria-describedby`, so the sentence a reader sees and the one an AT announces are the
 *  same node rather than two copies (§10.3). */
export function PopRow({ label, children, note, noteId }) {
  return (
    <div className="sp-pop-row">
      <span className="sp-pop-lbl">{label}</span>
      <span className="sp-pop-ctl">{children}</span>
      {note ? <span className="sp-pop-why" id={noteId}>{note}</span> : null}
    </div>
  );
}

/**
 * The arrow walk a `role="radiogroup"` PROMISES (§10.3, WAI-ARIA's radio pattern): ←→↑↓ move
 * between the options and choose as they go, Home and End jump to the ends. One function
 * because `Seg` and `PopColors` are the same control in two shapes, and a group that claimed
 * the role without the keys would be telling a screen-reader user «radio group, 1 of 9» and
 * then answering every arrow with nothing.
 *
 *   n         how many options the group has
 *   refused   `(i) => reason|falsy` — a refused option is STEPPED OVER: it keeps its place,
 *             its dimming and its sentence for a reader arriving by pointer, but an arrow
 *             whose press cannot change anything would be a walk that stops for no reason
 *   pick      `(i) => void` — the caller chooses; focus follows, which is the pattern
 */
function radioKeys({ n, refused, pick }) {
  // The next option an arrow may land on, wrapping. -1 when there is none — every option
  // refused, or this the only one that is not.
  const step = (from, dir) => {
    for (let k = 1; k <= n; k += 1) {
      const j = ((from + dir * k) % n + n) % n;
      if (!refused(j) && j !== from) return j;
    }
    return -1;
  };
  return (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const end = { Home: 1, End: -1 }[e.key];
    if (dir === undefined && end === undefined) return;
    const btns = [...e.currentTarget.querySelectorAll('[role="radio"]')];
    const from = btns.indexOf(document.activeElement);
    if (from < 0) return;
    // Taken whether or not it moves anything: ↑↓ inside a radiogroup must not scroll the
    // panel out from under the group the reader is standing in.
    e.preventDefault();
    const to = end === undefined ? step(from, dir) : step(end === 1 ? -1 : n, end);
    if (to < 0 || to === from) return;
    btns[to].focus();
    pick(to);
  };
}

/**
 * A segmented choice over `options` — `[value, label]` pairs, or `[value, label, reason]`
 * where the third member is why that segment cannot be chosen here (§1.1.3: refused WITH
 * its reason, never missing).
 *
 * The reason is PRINTED under the segments and the refused button points at it
 * (§10.3, T13). It used to ride on `title` alone, on a `disabled` button — which is a
 * reason only a pointer can reach, on a control a keyboard cannot even land on. So a
 * refused segment keeps its Tab stop (`aria-disabled`), and `onPick` is guarded, which is
 * what makes the attribute true.
 *
 * `describedBy` is the id of the sentence the ROW already prints. The caller owns it,
 * because that is where a reader sees it (`PopRow note`) and because the control column
 * does not wrap — a visible note rendered in here would sit beside the segments and squash
 * them. The two callers that ever hand a reason (`AxisRow`, `DeltaRow`) mint one id and
 * give it to both halves; a caller that forgets falls through to the clipped span below,
 * which is a floor and not a substitute — a sentence only a screen reader can reach is
 * half a reason.
 *
 * `.sp-seg` and not `.sp-pop-seg`: it was born in these panels but a segmented choice is a
 * control, not a popover row — the chart card's own Orientation toggle is the same control
 * outside any popover, and two stylesheets for one shape is how two of them start to differ.
 *
 * THE KEYBOARD (§10.3): a radiogroup is ONE Tab stop, not one per option — the tabbable
 * button is the one holding the answer — and ←→↑↓ / Home / End walk it, choosing as they
 * go, which is the radio pattern and the reason the role is worth claiming. Refused
 * options are stepped OVER rather than landed on: they keep their place, their dimming and
 * their sentence for a reader who arrives by pointer or by walking the DOM, but an arrow
 * whose press cannot change anything would be a walk that stops for no reason.
 */
export function Seg({ label, value, options, onPick, describedBy, stack }) {
  // The FLOOR under `describedBy`, never the plan: a caller that refuses an option and
  // passes no id would otherwise ship an `aria-disabled` button explaining nothing — the
  // exact shape §10.3 exists to forbid, and the one thing no test would catch. When the
  // row printed no sentence this group carries the grammar's own words in a clipped span
  // of its own. Off-screen and not `display: none`, because a hidden node is hidden from
  // AT too. A wired caller renders none of these: the reason belongs where a reader looks.
  const uid = useId();
  const whyId = (i) => (describedBy || `${uid}-why-${i}`);
  // Where the single Tab stop sits: on the answer, or — with none, or a refused one — on
  // the first option a press could actually reach.
  const answer = options.findIndex((o) => o[0] === value);
  const first = options.findIndex((o) => !o[2]);
  const roving = answer >= 0 ? answer : Math.max(first, 0);
  const onKeyDown = radioKeys({
    n: options.length,
    refused: (i) => options[i][2],
    pick: (i) => onPick(options[i][0]),
  });
  // ONE flat children array, not «the buttons, then the fallbacks»: a wired group (which
  // is every one of them today) renders exactly the children it always did, so nothing
  // reading this markup has to learn a second shape for a case it never meets.
  const kids = options.map(([v, text, why], i) => (
    <button
      key={String(v)}
      type="button"
      role="radio"
      aria-checked={v === value}
      tabIndex={i === roving ? 0 : -1}
      className={`sp-seg-b${v === value ? ' sp-seg-b--on' : ''}`}
      aria-disabled={why ? true : undefined}
      aria-describedby={why ? whyId(i) : undefined}
      onClick={() => { if (!why) onPick(v); }}
    >
      {text}
    </button>
  ));
  if (!describedBy) {
    options.forEach(([v, , why], i) => {
      if (why) kids.push(<span key={`why-${String(v)}`} className="sp-rb-sr" id={whyId(i)}>{why}</span>);
    });
  }
  return (
    <span className={`sp-seg${stack ? ' sp-seg--stack' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {kids}
    </span>
  );
}

/**
 * WHERE an element sits among its siblings — one row, the ▲▼ pair, and the position said
 * in words (§10.3: colour and enablement are never the only distinction, and «2 of 3» is
 * what tells a reader which end they are at without pressing anything).
 *
 * Decision 17 puts the reorder in the popover rather than on the row: a series row already
 * carries a name, a summary and an ×, and two more glyphs on it would make the list the
 * thing you operate instead of the thing you read. This is the ONLY path — there is no drag
 * — so it is a keyboard path by construction, and it is the same pair `ViewFrame` wears one
 * level up, with the same end rule and the same aria-label shape.
 *
 * THE END OF THE LIST IS NOT `disabled` (§10.3, T13 fix round). The arrow you are standing
 * on is the arrow that reaches the end: press ▼ until the series is last and a natively
 * disabled button loses its focus to <body> mid-interaction, and the next Tab starts from
 * the top of the dialog. It keeps its Tab stop, `aria-disabled`, a guarded handler, and
 * `aria-describedby` at the caption beside it — «2 of 2» IS the reason, and it is already
 * on screen and already updating.
 *
 *   list    the siblings, in stored order
 *   id      which of them this panel is open on
 *   label   what it is CALLED — the name its row prints, so «Move Spend up» is about the
 *           line the reader is looking at
 */
export function OrderRow({ list, id, label, onMove }) {
  // Minted HERE and not by the caller, unlike `Seg`'s: this row renders the caption itself,
  // so there is no second hand for the wiring to slip out of.
  const capId = `${useId()}-order`;
  const i = (list || []).findIndex((x) => x && x.id === id);
  const n = (list || []).length;
  if (i < 0 || n < 2) return null;      // nothing to reorder, so no control that says there is
  const arrow = (dir, glyph, refused) => (
    <button
      type="button" className="sp-rb-btn" title={`Move ${dir}`} aria-label={`Move ${label} ${dir}`}
      aria-disabled={refused ? true : undefined}
      aria-describedby={refused ? capId : undefined}
      onClick={() => { if (!refused) onMove(dir); }}
    >
      {glyph}
    </button>
  );
  return (
    <PopRow label="Order">
      {arrow('up', '▲', i === 0)}
      {arrow('down', '▼', i === n - 1)}
      <span className="sp-rb-cap sp-content-order" id={capId}>{`${i + 1} of ${n}`}</span>
    </PopRow>
  );
}

/**
 * The palette row: `auto` plus the eight slots the grammar allows (COLOR_SLOTS). `auto`
 * means the renderer picks one by position, which is a real answer and so a real option.
 *
 * Each slot is a button with an accessible name; the chosen one also carries a check, so
 * the choice is not conveyed by colour alone.
 *
 * THE KEYBOARD IS `Seg`'s, from the same function (`radioKeys`). It is one radiogroup, so it
 * is ONE Tab stop — nine of them made a nine-stop detour through the middle of a panel, and
 * the arrows the role promises did nothing at all. Nothing here is ever refused, so the walk
 * simply visits all nine.
 */
export function PopColors({ value, onPick }) {
  const slots = [];
  for (let i = 0; i < COLOR_SLOTS; i += 1) slots.push(i);
  // Index 0 is `auto`; the eight palette slots follow it, so the option at index i+1 is
  // slot i — one list, walked by position, exactly as `Seg` walks its options.
  const at = (i) => (i === 0 ? 'auto' : i - 1);
  const answer = value === 'auto' ? 0 : slots.indexOf(value) + 1;
  // Where the single Tab stop sits: on the answer, or on `auto` when the stored slot is not
  // one this build draws.
  const roving = answer > 0 || value === 'auto' ? answer : 0;
  const onKeyDown = radioKeys({
    n: slots.length + 1,
    refused: () => false,
    pick: (i) => onPick(at(i)),
  });
  return (
    <span className="sp-pop-dots" role="radiogroup" aria-label="Color" onKeyDown={onKeyDown}>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'auto'}
        tabIndex={roving === 0 ? 0 : -1}
        className={`sp-pop-dot sp-pop-dot--auto${value === 'auto' ? ' sp-pop-dot--on' : ''}`}
        title="Auto"
        aria-label="Auto color"
        onClick={() => onPick('auto')}
      >
        A
      </button>
      {slots.map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          tabIndex={roving === i + 1 ? 0 : -1}
          className={`sp-pop-dot${value === i ? ' sp-pop-dot--on' : ''}`}
          style={{ background: `var(--pal-${i})` }}
          title={`Color ${i + 1}`}
          aria-label={`Color ${i + 1}`}
          onClick={() => onPick(i)}
        >
          {value === i ? '✓' : ''}
        </button>
      ))}
    </span>
  );
}

/**
 * One compact picker for the complete authored-paint grammar. Built-in Widgets use semantic
 * theme tokens, while an author may still choose Auto or one of the eight palette slots.
 * A native select keeps all 34 legal answers in one short row instead of turning the panel
 * into a wrapping wall of colour chips. `allowNone` is used by the optional fill/border
 * overrides; Color itself remains required and therefore has no such answer.
 */
export function PaintSelect({ label, value, allowNone = false, onPick }) {
  const encode = (v) => {
    if (v == null) return 'none';
    if (typeof v === 'number') return `palette:${v}`;
    if (v === 'auto') return 'auto';
    return `semantic:${v}`;
  };
  const decode = (v) => {
    if (v === 'none') return null;
    if (v === 'auto') return 'auto';
    if (v.startsWith('palette:')) return Number(v.slice('palette:'.length));
    return v.slice('semantic:'.length);
  };
  const semanticWord = (v) => v
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
  return (
    <select
      className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
      aria-label={label}
      value={encode(value)}
      onChange={(e) => onPick(decode(e.target.value))}
    >
      {allowNone ? <option value="none">Default</option> : null}
      <option value="auto">Auto</option>
      <optgroup label="Theme">
        {SEMANTIC_PAINTS.map((paint) => (
          <option key={paint} value={`semantic:${paint}`}>{semanticWord(paint)}</option>
        ))}
      </optgroup>
      <optgroup label="Palette">
        {Array.from({ length: COLOR_SLOTS }, (_, i) => (
          <option key={i} value={`palette:${i}`}>{`Color ${i + 1}`}</option>
        ))}
      </optgroup>
    </select>
  );
}

/** A grammar value as a word: `thin` → «Thin», `cumulative` → «Cumulative». Every table in
 *  the grammar is lower-case ASCII, so one rule serves all of them — and a value added to
 *  one of those tables shows up named rather than missing. */
export const word = (v) => (typeof v === 'string' && v ? v.charAt(0).toUpperCase() + v.slice(1) : '');

/**
 * A Spotlight map, read as `<optgroup>`s: `[{label, rows:[{id, label, disabled, reason}]}]`.
 *
 * The two doors onto one value slot — the popover's Value select and the Spotlight the ƒx
 * button opens — show the SAME list, judged once by `spotlightItems`. Two judgings of one
 * slot is how a select and a map start to disagree about what may be picked (T6 shipped
 * that bug and fixed it in `47ac1c1`); this is the shape that makes them one call.
 *
 * §1.1.3 rides along: a row that cannot be picked here keeps its place, disabled, and the
 * caller prints `reason` beside its label — a picker that quietly shortened its list is
 * what makes people believe a metric does not exist.
 */
export function optionGroups(items) {
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    if (item.g) { out.push({ label: item.g, rows: [] }); continue; }
    // An item before any header still belongs somewhere — the shell's own rule for the
    // same list, so neither door drops a row on the floor.
    if (!out.length) out.push({ label: '', rows: [] });
    out[out.length - 1].rows.push(item);
  }
  return out.filter((g) => g.rows.length);
}
