import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// workspace/src/components/kit/NoteLine.jsx
//
// One caption line. Lift of OverviewBlock1's centred flight footer (:532-538) and of
// the muted sub-lines the hero signals carry above their numbers (:480, :505) —
// `align` picks which, `tone` colours the one that states a deviation.
export default function NoteLine({ text, align = 'start', tone, style, highlight }) {
  if (!text) return null;
  const cls = `kit-note${align === 'center' ? ' kit-note--c' : ''}${tone ? ` kit-note--${tone}` : ''}${style ? ` kit-note--${style}` : ''}`;
  return <div className={cls} style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>{text}</div>;
}
