// workspace/src/components/ui/Popover.jsx
//
// The anchored settings surface of the v2 builder (spec 2026-08-19 §3): a chip is
// a thing, clicking it opens THIS, and it answers exactly one question about that
// thing. The caller owns the rows; this owns where the panel sits, who has focus,
// and who gets Escape.
//
// It is a portal on <body> with `position: fixed`, not a child of the chip, for the
// reason TileMenu is: every surface it opens from lives inside a scrolling,
// `overflow: hidden` container (the drawer body, a widget tile), which would slice
// an in-flow panel off at the nearest edge. Placement is the shared pure function
// `lib/menu-placement.js` — right-aligned to the chip, clamped to the viewport,
// flipped above only when it really fits there — re-run from the MEASURED height
// before paint AND on every re-place, because a flipped panel hangs from its own
// bottom edge and every pixel of estimate error moves it over the chip.
//
// Three rules it does NOT decide for itself, inherited from PopupCoordinator.jsx:
//   • the id it registers under IS this element's DOM id, so the drawer's
//     `aria-owns={openId}` resolves to a node that exists;
//   • `data-dp-popup="1"` is the marker the drawer's Escape guard defers to;
//   • Escape is taken on WINDOW CAPTURE with stopPropagation, not through a React
//     onKeyDown — measured in T3, React flushes the unmount in the microtask before
//     the window bubble listeners, so the drawer's guard would find the marker gone
//     and close the drawer on an Escape aimed at this panel.
//
// A POPUP OPENED FROM INSIDE THIS PANEL IS NOT OUTSIDE IT. `MultiSelect` and
// `SearchSelect` render their option lists through a portal onto <body>, so a row of one
// is a DOM stranger to `panelRef` while being a logical child of it — and the Scope
// panel puts two of them in its own rows. Closing on that pointerdown does not merely
// close the panel: `pointerdown` runs before `click`, React unmounts the row in the same
// discrete flush, and the pick the reader made never lands at all (measured: the Channels
// and Line items pins could not be set from this builder). The same marker those popups
// already carry is what tells this one to stand back, for the pointer and for Escape
// alike — inner-first ownership, which is the rule the whole stack keeps.
//
// Unlike TileMenu, a scroll or a resize RE-PLACES rather than closes: a ⋯ menu is a
// list of commands and losing it costs nothing, while this holds an edit in
// progress and must not vanish under the user's hands.
//
// Props:
//   anchorRef     ref to the chip/button it belongs to — its rect places the panel,
//                 and Escape hands focus back to it
//   open          render it or not
//   onClose       asked to close: Escape, a pointerdown outside, the coordinator
//   title         the panel's accessible name and its head caption
//   width         panel width in px (default 360), clamped to the visible viewport
//   initialFocus  'first' (default) — the first control in the panel; 'none' — leave
//                 focus alone; or anything useFocusOnOpen resolves (ref / element /
//                 selector / function)
//   id            the DOM id AND the coordinator key; generated when absent
//   keepMounted   retain local editor drafts while closed; hidden panels own no
//                 listeners, focus, portal registration or popup marker
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeMenu } from './menu-placement.js';
import { openNativeSelect, usePopups, useFocusOnOpen } from './PopupCoordinator.jsx';

const POPOVER_GAP = 4;
const POPOVER_EDGE = 8;
// Only ever used for the frame before the panel exists, and only the flip decision
// can read it wrongly — which is why the layout effect below re-places from the
// measurement before anything is painted.
const ESTIMATED_H = 220;

function visibleViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

function fitWidth(width, viewport = visibleViewport()) {
  return Math.min(width, Math.max(0, viewport.width - POPOVER_EDGE * 2));
}

export function PopoverPanel({
  id, title, width, anchorRef, onClose, initialFocus = 'first', active = true, children,
}) {
  const [pos, setPos] = useState(null);
  const panelRef = useRef(null);
  const popups = usePopups();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The dep is `width`, not the children: rows are rebuilt on every parent render, and a
  // per-render `place` identity would tear down and re-register the window listeners
  // below on every keystroke in a panel field. Same-value writes return the CURRENT `pos`
  // object so React bails out — which is also what lets the placement effect below run
  // after every render without looping.
  const place = useCallback((measuredH) => {
    const rect = anchorRef?.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = visibleViewport();
    const panelWidth = fitWidth(width, viewport);
    const maxHeight = Math.max(0, viewport.height - POPOVER_EDGE * 2);
    const panelHeight = Math.min(measuredH ?? ESTIMATED_H, maxHeight);
    const next = placeMenu({
      top: rect.top - viewport.top,
      bottom: rect.bottom - viewport.top,
      right: rect.right - viewport.left,
    }, {
      panelW: panelWidth,
      panelH: panelHeight,
      viewportW: viewport.width,
      viewportH: viewport.height,
      gap: POPOVER_GAP,
      edge: POPOVER_EDGE,
    });
    // Ordinary menus may overflow when neither side fits. A settings panel must
    // retain every control, so that case moves within the screen and scrolls.
    next.top = viewport.top + Math.max(POPOVER_EDGE,
      Math.min(next.top, viewport.height - POPOVER_EDGE - panelHeight));
    next.left += viewport.left;
    next.width = panelWidth;
    next.maxHeight = maxHeight;
    setPos((cur) => (cur && cur.top === next.top && cur.left === next.left
      && cur.width === next.width && cur.maxHeight === next.maxHeight ? cur : next));
  }, [anchorRef, width]);

  // The one measurement everything after the first frame is placed from. Two reads
  // per event, both BEFORE anything is written back, so a scroll costs one layout.
  const measuredH = () => panelRef.current?.getBoundingClientRect().height;

  /**
   * Is this node inside a popup that was opened from within this panel? A `MultiSelect` /
   * `SearchSelect` list is portalled onto <body>, so `panelRef.contains` says no about a
   * row the reader is plainly operating inside this panel. `data-dp-popup="1"` is the
   * marker every popup in this app carries and the one the drawer's own Escape guard
   * already defers to; the coordinator allows exactly one REGISTERED popup at a time, so a
   * marked node that is not this panel is a popup nested inside it.
   */
  // Stable, so the two window listeners below keep the dep arrays they were written with:
  // it reads `panelRef` and nothing else, and a per-render identity would tear down and
  // re-register those listeners on every keystroke in a panel field.
  const inNestedPopup = useCallback((node) => {
    // Formula workspaces are modal portals, including a scrim outside their
    // dialog element. The modal owns every pointer and Escape while it is open.
    if (document.querySelector?.('[data-dp-modal="1"]')) return true;
    // Spotlight moves focus on the next frame. A fast Escape can still target
    // this panel's opener, so ownership follows the live modal, not only focus.
    if (document.querySelector?.('[data-dp-popup="1"] [aria-modal="true"]')) return true;
    const marked = node && typeof node.closest === 'function' ? node.closest('[data-dp-popup="1"]') : null;
    return !!marked && marked !== panelRef.current;
  }, []);

  // After EVERY render, not only when `place`'s identity changes: the anchor moves under
  // the panel whenever the thing the panel is open ON moves. The ▲▼ pair inside a series
  // or a column panel reorders the row the panel is anchored to — a whole row height — and
  // a panel left at its old coordinates would sit pointing at the row that took its place.
  // A scroll and a resize are handled below; this is the third way the rect changes, and it
  // is the only one the caller can cause from inside the panel.
  //
  // It cannot loop: same-value writes return the CURRENT `pos` object, so React bails out
  // and no re-render follows; a real move costs one extra render that then agrees with
  // itself. `measuredH` reads a ref and is deliberately not a dep.
  useLayoutEffect(() => {
    if (active) place(measuredH());
  });

  // Descendant state (including native <details>) can grow the panel without
  // rendering this shell. Observe its border box so that expansion also re-places
  // it. Once capped, further content remains available in the same scroll frame.
  useLayoutEffect(() => {
    if (!active || !panelRef.current || !window.ResizeObserver) return undefined;
    const observer = new window.ResizeObserver(() => place(measuredH()));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [active, place]);

  // Escape belongs to the innermost open thing. A LAYOUT effect, so the listener is
  // in place before the panel is ever painted.
  useLayoutEffect(() => {
    if (!active) return undefined;
    function onEscape(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || e.cancelBubble) return;
      // Leave the browser's default action intact so this Escape closes the native list.
      // Stop propagation so the drawer behind this portalled panel cannot take it too.
      if (openNativeSelect(e.target)) { e.stopPropagation(); return; }
      // Aimed at a list open INSIDE this panel: that popup takes it. `stopPropagation`
      // does not stop a sibling listener on the same target — both handlers sit on window
      // in capture — so the inner popup consuming the key is not enough on its own, and
      // an Escape meant to dismiss a dropdown would take the panel behind it too.
      if (inNestedPopup(e.target)) return;
      e.stopPropagation();
      onCloseRef.current?.();
      anchorRef?.current?.focus({ preventScroll: true });
    }
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [active, anchorRef, inNestedPopup]);

  useEffect(() => {
    if (!active) return undefined;
    function onDown(e) {
      // The anchor is not "outside": it toggles, and closing here would fight the
      // re-open on the same click.
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      // …and neither is a list this panel's own rows opened (see `inNestedPopup`).
      if (inNestedPopup(e.target)) return;
      // Focus is about to lose the node it is standing on. Dropped on <body> inside
      // a trapped dialog, the next Tab jumps to the top of the cycle — so the anchor
      // takes it back, the same hand-off Escape makes. A click on something
      // focusable overrides this on the mousedown that follows, which is right: that
      // is the user choosing where to go.
      if (panelRef.current?.contains(document.activeElement)) {
        anchorRef?.current?.focus({ preventScroll: true });
      }
      onCloseRef.current?.();
    }
    // Re-placed from the MEASURED height, never the estimate: a flipped panel hangs
    // from its own bottom edge, so re-placing from ESTIMATED_H would drop it onto
    // the chip on the first scroll — and scrolling with this open is the interaction
    // it exists for.
    const onMove = () => place(measuredH());
    window.addEventListener('pointerdown', onDown);
    // Capture: a scroll inside the drawer body does not bubble to window.
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', onMove);
    viewport?.addEventListener('scroll', onMove);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      viewport?.removeEventListener('resize', onMove);
      viewport?.removeEventListener('scroll', onMove);
    };
  }, [active, anchorRef, place, inNestedPopup]);

  // The coordinator's value object changes identity whenever `openId` does (its
  // memo lists it), so the OBJECT is the wrong dep: this popup would unregister and
  // re-register on every transition, and one whose parent ignores `onClose` would
  // re-open itself over the popup that had just replaced it. These three are stable
  // for the life of the coordinator, which is what "the same coordinator" means.
  const openPopup = popups?.open;
  const closePopup = popups?.close;
  const registerPortal = popups?.registerPortal;
  useEffect(() => {
    if (!active || !openPopup) return undefined;
    openPopup(id, () => onCloseRef.current?.());
    const drop = registerPortal(id, panelRef.current);
    // close(id) is bookkeeping — this popup reporting that it has gone. It calls no
    // closeFn, so a popup already unmounting cannot re-enter itself.
    return () => { closePopup(id); drop(); };
  }, [active, openPopup, closePopup, registerPortal, id]);

  useFocusOnOpen(panelRef, active && initialFocus !== 'none', initialFocus === 'first' ? null : initialFocus);

  return (
    <div
      ref={panelRef}
      id={id}
      data-dp-popup={active ? '1' : undefined}
      hidden={!active}
      inert={!active ? '' : undefined}
      className="sp-pop"
      role="dialog"
      aria-label={title}
      style={{
        display: active ? undefined : 'none',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: pos?.width ?? fitWidth(width),
        maxHeight: pos?.maxHeight ?? Math.max(0, visibleViewport().height - POPOVER_EDGE * 2),
        // One frame at most: the layout effect above places it before paint. An
        // anchor that never resolves leaves the panel hidden rather than parked in
        // the top-left corner — and `reachable` reads visibility, so a hidden panel
        // is also not a Tab stop the trap would send focus to and lose it.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {title ? <div className="sp-pop-hd">{title}</div> : null}
      {children}
    </div>
  );
}

export default function Popover({
  anchorRef, open, onClose, title, width = 360, initialFocus = 'first', id, keepMounted = false, children,
}) {
  const autoId = useId();
  if ((!open && !keepMounted) || typeof document === 'undefined') return null;
  return createPortal(
    <PopoverPanel
      id={id || `sp-pop-${autoId}`}
      title={title}
      width={width}
      anchorRef={anchorRef}
      onClose={onClose}
      initialFocus={initialFocus}
      active={open}
    >
      {children}
    </PopoverPanel>,
    document.body,
  );
}
