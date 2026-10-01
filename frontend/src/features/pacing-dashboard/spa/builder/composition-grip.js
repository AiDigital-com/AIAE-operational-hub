const HIT_SIZE = 28;
const VISUAL_INSET = 4;
const VISUAL_SIZE = 20;

const CANDIDATES = Object.freeze([
  Object.freeze({ name: 'corner', dx: -14, dy: -14 }),
  Object.freeze({ name: 'above', dx: -14, dy: -24 }),
  Object.freeze({ name: 'right', dx: -4, dy: -14 }),
  Object.freeze({ name: 'above-right', dx: -4, dy: -24 }),
]);

const area = (rect) => Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);

export function intersectGripRects(a, b) {
  const rect = {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  };
  return area(rect) ? rect : null;
}

const overlapArea = (a, b) => area(intersectGripRects(a, b) || { left: 0, top: 0, right: 0, bottom: 0 });

/**
 * Pick one of four positions attached to the same top-right corner. The visible 20px
 * square, rather than its transparent 28px hit area, is what may not cover text.
 * Bounds still apply to the whole hit area so keyboard and pointer targeting stay intact.
 */
export function compositionGripPlacement(corner, textRects = [], bounds = null) {
  const options = CANDIDATES.map((candidate, order) => {
    const hit = {
      left: corner.x + candidate.dx, top: corner.y + candidate.dy,
      right: corner.x + candidate.dx + HIT_SIZE, bottom: corner.y + candidate.dy + HIT_SIZE,
    };
    const visual = {
      left: hit.left + VISUAL_INSET, top: hit.top + VISUAL_INSET,
      right: hit.left + VISUAL_INSET + VISUAL_SIZE, bottom: hit.top + VISUAL_INSET + VISUAL_SIZE,
    };
    const overlap = textRects.reduce((sum, rect) => sum + overlapArea(visual, rect), 0);
    const inside = bounds ? overlapArea(hit, bounds) : area(hit);
    return { ...candidate, order, overlap, outside: area(hit) - inside, hit, visual };
  });
  const clear = options.find((candidate) => candidate.outside === 0 && candidate.overlap === 0);
  if (clear) return clear;
  // Dense compositions can occupy every candidate. Prefer a complete hit target, then
  // the least covered text; stable declaration order makes an unavoidable tie predictable.
  return options.reduce((best, candidate) => (
    candidate.outside < best.outside
      || (candidate.outside === best.outside && candidate.overlap < best.overlap)
      ? candidate : best
  ));
}
