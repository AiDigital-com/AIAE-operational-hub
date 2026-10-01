// workspace/src/components/ui/TileMenu.jsx
//
// The tile ⋯ menu (widget-library spec 2026-08-14 §6.3, view-mode half; mechanics
// from 2026-07-22 §3.2/§3.3). Click-open, not hover: it is a command surface, not
// navigation. Esc closes and returns focus to the button, outside click closes,
// arrows traverse. Visuals are the app's existing dropdown language only — surface,
// 1px border, radius, shadow. No new visual language, no vertical stripes.
//
// The PANEL is a portal with fixed positioning, not an absolutely-positioned child
// (the plan's first shape): every widget tile lives inside `.chart-panel`, which is
// `overflow: hidden` (index.css:425). A 4-item menu is ~130px tall and a KPI tile is
// ~100px, so an in-flow panel was sliced off at the card edge. Placement itself is
// shared with KebabMenu (lib/menu-placement.js) — right-aligned, viewport-clamped,
// flipped above when it would not fit below — and both close on scroll/resize,
// because a fixed panel would otherwise drift away from its trigger.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeMenu } from '../menu-placement.js';

const MENU_WIDTH = 176;   // must match .wgm-panel { width } in index.css
const ROW_H = 30;         // .wgm-item: 6+6 padding + ~18px line
const PANEL_PAD = 8;      // 4+4 panel padding
// The ⋯ sits on flow tiles too, where "widget" would be wrong. The name of THIS
// tile is on the aria-label; the tooltip only says what the button is (KebabMenu
// carries the same constant).
const TRIGGER_TIP = 'More actions';

export default function TileMenu({ label, items }) {
  const visible = (items || []).filter(Boolean);
  const count = visible.length;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // Deps are the COUNT, not the items array: the array is rebuilt on every parent
  // render, so a per-render `place` identity would make any effect that depends on
  // it re-run, setPos a fresh object, and re-render for ever.
  //
  // `measuredH` is the panel's real height once it exists. Same-value writes return
  // the CURRENT object so React bails out — without that, the measure-and-replace
  // effect below would re-render for ever on a fresh object.
  const place = useCallback((measuredH) => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const next = placeMenu(b, {
      panelW: MENU_WIDTH,
      panelH: measuredH ?? (count * ROW_H + PANEL_PAD),
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });
    setPos((cur) => (cur.top === next.top && cur.left === next.left ? cur : next));
  }, [count]);

  // Re-place from the MEASURED height, before paint: a flipped panel hangs from its
  // own bottom edge, so an estimate that is a few pixels off puts it that far over
  // the trigger. useLayoutEffect, so the correction never reaches the screen.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    place(panelRef.current.getBoundingClientRect().height);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Capture phase + stopPropagation: the dashboard has window-level Escape
        // listeners (Layout mode's ladder) and the menu owns the key while open.
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const nodes = [...(panelRef.current?.querySelectorAll('button:not(:disabled)') || [])];
      if (!nodes.length) return;
      const i = nodes.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (i + 1 + nodes.length) % nodes.length
        : (i <= 0 ? nodes.length - 1 : i - 1);
      nodes[next].focus();
    };
    // A fixed panel is placed once, from the trigger's rect: any scroll or resize
    // moves the tile out from under it, so the menu closes instead of floating.
    const onMove = () => setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Measured in the HANDLER, not in the effect: useEffect runs after paint, so
  // placing there can flash the panel at {0,0} for one frame on the first open.
  const toggle = (e) => {
    e.stopPropagation();
    if (!open) place();
    setOpen(!open);
  };

  if (!count) return null;

  return (
    // --open keeps the corner control on a flow tile visible while its menu is up:
    // the pointer is over the portal, not the cell, so the cell's :hover is gone.
    <span className={`wgm-wrap${open ? ' wgm-wrap--open' : ''}`}>
      <button
        ref={btnRef} type="button" className="wgm-btn"
        aria-haspopup="menu" aria-expanded={open} aria-label={label} title={TRIGGER_TIP}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={panelRef} className="wgm-panel" role="menu" aria-label={label}
          style={{ top: pos.top, left: pos.left }}
        >
          {visible.map((it) => (
            <button
              key={it.key} type="button" role="menuitem"
              className={`wgm-item${it.danger ? ' wgm-item--danger' : ''}`}
              disabled={it.disabled} title={it.title || undefined}
              onClick={(e) => {
                e.stopPropagation();
                // A dialog opened by this action needs a stable return target:
                // the active menu item disappears when the menu closes.
                btnRef.current?.focus({ preventScroll: true });
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
