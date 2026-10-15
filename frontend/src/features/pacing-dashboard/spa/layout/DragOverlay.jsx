// workspace/src/pages/Dashboard/components/Layout/DragOverlay.jsx
//
// What Layout mode draws while a tile is carried (docs/2026-09-23-layout-drag.md). The page
// itself is frozen during a carry, so everything that changes lives here, never taking the
// pointer, in two layers (review 2026-09-23: one layer above the carried card tinted it blue
// and hid its lift shadow):
//   under the carried card (.lm-dragfx, z 20: above every resting tile, below the card's 30
//   and a sliding partner's 22, so the partner covers its own outline as it arrives)
//     slot          where the carried tile lands: a dashed accent box with a light wash
//     vacated       the space the tile leaves (place and insert only): a neutral dashed outline
//     partner-dest  where a swap partner goes: the same neutral outline
//   above it (.lm-dragfx--top, z 35: the hand must see these even under the card)
//     insert        a fresh row: a horizontal accent bar in the row gap
//     carry         the bar the hand holds for a tall tile, a full-row block or a tall group
//     edge pill     "Lands above" / "Lands below" when the landing mark is scrolled out of view
// Outlines, washes and horizontal bars only: never a stripe down a side (project rule).
//
// It owns its state, so a target change renders these few boxes and nothing else; LayoutMode
// and its cells do not re-render while a tile is carried. The bar and the pill follow the hand
// every frame, so LayoutMode positions those two through refs (their `transform` is never a
// prop here, so a render cannot put them back).

import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react';

const at = (r) => ({ transform: `translate3d(${r.left}px, ${r.top}px, 0)`, width: r.width, height: r.height });

const DragOverlay = forwardRef(function DragOverlay(_props, ref) {
  const [view, setView] = useState(null);
  const barRef = useRef(null);
  const pillRef = useRef(null);
  useImperativeHandle(ref, () => ({ setView, bar: barRef, pill: pillRef }), []);
  if (!view) return null;
  const { slot, insert, vacated, partners, carry, pill } = view;
  return (
    <>
      <div className="lm-dragfx" aria-hidden="true">
        {vacated && <div className="lm-vacated" style={at(vacated)} />}
        {(partners || []).map((p) => <div key={p.id} className="lm-partner-dest" style={at(p)} />)}
        {slot && <div className="lm-slot" style={at(slot)} />}
      </div>
      {(insert || carry || pill) && (
        <div className="lm-dragfx lm-dragfx--top" aria-hidden="true">
          {insert && (
            <div
              className="lm-insert"
              style={{ transform: `translate3d(${insert.left}px, ${insert.top}px, 0)`, width: insert.width }}
            />
          )}
          {carry && (
            <div ref={barRef} className="lm-flowghost lm-carry" style={{ width: carry.width }}>
              ≡ <span className="lm-carry-t">{carry.label}</span>
              <span className="lm-moving">moving…</span>
            </div>
          )}
          {pill && (
            <div ref={pillRef} className="lm-edgerow">
              <span className="lm-edgepill">
                <i className={pill === 'above' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} aria-hidden="true" />
                {pill === 'above' ? 'Lands above' : 'Lands below'}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
});

export default memo(DragOverlay);
