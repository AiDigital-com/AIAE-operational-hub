/**
 * Pixel coordinates of the text caret inside a `<textarea>`, via the hidden mirror-div technique (the
 * only reliable way for a plain textarea). Returns coordinates relative to the textarea's border box;
 * the caller adds `getBoundingClientRect()` to get viewport coordinates for a `position: fixed`
 * popover. A faithful TypeScript port of the retired SPA's
 * `workspace/src/lib/dashboard/caret-coords.js`. DOM-only - returns `null` outside a browser.
 */

const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

export interface CaretCoordinates {
  left: number;
  top: number;
  height: number;
}

/** @param position - caret index into `textarea.value` */
export function getCaretCoordinates(textarea: HTMLTextAreaElement | null, position: number): CaretCoordinates | null {
  if (typeof document === "undefined" || !textarea) return null;
  const style = window.getComputedStyle(textarea);

  const mirror = document.createElement("div");
  const s = mirror.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.top = "0";
  s.left = "-9999px";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  s.overflowWrap = "break-word";
  s.overflow = "hidden";
  for (const prop of MIRROR_PROPS) {
    (s as unknown as Record<string, string>)[prop] = style[prop as keyof CSSStyleDeclaration] as string;
  }

  const value = textarea.value || "";
  mirror.textContent = value.slice(0, position);
  const marker = document.createElement("span");
  // Non-empty content so the marker has a measurable box at line ends.
  marker.textContent = value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop;

  document.body.removeChild(mirror);
  return { left, top, height: lineHeight };
}
