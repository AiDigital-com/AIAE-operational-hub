import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// A headline figure. `caption` finishes the sentence the number starts ("84%" · "of
// plan-to-date") and sits beside it; `label` NAMES the number ("Our Cost Plan") and
// sits above it, the way every labelled figure in a finance card does. Existing callers
// pass no label and are unchanged.
const TONE = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)' };
export default function BigStat({ value, caption, status, label, highlight }) {
  const stat = (
    <div className="kit-bigstat">
      <span className="kit-bigstat-v" title={highlightTitle(highlight)} style={{ ...(status ? { color: TONE[status] } : {}), ...highlightTextStyle(highlight) }}>{value}</span>
      {caption && <span className="kit-bigstat-c">{caption}</span>}
    </div>
  );
  if (!label) return stat;
  return (
    <div className="kit-bigstat-w">
      <span className="kit-bigstat-l">{label}</span>
      {stat}
    </div>
  );
}
