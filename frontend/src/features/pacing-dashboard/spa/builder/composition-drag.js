export const COMPOSITION_DRAG_THRESHOLD = 5;
export const COMPOSITION_SCROLL_EDGE = 40;
export const COMPOSITION_SCROLL_STEP = 12;

export function dragThresholdPassed(origin, point, threshold = COMPOSITION_DRAG_THRESHOLD) {
  return Math.hypot(point.x - origin.x, point.y - origin.y) >= threshold;
}

function topLevelTracks(template) {
  const text = String(template || '').trim();
  if (!text || text === 'none') return [];
  const tracks = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (/\s/.test(char) && depth === 0) {
      if (index > start) tracks.push(text.slice(start, index));
      while (/\s/.test(text[index + 1] || '')) index += 1;
      start = index + 1;
    }
  }
  if (start < text.length) tracks.push(text.slice(start));
  return tracks;
}

/** CSS resolves repeat() to tracks in browsers, but retaining this case makes the
 * geometry helper truthful in tests and in DOM implementations that keep the token. */
export function renderedDropAxis(declaredAxis, gridTemplateColumns) {
  if (declaredAxis !== 'row') return 'column';
  const tracks = topLevelTracks(gridTemplateColumns);
  if (tracks.length > 1) return 'row';
  return /^repeat\(\s*(?:[2-9]|[1-9]\d+)\s*,/i.test(tracks[0] || '') ? 'row' : 'column';
}

export function pointFraction(point, rect, axis) {
  const horizontal = axis === 'row';
  const start = horizontal ? rect.left : rect.top;
  const length = horizontal ? rect.width : rect.height;
  return ((horizontal ? point.x : point.y) - start) / Math.max(1, length);
}

function edgeDelta(value, start, end, edge, step) {
  const zone = Math.max(1, Math.min(edge, (end - start) / 2));
  if (value >= start - zone && value < start + zone) {
    return -Math.max(1, Math.ceil(step * Math.min(1, (start + zone - value) / zone)));
  }
  if (value <= end + zone && value > end - zone) {
    return Math.max(1, Math.ceil(step * Math.min(1, (value - end + zone) / zone)));
  }
  return 0;
}

/** Continue scrolling slightly beyond a clipped edge so a pointer can reach content
 * that is not yet visible without having to balance on the last rendered pixel. */
export function compositionScrollDelta(rect, point, edge = COMPOSITION_SCROLL_EDGE, step = COMPOSITION_SCROLL_STEP) {
  return {
    x: edgeDelta(point.x, rect.left, rect.right, edge, step),
    y: edgeDelta(point.y, rect.top, rect.bottom, edge, step),
  };
}

export function pointNearRect(rect, point, margin = COMPOSITION_SCROLL_EDGE) {
  return point.x >= rect.left - margin && point.x <= rect.right + margin
    && point.y >= rect.top - margin && point.y <= rect.bottom + margin;
}
