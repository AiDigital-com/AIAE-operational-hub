// workspace/src/pages/Dashboard/components/Settings/LiSelect.jsx
//
// The one line-item <select> the mapping editors share — five hand-written copies
// before this (the sheet tab binding, its split rules, the additional-data single
// row and both line-item-matching pickers). Same .sp-inp control, same options.
//
// With `onAddLineItem` it grows a last option, «＋ Add line item…», that opens the
// Add-LI dialog instead of picking (owner ask 2026-09-11: an LI is often found
// missing exactly here, mid-mapping). The dialog answers through `bind`: the FIRST
// id it adds is picked into THIS select, so the row the person was on gets the line
// item they went to fetch, and the rest are simply in the list from then on.
import { useRef } from 'react';

export const ADD_LI_OPTION = '__add_li__';

// Keys that only MOVE the highlight. A COLLAPSED <select> fires `change` on each of
// them in Chrome and Firefox, so walking the list with the keyboard would otherwise
// open the dialog by itself the moment the highlight reached the last entry. On
// those the value is put back and nothing happens; committing from the OPEN list
// (Enter, where arrows do not fire change) or with the pointer opens it as asked.
const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

export default function LiSelect({
  value, onChange, lineItems, takenIds = [], disabled = false,
  className = 'sp-inp', placeholder = '— pick —', children = null, onAddLineItem = null,
  ...rest
}) {
  const lastKeyRef = useRef(null);
  const handleChange = (event) => {
    const next = event.target.value;
    if (next === ADD_LI_OPTION) {
      // A controlled select shows whatever the browser just chose until React
      // re-renders, and nothing in state changes here — so put the old value back
      // by hand either way.
      event.target.value = value ?? '';
      const moved = MOVE_KEYS.has(lastKeyRef.current);
      lastKeyRef.current = null;
      if (moved) return;
      onAddLineItem?.((ids) => { if (Array.isArray(ids) && ids.length) onChange(String(ids[0])); });
      return;
    }
    lastKeyRef.current = null;
    onChange(next);
  };
  return (
    <select
      className={className}
      value={value ?? ''}
      disabled={disabled}
      onChange={handleChange}
      {...rest}
      onKeyDown={(e) => { lastKeyRef.current = e.key; rest.onKeyDown?.(e); }}
      onPointerDown={(e) => { lastKeyRef.current = null; rest.onPointerDown?.(e); }}
    >
      {children ?? <option value="">{placeholder}</option>}
      {(lineItems || []).map((li) => (
        <option key={li.id} value={li.id} disabled={takenIds.includes(String(li.id))}>{li.label}</option>
      ))}
      {onAddLineItem && <option value={ADD_LI_OPTION}>＋ Add line item…</option>}
    </select>
  );
}
