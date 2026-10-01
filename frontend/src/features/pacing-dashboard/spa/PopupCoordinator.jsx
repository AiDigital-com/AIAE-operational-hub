// workspace/src/components/ui/PopupCoordinator.jsx
//
// One open popup at a time inside a dialog — plus the focus primitives a dialog
// needs to behave like one. Both halves live here because they are the same
// problem: a popup that portals OUT of the dialog is still part of it, and every
// rule below (Escape, Tab, aria-owns) has to treat it that way.
//
// The coordinator
//   The host (today: SettingsDrawer) calls `usePopupCoordinator()` and puts the
//   value on `PopupCoordinatorContext` around its body. A popup registers itself
//   when it opens; opening a second one closes the first through the closeFn it
//   handed over. Two rules make the rest of the file work:
//     • the id a popup registers under IS the DOM id of its portal root — that is
//       what lets the dialog carry `aria-owns={openId}` and have it resolve;
//     • the portal root carries `data-dp-popup="1"`, the marker the drawer's
//       Escape guard already looks for.
//   Escape itself is NOT routed here. A popup owns the key with a window CAPTURE
//   listener + stopPropagation (ConfirmModal and TileMenu set the idiom): measured,
//   a React onKeyDown that closes the panel runs at the portal container and React
//   flushes the unmount in the microtask BEFORE the window bubble listeners, so a
//   DOM-presence guard finds nothing left to defer to.
//
// The focus primitives
//   `useFocusOnOpen`   — moves focus into the dialog when it opens.
//   `useOpenerRestore` — hands focus back to the exact element that opened it.
//   `useFocusTrap`     — Tab/Shift+Tab cycle over the dialog AND the open portal.
//   `useInertBackground` — everything except the dialog stops taking interaction.
//
// `reachable`, `nextTrapStop` and `collectInertTargets` are the decisions inside
// those hooks, exported as plain functions so they can be tested without a DOM
// (tests/dashboard/popup-shells.test.js).

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';

export const PopupCoordinatorContext = createContext(null);

/** Consumer side: the popup's view of the coordinator, or null outside one. */
export function usePopups() {
  return useContext(PopupCoordinatorContext);
}

/**
 * Whether Escape currently belongs to an expanded native <select>. Chromium exposes that
 * state through `:open`; a focused but closed select must return false so the surrounding
 * dialog still closes on its next Escape. Some DOM engines do not implement `:open`, so
 * feature detection is deliberately per call and fail-closed.
 */
export function openNativeSelect(target) {
  const select = String(target?.tagName || '').toLowerCase() === 'select'
    ? target : target?.closest?.('select');
  if (!select || String(select.tagName || '').toLowerCase() !== 'select'
    || typeof select.matches !== 'function') return false;
  try { return select.matches(':open'); } catch { return false; }
}

/**
 * Host side. Returns the context value — `{ open, close, closeAll, isOpen,
 * openId, registerPortal, portalsRef }` — which the host both puts on the context
 * and reads `openId` from for its own `aria-owns`.
 *
 * `close` and `closeAll` are NOT the same verb, and a popup that picks the wrong
 * one fails silently:
 *   • `close(id)` is BOOKKEEPING — the popup reporting that it has already closed
 *     itself. It clears the record and deliberately does not call any closeFn, so
 *     a popup closing through its own state cannot re-enter itself. Calling it
 *     expecting the popup to shut is a no-op.
 *   • `closeAll()` is the ASK — it tells whatever is open to close, through the
 *     closeFn that popup handed over. This is the one a host reaches for.
 */
export function usePopupCoordinator() {
  const [openId, setOpenId] = useState(null);
  // The live record, beside the state: `open` has to read the CURRENT one to close
  // it, and a callback rebuilt on every state change would break memoized consumers.
  const openRef = useRef(null);
  const portalsRef = useRef(new Map());

  const open = useCallback((id, closeFn) => {
    const previous = openRef.current;
    openRef.current = { id, closeFn };
    // Cleared BEFORE the old one is told to close: its closeFn lands back here as
    // close(itsId), and it must not clear the popup that just replaced it.
    if (previous && previous.id !== id) previous.closeFn?.();
    setOpenId(id);
  }, []);

  /** The popup reporting itself closed. Clears the record; calls nothing. */
  const close = useCallback((id) => {
    if (!openRef.current || openRef.current.id !== id) return;
    openRef.current = null;
    setOpenId(null);
  }, []);

  /** Asks whatever is open to close itself. The host's verb, not the popup's. */
  const closeAll = useCallback(() => {
    const previous = openRef.current;
    if (!previous) return;
    openRef.current = null;
    setOpenId(null);
    previous.closeFn?.();
  }, []);

  const isOpen = useCallback((id) => openRef.current?.id === id, []);

  /** Hand the trap the live portal element. Returns its un-register. */
  const registerPortal = useCallback((id, el) => {
    const portals = portalsRef.current;
    if (el) portals.set(id, el);
    else portals.delete(id);
    return () => { if (portals.get(id) === el) portals.delete(id); };
  }, []);

  return useMemo(
    () => ({ open, close, closeAll, isOpen, openId, registerPortal, portalsRef }),
    [open, close, closeAll, isOpen, openId, registerPortal],
  );
}

/* ── focusables ───────────────────────────────────────────────────────────── */

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe',
  'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Can focus actually LAND here? One question, and only that one — a candidate the
 * cycle gets wrong is a hole either way. List something unfocusable and `.focus()`
 * does nothing, so Tab appears to stick; leave out something the browser CAN focus
 * and Tab reaches it natively, `nextTrapStop` finds it in no list, and focus jumps
 * to the top of the dialog.
 *
 * Which is why `aria-hidden` is deliberately NOT consulted. Measured in this
 * Chromium: a `<button>` under `aria-hidden="true"` still answers `.focus()` and
 * still sits in the native Tab order — it is hidden from AT, not from focus.
 * `visibility: hidden` is the opposite and the one the old rect test got wrong:
 * one client rect, `offsetWidth > 0`, and `.focus()` refuses. That is the shape of
 * the codebase's "slot always rendered" controls (RateControl's Reset to NS,
 * PacingTab's unit-fill) and of MultiSelect's panel in the frame before it is
 * positioned. `checkVisibility` answers display, visibility and content-visibility
 * together; the rect test stays behind it for engines without it.
 *
 * `inert` IS consulted, because it genuinely blocks focus, and it is inherited —
 * `closest` matches the element itself as well as its ancestors.
 */
export const reachable = (el) => {
  if (!el || el.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
  }
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
};

function focusablesIn(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(reachable);
}

/**
 * Where Tab should land, or null to let the browser move focus itself.
 * Only the ENDS of the cycle are steered; a focus that is inside the dialog but
 * not on a stop of its own (the root, a plain div) enters the cycle at an end.
 */
export function nextTrapStop(nodes, active, shiftKey) {
  if (!nodes || !nodes.length) return null;
  const last = nodes.length - 1;
  const i = nodes.indexOf(active);
  if (i === -1) return shiftKey ? nodes[last] : nodes[0];
  if (shiftKey && i === 0) return nodes[last];
  if (!shiftKey && i === last) return nodes[0];
  return null;
}

/** The marker a MODAL question carries (`ConfirmModal`) — the Tab twin of the
 *  `[data-dp-popup="1"]` marker the drawer's Escape guard defers to. */
const MODAL = '[data-dp-modal="1"]';

/**
 * Tab and Shift+Tab stay inside `containerRef` and the coordinator's open portal.
 * Capture phase, so a handler deeper in the tree that stops propagation cannot
 * punch a hole in the cycle.
 *
 * INNER-FIRST, the same rule Escape keeps. A modal question opened INSIDE a trapped dialog
 * is a second dialog on top of the first, and the outer one registered its listener earlier
 * — so without this the drawer's trap would run first, `preventDefault` the key, and the
 * confirm's own trap would bail on `defaultPrevented` and never cycle its two buttons. A
 * trap whose container is not that modal (and does not hold it) stands back while it is up.
 */
export function useFocusTrap(containerRef, { active = false, coordinator = null } = {}) {
  const fromContext = useContext(PopupCoordinatorContext);
  // A host provides its own coordinator: it cannot read the context it renders.
  const portalsRef = (coordinator || fromContext)?.portalsRef || null;

  useEffect(() => {
    if (!active) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      // The modal's own trap is the only one that acts while a modal is up — and a confirm
      // opened from inside the drawer IS a descendant of it, so «does my container hold it»
      // is the wrong question: the drawer holds it and would keep cycling all of itself.
      const modal = typeof document !== 'undefined' && document.querySelector ? document.querySelector(MODAL) : null;
      if (modal && modal !== containerRef.current) return;
      const roots = [containerRef.current, ...(portalsRef ? portalsRef.current.values() : [])]
        .filter((el) => el && el.isConnected);
      if (!roots.length) return;
      const focused = document.activeElement;
      // A popup nobody registered (a date picker, a native select) runs its own Tab
      // order — the trap only speaks for focus it can see.
      if (!focused || !roots.some((r) => r === focused || r.contains(focused))) return;
      // Deduped: a stop listed twice makes indexOf answer for the first copy, and
      // the cycle stops wrapping at what is really its end.
      const stops = [...new Set(roots.flatMap((r) => focusablesIn(r)))];
      const next = nextTrapStop(stops, focused, e.shiftKey);
      if (!next) return;
      e.preventDefault();
      next.focus();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, containerRef, portalsRef]);
}

/**
 * Captures the element that opened the dialog and focuses it again on close.
 *
 * The two halves sit in different effect kinds on purpose, and each one's
 * neighbour is why:
 *   • CAPTURE in a layout effect — it runs before every passive effect, so the
 *     opener is read while its ancestors are still live. The host declares
 *     `useInertBackground` (passive) alongside this; Chrome measurably keeps focus
 *     on an element whose ancestor turns inert, but the HTML spec runs the
 *     unfocusing steps there, and under the spec the capture would read <body> and
 *     the restore would vanish with nothing failing but a browser gate.
 *   • RESTORE in a passive cleanup — passive cleanups run after the layout ones,
 *     and the host declares `useInertBackground` FIRST, so inert is already lifted
 *     by the time this fires. Focusing into a still-inert subtree is a no-op.
 */
export function useOpenerRestore(open) {
  const openerRef = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    openerRef.current = opener && opener !== document.body ? opener : null;
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    return () => {
      const el = openerRef.current;
      openerRef.current = null;
      if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    };
  }, [open]);
  return openerRef;
}

function resolveTarget(target, root) {
  if (!target) return null;
  const raw = typeof target === 'function' ? target()
    : typeof target === 'string' ? root?.querySelector(target)
      : typeof target === 'object' && 'current' in target ? target.current
        : target;
  if (!raw || raw.nodeType !== 1) return null;
  if (raw.matches?.(FOCUSABLE) && reachable(raw)) return raw;
  return focusablesIn(raw)[0] || null;
}

/**
 * ONE frame later — the schedule `useFocusOnOpen` runs on.
 *
 * A dialog can be IN the DOM and still refuse focus: `.focus()` is a no-op on anything
 * `visibility: hidden`, and a dialog that opens by class flip is mid-transition in the
 * commit that flipped it. That is the shape of the bug this hook silently had — the
 * Settings drawer never unmounts, so re-opening it only ever flipped a class, and focus
 * moved in on the FIRST open of a session and never again. One frame is the general
 * defence; the drawer's own half of that fix is in the CSS (see `.settings-drawer.open`
 * in index.css — a transitioned `visibility` flips at the END of its duration, so it had
 * to leave the opening transition entirely).
 *
 * Node has neither timer under this name (the host suites drive these hooks outside a
 * browser), so there it falls back to a macrotask: the same "after this commit has
 * settled" guarantee, and a handle that `cancel` can still take back.
 */
const nextFrame = typeof requestAnimationFrame === 'function'
  ? { schedule: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) }
  : { schedule: (fn) => setTimeout(fn, 0), cancel: (id) => clearTimeout(id) };

/**
 * Moves focus into the dialog when it opens. `target` may be a ref, an element, a
 * selector inside the container, or a function returning one; a target that is not
 * itself focusable donates its first focusable descendant. With none — or with one
 * that is not on screen — focus lands on the container's first stop, which is the
 * dialog head. The caller is responsible for flipping `open` only once the dialog
 * is really in the DOM.
 *
 * The container is read INSIDE the frame, not before scheduling it: a dialog that is
 * mid-transition has an element but no focusable stop yet, and reading it a frame early
 * is the same no-op the frame exists to fix.
 */
export function useFocusOnOpen(containerRef, open, target = null) {
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!open) return undefined;
    const handle = nextFrame.schedule(() => {
      const root = containerRef.current;
      if (!root) return;
      const el = resolveTarget(targetRef.current, root) || focusablesIn(root)[0];
      el?.focus({ preventScroll: true });
    });
    // Cancelled on cleanup: a dialog closed inside the same frame it opened would
    // otherwise pull focus back out of whatever replaced it.
    return () => nextFrame.cancel(handle);
  }, [open, containerRef]);
}

/**
 * Every element beside `start` — its siblings, its parent's siblings, up to
 * `stopAt` — with anything in `live` (and any subtree holding it) left out.
 *
 * A walk rather than one wrapper element: the drawer is an inline sibling inside
 * <main>, so there is no ancestor that holds the page but not the drawer.
 */
export function collectInertTargets(start, live, stopAt) {
  const keep = (live || []).filter(Boolean);
  if (!start || !keep.length) return [];
  const out = [];
  for (let node = start; node && node !== stopAt && node.parentElement; node = node.parentElement) {
    for (const sibling of [...node.parentElement.children]) {
      if (sibling === node) continue;
      if (keep.some((el) => sibling === el || sibling.contains(el))) continue;
      out.push(sibling);
    }
  }
  return out;
}

const elementOf = (x) => (x && x.nodeType === 1 ? x : x?.current || null);

/**
 * While `active`, everything outside the dialog stops taking pointer, keyboard and
 * AT interaction. `keep` is the dialog FIRST — the walk starts there — then anything
 * that must stay live beside it (the overlay: click-outside-to-close runs through it,
 * and inert content receives no pointer events). Falls back to aria-hidden where
 * `inert` is unsupported, which holds AT out even though the mouse still gets through.
 */
export function useInertBackground(active, keep) {
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const live = (keepRef.current || []).map(elementOf).filter(Boolean);
    const supported = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
    const marked = [];
    for (const el of collectInertTargets(live[0], live, document.body)) {
      // Already held out by someone else — leaving it out keeps the cleanup from
      // handing interaction back to a subtree that never had it.
      if (supported ? el.inert : el.getAttribute('aria-hidden') === 'true') continue;
      if (supported) el.inert = true;
      else el.setAttribute('aria-hidden', 'true');
      marked.push(el);
    }
    return () => {
      for (const el of marked) {
        if (supported) el.inert = false;
        else el.removeAttribute('aria-hidden');
      }
    };
  }, [active]);
}
