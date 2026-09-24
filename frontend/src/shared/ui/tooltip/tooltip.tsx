import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../style/cn";
import "./tooltip.css";

/** Clear of the thing it explains, and of the window's own edges. */
const GAP = 8;
const EDGE = 8;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A hover/focus tooltip that stays inside the window.
 *
 * Rendered in a PORTAL and positioned against the viewport, because every caller sits inside a
 * scrolling table: a bubble positioned within that table is clipped at its edge, which is how the
 * alert badges on the Pacing Overview came to show a line of text nobody could read — the tail of it
 * was outside the box, and the head was off the screen.
 *
 * Measured, not guessed: the bubble is laid out, its real size read, and it is placed above its
 * anchor when there is room and below when there is not, then pulled back from whichever window edge
 * it would have crossed. That happens in a layout effect, so the corrected position is the first one
 * painted rather than a jump.
 *
 * Content WRAPS. It used to be one `nowrap` line, which is fine for three words and useless for the
 * twelve alerts a struggling pacing actually has.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPlace(null);
      return;
    }
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!bubble) return;
    // Above by preference - a bubble below the anchor covers the next rows of the table, which are
    // what somebody comparing two pacings is looking at.
    const above = anchor.top - bubble.height - GAP;
    const top = above >= EDGE ? above : anchor.bottom + GAP;
    // Centred on the anchor, then pulled back inside whichever edge it would have crossed. The outer
    // Math.max keeps a bubble wider than the window pinned to the left edge rather than past it.
    const left = Math.min(
      Math.max(EDGE, anchor.left + anchor.width / 2 - bubble.width / 2),
      Math.max(EDGE, window.innerWidth - bubble.width - EDGE)
    );
    setPlace((current) => (current?.top === top && current?.left === left ? current : { top, left }));
  }, [anchor]);

  // Anything that moves the anchor dismisses it rather than leaving the bubble stranded where the
  // anchor used to be. Capture phase, because the scroller is the table, not the window.
  useEffect(() => {
    if (!anchor) return undefined;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor]);

  const show = () => setAnchor(anchorRef.current?.getBoundingClientRect() ?? null);
  const hide = () => setAnchor(null);

  return (
    <span
      ref={anchorRef}
      className={cn("tooltip", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={anchor ? id : undefined}
    >
      {children}
      {anchor &&
        createPortal(
          <div
            id={id}
            ref={bubbleRef}
            role="tooltip"
            className="tooltip__bubble"
            // Off-screen until measured. The layout effect above corrects it before the browser
            // paints, so this position is never seen.
            style={{ top: place?.top ?? -9999, left: place?.left ?? -9999 }}
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
}
