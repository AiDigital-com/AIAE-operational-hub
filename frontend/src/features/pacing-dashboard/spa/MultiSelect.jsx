// workspace/src/components/ui/MultiSelect.jsx
//
// Searchable MULTI-select — SearchSelect's sibling for "pick any subset"
// controls (first use: delegation pacing scope). Same portal/flip/clamp
// popup and type-to-filter; rows toggle checkboxes and the popup stays open
// while picking. An empty selection means the caller's "all" semantics —
// the built-in first row states and restores that.
//
// Props:
//   selected     array of selected values ([] = all/none — caller's semantics)
//   onChange     (nextArray) => void
//   emptyLabel   trigger + first-row label for the empty selection
//   options      [{ value, label }] — pre-sorted by the caller
//   width        trigger max-width (default 190)

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const POPUP_GAP = 4;
const VIEWPORT_PAD = 8;
// 310, not Pacing's 120: this popup is a portal on <body> and the Hub's settings drawer
// (.sheet__overlay) sits at 300, so anything lower is painted behind the drawer that
// opened it. Matches .sp-pop in pacing-spa.css, whose comment carries the full scale.
const POPUP_Z_INDEX = 310;
const POPUP_W = 280;
const MAX_LIST_H = 288;

export default function MultiSelect({ selected, onChange, emptyLabel, options, width = 190, maxSelected = null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const inputRef = useRef(null);

  const sel = useMemo(() => new Set(selected || []), [selected]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [{ value: null, label: emptyLabel }, ...options];
    return q ? base.filter((o) => o.label.toLowerCase().includes(q)) : base;
  }, [query, options, emptyLabel]);

  useEffect(() => { setHover(0); }, [query, open]);

  useEffect(() => {
    function handleClick(e) {
      const inTrigger = ref.current && ref.current.contains(e.target);
      const inPopup = popupRef.current && popupRef.current.contains(e.target);
      if (!inTrigger && !inPopup) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Escape belongs to the innermost open thing — window CAPTURE + stopPropagation,
  // the idiom ConfirmModal and TileMenu already use. The popup carries the Settings
  // drawer's `[data-dp-popup="1"]` marker too, but the marker alone does not hold:
  // measured, a React onKeyDown that closes this panel runs at the portal container
  // and React flushes the unmount in the microtask BEFORE the window bubble
  // listeners, so the drawer's guard finds no marker left and closes the drawer on
  // an Escape aimed at the panel — dropping every unsaved edit in it.
  // A LAYOUT effect, not a passive one: the panel takes focus before paint, and a
  // passive listener would leave one frame in which the key still travelled.
  useLayoutEffect(() => {
    if (!open) return undefined;
    function onEscape(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    function place() {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const w = popupRef.current?.offsetWidth || POPUP_W;
      const h = popupRef.current?.offsetHeight || MAX_LIST_H + 44;
      const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - w - VIEWPORT_PAD);
      const left = Math.min(Math.max(VIEWPORT_PAD, r.left), maxLeft);
      let top = r.bottom + POPUP_GAP;
      const fitsBelow = top + h <= window.innerHeight - VIEWPORT_PAD;
      const fitsAbove = r.top - h - POPUP_GAP >= VIEWPORT_PAD;
      if (!fitsBelow && fitsAbove) top = r.top - h - POPUP_GAP;
      else if (!fitsBelow) top = Math.max(VIEWPORT_PAD, window.innerHeight - h - VIEWPORT_PAD);
      setPos({ top, left });
    }
    place();
    inputRef.current?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  function toggle(v) {
    if (v === null) { onChange([]); return; } // "all" row resets the subset
    const next = new Set(sel);
    if (next.has(v)) next.delete(v);
    else {
      // Hard cap (optional): refuse the selection here instead of letting a
      // whole Save bounce on the server's list limit later.
      if (maxSelected != null && next.size >= maxSelected) return;
      next.add(v);
    }
    onChange([...next]);
  }
  // Escape is not here: the capture listener above consumes it before React
  // dispatches, so a branch for it would be dead code that reads live.
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hover]) toggle(rows[hover].value); }
  }

  const triggerLabel = sel.size === 0
    ? emptyLabel
    : sel.size === 1
      ? (options.find((o) => sel.has(o.value))?.label ?? '1 selected')
      : `${sel.size} selected`;

  return (
    <div ref={ref} className="relative inline-block" style={{ maxWidth: '100%' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-12 flex items-center gap-1.5"
        title={emptyLabel}
        style={{
          height: 32, padding: '0 8px', borderRadius: 'var(--rs)',
          border: '1px solid var(--border-soft)', background: 'var(--surface)',
          color: sel.size === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
          fontFamily: 'var(--font-sans)', outline: 'none', maxWidth: width,
        }}
      >
        <span className="truncate">{triggerLabel}</span>
        <i className="ri-arrow-down-s-line" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          data-dp-popup="1"
          onKeyDown={onKey}
          style={{
            position: 'fixed',
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            zIndex: POPUP_Z_INDEX,
            visibility: pos ? 'visible' : 'hidden',
            width: POPUP_W,
            background: 'var(--surface)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--dash-radius-popup, var(--rm))',
            boxShadow: 'var(--shadow-pop)',
            overflow: 'hidden',
          }}
        >
          <div className="p-2" style={{ borderBottom: '1px solid var(--border-softer)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="text-12"
              style={{
                width: '100%', boxSizing: 'border-box', height: 28, padding: '0 8px',
                border: '1px solid var(--border-soft)', borderRadius: 'var(--rs)',
                background: 'var(--surface-alt)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', outline: 'none',
              }}
            />
          </div>
          <div style={{ maxHeight: MAX_LIST_H, overflowY: 'auto', padding: '4px 0' }} role="listbox" aria-multiselectable="true">
            {rows.length === 0 && (
              <div className="text-12" style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>No matches</div>
            )}
            {rows.map((o, i) => {
              const isAllRow = o.value === null;
              const checked = isAllRow ? sel.size === 0 : sel.has(o.value);
              return (
                <button
                  key={o.value ?? '__all__'}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => toggle(o.value)}
                  className="text-12 gap-2"
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%',
                    textAlign: 'left', padding: '6px 12px', border: 'none', cursor: 'pointer',
                    background: i === hover ? 'var(--hover-bg)' : 'transparent',
                    color: checked ? 'var(--accent)' : 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: checked ? 600 : 400,
                  }}
                >
                  <i
                    className={isAllRow
                      ? (checked ? 'ri-radio-button-line' : 'ri-circle-line')
                      : (checked ? 'ri-checkbox-line' : 'ri-checkbox-blank-line')}
                    style={{ color: checked ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }}
                    aria-hidden="true"
                  />
                  <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
