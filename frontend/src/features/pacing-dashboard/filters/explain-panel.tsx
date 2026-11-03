/**
 * The one explanation panel the spotlight rows and the applied-filter chips share - ported from the
 * reference's `FilterExplainPanel.jsx` (filter spotlight spec 2026-10-01). Two lines (what the
 * filter touches, and the Scope/Lens sentence), an optional note, and - for a value group - what
 * the group stands for. A portal with `position: fixed`, placed to the right of its anchor when
 * there is room, else below it, flipped above when that does not fit, clamped to the viewport;
 * `pointer-events: none`, so it never steals the hover that opened it. Owned by `FilterBar`; the
 * callers hand it an `ExplainTarget` or null. A plain surfaced panel - no left rail, no stripe.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExplainContent } from "./spotlight-core";
import "./explain-panel.css";

/** The panel's content plus where its anchor sits on screen. */
export interface ExplainTarget extends ExplainContent {
  rect: Pick<DOMRect, "top" | "right" | "bottom" | "left">;
}

/** How long a pointer rests on a row or a chip before the panel shows - the reference's own. */
export const EXPLAIN_HOVER_DELAY_MS = 300;

export const EXPLAIN_PANEL_ID = "fb-explain";

const PANEL_W = 300;
const GAP = 8;
const EDGE = 8;

/** Where the panel goes for an anchor rect - pure, for the test. */
export function placeExplainPanel(
  rect: ExplainTarget["rect"],
  panel: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const { width: w, height: h } = panel;
  const { width: vw, height: vh } = viewport;
  if (rect.right + GAP + w <= vw - EDGE) {
    return { left: rect.right + GAP, top: Math.min(Math.max(EDGE, rect.top), Math.max(EDGE, vh - h - EDGE)) };
  }
  const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, vw - w - EDGE));
  const below = rect.bottom + GAP;
  const top = below + h <= vh - EDGE ? below : Math.max(EDGE, rect.top - GAP - h);
  return { left, top };
}

export function ExplainPanel({ target }: { target: ExplainTarget | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!target || !ref.current) {
      setPos(null);
      return;
    }
    const el = ref.current;
    setPos(
      placeExplainPanel(
        target.rect,
        { width: el.offsetWidth || PANEL_W, height: el.offsetHeight || 60 },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [target]);
  if (!target) return null;
  return createPortal(
    <div
      ref={ref}
      id={EXPLAIN_PANEL_ID}
      role="tooltip"
      className="fb-explain"
      style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, width: PANEL_W }}
    >
      <div className="fb-explain__title">{target.title}</div>
      <div className="fb-explain__sentence">{target.sentence}</div>
      {target.note && <div className="fb-explain__note">{target.note}</div>}
      {target.members && <div className="fb-explain__members">{target.members}</div>}
    </div>,
    document.body
  );
}
