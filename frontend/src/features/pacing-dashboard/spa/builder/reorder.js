// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/reorder.js
//
// DRAG TO REORDER (widget-builder v2 decision 17, built in P3 T17 on the owner's word).
// Three lists in this window reorder by hand — the Views list, a chart's series, a table's
// columns — and this is the one answer all three take, so a card and a row are dragged the
// same way and there is one place to read how.
//
// It is an ADDITION, never a replacement. The `▲▼` pair on the card header and the `Order`
// pair inside the series and column panels are untouched and stay the keyboard path (§10.3:
// every interaction has one). The handle is `aria-hidden` and is not a Tab stop — a handle
// that were also a button would be a second answer to the question the arrows already
// answer, and a reader would have to try both to find out which one moved the row.
//
// HTML5 drag, in the idiom the Mapping v3 tab established (`TokenPool.jsx`,
// `SuggestStrip.jsx`, `DimensionGrid.jsx`): a custom dataTransfer TYPE says what is being
// carried, and a list that is not listening for that exact type never calls preventDefault,
// so the browser refuses the drop. That is the whole cross-list guard — the type carries the
// kind AND the owning view id, so a series dragged out of one chart is not a type any other
// list hears, and a drop somewhere else is silence rather than an error nobody asked for.
//
// WHAT IT DOES NOT SET is `text/plain`. The token drags do, because their drop target is a
// text field and the fallback is the point. A reorder has exactly one legal target and three
// text inputs on the same screen — the report's title, Top N, Limit — and a drag carrying
// `text/plain` lets the browser drop a raw element id into any of them. That is a corrupted
// title, not a reorder.
import { useState } from 'react';
import { flattenViews } from '../report-v2.js';

/**
 * The dataTransfer type one list's drags carry.
 *
 * LOWERCASED because `setData` is: the HTML spec ASCII-lowercases the format it is handed,
 * so a type built with a view id that has a capital in it would be stored under a spelling
 * `types.includes()` would never match, and the list would silently refuse its own drags.
 */
export const dragType = (kind, viewId) => `sp-rb/${kind}${viewId ? `:${viewId}` : ''}`.toLowerCase();

/** The Views list is one list, so its type needs no view id to tell it from another. */
export const VIEW_DRAG = dragType('view');

/** Which side of a row the pointer is on — the half it is in, so the line the reader sees is
 *  the gap the row will land in. `rect` is the row's own box. */
export const dropPlace = (clientY, rect) => (
  rect && Number.isFinite(clientY) && clientY < rect.top + rect.height / 2 ? 'before' : 'after'
);

/**
 * The index a dragged element takes when it is let go BEFORE or AFTER another one.
 *
 * Counted in the list it LANDS in — the list minus the element being moved — which is the
 * convention `moveViewTo` and its two siblings read. `null` when either id is missing from
 * the list, which is what a cross-list drop, a stale id and a drop on the dragged row itself
 * all look like; the mutators refuse a non-integer index, so a `null` moves nothing.
 */
export function dropIndex(ids, draggedId, targetId, place) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.includes(draggedId)) return null;
  const rest = list.filter((id) => id !== draggedId);
  const at = rest.indexOf(targetId);
  if (at === -1) return null;
  return place === 'after' ? at + 1 : at;
}

/** The Views list's ids, read off the spec a patch is LANDING in and never off the render's
 *  copy — the index a drop resolves to has to be counted in the draft it is written into. */
export const viewIdsOf = (spec) => (Array.isArray(spec && spec.views) ? spec.views : [])
  .map((v) => v && v.id);

/** The same, for one view's `series` or `columns`. */
export function idsOf(spec, viewId, key) {
  const v = flattenViews(spec?.views).find((x) => x && x.id === viewId);
  return (v && Array.isArray(v[key]) ? v[key] : []).map((e) => e && e.id);
}

/**
 * One row (or card) as BOTH ends of a drag: the grip that starts one, and the box that takes
 * one.
 *
 * The state is the ROW'S OWN — the row being carried knows it is lifted, the row under the
 * pointer knows which edge to draw — so nothing above holds a drag in progress, and a drag
 * abandoned anywhere clears itself: the source on `dragend`, which the browser always fires,
 * the target on `dragleave`, which it fires on the way out.
 *
 *   type       the dataTransfer type this list carries (`dragType`)
 *   id         this row's element id
 *   onDrop(draggedId, place)   the drop, once — the caller turns it into ONE patch
 *   imageRef   optional: the element the drag image is taken from. A grip is seven pixels
 *              wide, and dragging a card by a ghost of its own grip says nothing about what
 *              is moving; the whole row is what the reader picked up.
 */
export function useRowDrag(type, id, onDrop, imageRef) {
  const [carried, setCarried] = useState(false);
  const [over, setOver] = useState(null);

  const mine = (e) => !!e && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(type);
  const placeOf = (e) => {
    const box = e && e.currentTarget && e.currentTarget.getBoundingClientRect
      ? e.currentTarget.getBoundingClientRect() : null;
    return box ? dropPlace(e.clientY, box) : null;
  };

  return {
    carried,
    over,
    /** The `⋮⋮` grip. `aria-hidden` and no tabindex is the caller's half — it is markup, and
     *  it is asserted where the markup is. */
    handleProps: {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData(type, id);
        e.dataTransfer.effectAllowed = 'move';
        const img = imageRef && imageRef.current;
        if (img && e.dataTransfer.setDragImage && img.getBoundingClientRect) {
          const r = img.getBoundingClientRect();
          e.dataTransfer.setDragImage(img, Math.max(0, e.clientX - r.left), Math.max(0, e.clientY - r.top));
        }
        setCarried(true);
      },
      onDragEnd: () => { setCarried(false); setOver(null); },
    },
    /** The row itself: what a drop lands on, and what draws the line. */
    boxProps: {
      onDragOver: (e) => {
        // THIS row is the one being carried: it is not a place to land on. The type it sees
        // is its own, so without this it would preventDefault and wear the insertion line —
        // promising a move that cannot happen (`dropIndex` answers null for a row let go on
        // itself, and nothing is written). Refusing the drop is what the browser shows the
        // reader instead.
        if (carried) return;
        // NOT this list's drag: no preventDefault, so the browser refuses the drop outright
        // and the event goes on bubbling to whatever list it does belong to.
        if (!mine(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(placeOf(e));
      },
      onDragLeave: (e) => {
        // A pointer moving onto a CHILD of this row leaves the row first — `dragleave` fires
        // before the child's `dragenter` — so clearing on every one of them makes the line
        // blink off and on across the row. The child is still inside; only leaving the row
        // for something the row does not contain is a leave.
        if (e && e.relatedTarget && e.currentTarget && e.currentTarget.contains
          && e.currentTarget.contains(e.relatedTarget)) return;
        setOver(null);
      },
      onDrop: (e) => {
        if (!mine(e)) return;
        e.preventDefault();
        const dragged = e.dataTransfer.getData(type);
        const place = placeOf(e) || over || 'after';
        setOver(null);
        if (dragged && dragged !== id) onDrop(dragged, place);
      },
    },
    /** What the row wears while a drag is in flight — appended to its own className. The
     *  drop mark is a HORIZONTAL line in the gap above or below the row (`.sp-rb-drop-*` in
     *  index.css); a vertical rail is banned project-wide and this is the shape the ban is
     *  about. */
    cls: `${carried ? ' sp-rb-carried' : ''}${over ? ` sp-rb-drop-${over}` : ''}`,
  };
}
