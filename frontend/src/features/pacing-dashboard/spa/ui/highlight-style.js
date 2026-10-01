import { highlightPaint, highlightTextStyle } from '../widget-highlights.js';

export { highlightPaint, highlightTextStyle };
export const highlightTitle = (highlight) => highlight?.notes?.length ? highlight.notes.join('\n') : undefined;
export const highlightFill = (highlight) => highlight?.style?.color ? highlightPaint(highlight.style.color) : undefined;
export const highlightBackground = (highlight) => highlight?.style?.background ? highlightTextStyle(highlight).backgroundColor : undefined;
export function highlightForeground(highlight) {
  const style = highlightTextStyle(highlight);
  if (!style) return undefined;
  const { backgroundColor, ...foreground } = style;
  return foreground;
}
