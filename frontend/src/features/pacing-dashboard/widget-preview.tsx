import { useLayoutEffect, useRef, useState } from "react";
import type { WidgetRenderContext } from "./widgets/widget-engine";
import { WidgetTile } from "./widgets/widget-engine";
import type { PacingWidgetInstance } from "./types";

/**
 * A thumbnail of what a widget actually DRAWS.
 *
 * The retired SPA's rule for this screen was "card-with-preview everywhere: never a plain list",
 * and it is not decoration. A widget's name says nothing about it - "Delivery, Pacing & Margin" is
 * four templates in this library - so a list of names asks the reader to remember what each one
 * looks like, or to add it and find out. The picture answers the only question the screen is for.
 *
 * It renders through the SAME engine the dashboard uses, on this pacing's own figures, so the
 * thumbnail is the widget rather than a drawing of one. Scaled by transform rather than re-styled
 * at thumbnail size: a miniature built from smaller fonts is a second layout to maintain, and it
 * drifts from the real one the first time either changes.
 *
 * Widgets are laid out for a dashboard column, not for a 260px card, so the content renders at its
 * DESIGN width and is scaled down to fit. `scale()` alone would leave the original's footprint
 * behind it, hence the measured height.
 */

/** The width each profile is laid out for on a real dashboard. Mirrors the SPA's own table. */
const PREVIEW_DESIGN_W: Record<string, number> = {
  section: 1160,
  card: 560,
  chart: 1160,
  table: 1160,
};

export function WidgetPreview({
  widget,
  ctx,
}: {
  widget: PacingWidgetInstance | null;
  ctx: WidgetRenderContext;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // The content's natural height, ignoring the transform. A short widget then shrinks its wrapper
  // to the scaled height and the cell's centring can do its job, instead of pinning a small
  // miniature to the top of a tall void.
  const [naturalH, setNaturalH] = useState<number | null>(null);

  useLayoutEffect(() => {
    const cell = boxRef.current;
    if (!cell) return undefined;
    const measure = () => {
      const rect = cell.getBoundingClientRect();
      setBox((cur) => (cur && cur.w === rect.width && cur.h === rect.height ? cur : { w: rect.width, h: rect.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    const measure = () => setNaturalH((cur) => (cur === el.offsetHeight ? cur : el.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // The inner element exists only once the cell has been measured.
  }, [box]);

  if (!widget) {
    // A linked instance whose library entry is gone. The card still has to list it so it can be
    // removed, and saying why there is no picture beats an empty frame that looks broken.
    return (
      <div className="pdl__prev pdl__prev--gone" aria-hidden="true">
        This widget&apos;s library entry is no longer available.
      </div>
    );
  }

  const designW = PREVIEW_DESIGN_W[widget.profile ?? "section"] ?? PREVIEW_DESIGN_W.section;
  const scale = box && box.w > 0 ? box.w / designW : null;
  const height =
    scale == null || box == null
      ? undefined
      : Math.min(box.h, naturalH != null ? Math.ceil(naturalH * scale) : box.h);

  return (
    // aria-hidden: the card's own name and kind are the accessible content. A screen reader walking
    // a scaled-down copy of a whole dashboard tile would read every figure in it, per card.
    <div className="pdl__prev" aria-hidden="true" ref={boxRef}>
      <div className="pdl__prev-scaled" style={{ height }}>
        {scale != null && (
          <div
            ref={innerRef}
            className="pdl__prev-inner"
            style={{ width: designW, transform: `scale(${scale})` }}
          >
            <WidgetTile widget={widget} ctx={ctx} />
          </div>
        )}
      </div>
    </div>
  );
}
