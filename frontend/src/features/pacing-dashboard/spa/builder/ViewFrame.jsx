// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/ViewFrame.jsx
//
// The part of a view card that is the SAME for all five kinds (widget-builder v2 §3):
// the drag handle, the kind tag, the view's name, and the three controls that act on the
// view itself. Everything below the header is the card's own — T6 fills the chart's, T7-T10
// the rest.
//
// It is one component rather than four copies because it is one contract: `⋮⋮` drags the
// card, `▲ ▼` is the keyboard path to the same reorder, and `×` asks before it takes
// something away. A card that grew its own header would be a second answer to any of those
// the day one of them changes.
import { useRef } from 'react';
import '../InspectorFields.css';
import { LIMITS } from '../report-v2.js';
import { KIND_LABEL, viewName } from './view-text.js';
import { useRowDrag, VIEW_DRAG } from './reorder.js';

/**
 * ViewFrame — the card's shell.
 *
 *   view            the view this card is about (its kind and title are all that is read)
 *   spec            the spec it sits in — read for ONE thing: two untitled charts are
 *                   «Chart 1» and «Chart 2» rather than «Chart» twice (`viewName`)
 *   first / last    is it at an end of the Views list? The matching arrow is disabled
 *   onMove(dir)     'up' | 'down'
 *   onDropAt(draggedViewId, place)   a card was let go on this one, 'before' | 'after'
 *   onRemove        asked to remove the view — the caller owns the confirm
 *   children        the card's body
 *
 * SHARING A ROW is not asked here. It was, through P3's first draft — a «Beside next view»
 * checkbox on every card — and the question is about the SPACE BETWEEN two cards, not about
 * either of them: on the last card there was nothing to answer, so the line sat greyed with
 * a sentence explaining its own uselessness, and on a one-view widget that grey line was the
 * only thing under the card. It moved into the gap where it belongs (`RowSeam.jsx`), which
 * also took the refusal with it: a seam exists only where the pairing is legal.
 *
 * THE HANDLE IS REAL (T17, the owner's decision of 2026-08-24). It was drawn through P3 as
 * decoration — faint, `cursor: default`, answering a drag with nothing — and the final fix
 * wave removed it rather than leave a control promising a gesture it did not have. It comes
 * back wired: `draggable`, carrying `sp-rb/view` on the dataTransfer, with the whole CARD as
 * the drag image and as the box a drop is measured against. Every card is also a drop
 * target; where the drop lands is the half of the card the pointer is in.
 *
 * It stays `aria-hidden` and out of the Tab order. The `▲▼` pair beside it is the keyboard
 * path to the same reorder and it is unchanged — §10.3 asks that every interaction have one,
 * not that every interaction have two controls that both look pressable.
 *
 * The arrow at an END is `aria-disabled` and not `disabled`, like every other refused
 * control in this window (§10.3, T13 fix round). It is the arrow the reader is STANDING ON
 * that reaches the end — press ▲ until the card is first and a natively disabled button
 * drops its focus onto <body>, so the next Tab restarts at the top of the dialog. That
 * costs two Tab stops in the whole list, not two per card: only the first card's ▲ and the
 * last card's ▼ are ever at an end. Its reason is its own position, which is why the label
 * says it — «Move Chart 2 up, unavailable» is a sentence, and there is no other one to
 * print on a card header that is already three glyphs wide.
 */
export default function ViewFrame({
  view, spec, first, last, onMove, onDropAt, onRemove, onTitle, children, embedded = false,
}) {
  // Three glyph buttons carry no text an AT can read, and a report holds up to six cards
  // of them — so each names ITS view, the same aria-label + title pair the brick
  // constructor's ◀ ▶ × use one screen over.
  const name = viewName(view, spec);
  const card = useRef(null);
  const drag = useRowDrag(VIEW_DRAG, view.id, (dragged, place) => onDropAt?.(dragged, place), card);
  const arrow = (dir, glyph, refused) => (
    <button
      type="button" className="sp-rb-btn" title={`Move ${dir}`} aria-label={`Move ${name} ${dir}`}
      aria-disabled={refused ? true : undefined}
      onClick={() => { if (!refused) onMove(dir); }}
    >
      {glyph}
    </button>
  );
  if (embedded) return <div ref={card} className="sp-inspector-view">
    {onTitle ? <label className="sp-inspector-title">
      <span>Title</span>
      <input type="text" className="sp-inp sp-inp--sans" aria-label={`${KIND_LABEL[view.kind] || view.kind} title`}
        maxLength={LIMITS.title} value={view.title || ''}
        placeholder={view.titleAuto ? 'Automatic title' : 'Optional title'}
        onChange={(event) => onTitle(event.target.value.slice(0, LIMITS.title))} />
    </label> : null}
    {children}
  </div>;
  return (
    <div ref={card} className={`sp-rb-view${drag.cls}`} {...drag.boxProps}>
      <div className="sp-rb-view-hd">
        <span className="sp-rb-hndl" aria-hidden="true" title="Drag to reorder" {...drag.handleProps}>⋮⋮</span>
        <span className="sp-rb-view-kind">{(KIND_LABEL[view.kind] || view.kind).toUpperCase()}</span>
        {onTitle ? (
          <input
            type="text"
            className="sp-inp sp-inp--sm sp-inp--sans sp-rb-view-title"
            aria-label={`${KIND_LABEL[view.kind] || view.kind} title`}
            maxLength={LIMITS.title}
            value={view.title || ''}
            placeholder={view.titleAuto ? 'Automatic title' : 'Optional title'}
            onChange={(e) => onTitle(e.target.value.slice(0, LIMITS.title))}
          />
        ) : (view.title ? <span className="sp-rb-view-nm">{view.title}</span> : null)}
        <span className="sp-rb-btns">
          {arrow('up', '▲', first)}
          {arrow('down', '▼', last)}
          <button type="button" className="sp-rb-btn sp-rb-btn--rm" title="Remove view"
            aria-label={`Remove ${name}`} onClick={onRemove}>×</button>
        </span>
      </div>
      {children}
    </div>
  );
}
