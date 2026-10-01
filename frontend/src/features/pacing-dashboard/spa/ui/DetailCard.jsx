import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// workspace/src/components/kit/DetailCard.jsx
//
// Lift of OverviewBlock1's DetailCard (:24-37) with UnitStack (:42) and StatStack
// (:54) folded into it. Those two stacks differed in exactly one thing — whether a
// line carries its own explainer underneath — so they are one list here, and the
// gap tightens when no line has one, which is what UnitStack's 2px was for.
//
// `lines` is [{ value, unit, note, muted }]: the number, its unit word, the sentence
// under it, and whether it is a "plan not set" placeholder rather than a figure.
import { memo } from 'react';

const TONE = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)' };

export default memo(function DetailCard({ label, lines, sub, status, highlight }) {
  const rows = (lines || []).filter(Boolean);
  const spaced = rows.some((r) => r.note);
  const tone = status ? TONE[status] : null;
  return (
    <div className="kit-detail">
      <div className="kit-detail-l">{label}</div>
      <div className={`kit-detail-vs${spaced ? ' kit-detail-vs--notes' : ''}`}>
        {rows.map((r, i) => (
          <div key={i}>
            <div
              className={`kit-detail-v${r.muted ? ' kit-detail-v--muted' : ''}`}
              title={highlightTitle(r.highlight || highlight)}
              style={{ ...(tone && !r.muted ? { color: tone } : {}), ...highlightTextStyle(r.highlight || highlight) }}
            >
              <span className="kit-detail-value">{r.value}</span>
              {r.unit && <span className="kit-detail-u">{r.unit}</span>}
            </div>
            {r.note && <div className="kit-detail-n">{r.note}</div>}
          </div>
        ))}
      </div>
      {sub && <div className="kit-detail-s">{sub}</div>}
    </div>
  );
});
