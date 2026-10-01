import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// workspace/src/components/kit/KvRow.jsx
//
// Lift of OverviewBlock2's FinRow (:76-83): a label on the left, its figure on the
// right. `emphasis: 'strong'` is the SAME row said loudly — the recommendation strip
// the ready cards already use — so the two never drift into two components with one
// job. ("Spend today · to be on plan · $1,234/day" is a RecoStrip; "Cost Remaining
// $5,000" is a muted row; the vocabulary calls them one brick with two weights.)
import DeltaChip from './DeltaChip.jsx';
import RecoStrip from './RecoStrip.jsx';

export default function KvRow({ label, value, sub, emphasis = 'muted', comparison = null, highlight }) {
  const reading = highlight ? <span style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>{value}</span> : value;
  const shown = comparison ? <span className="kit-value-comparison">{reading}<DeltaChip tone={comparison.good ? 'g' : 'b'} text={comparison.text} /></span> : reading;
  if (emphasis === 'strong') return <RecoStrip label={label} sub={sub} value={shown} />;
  return (
    <div className="kit-kv">
      <span className="kit-kv-l">
        {label}
        {sub && <span className="kit-kv-s">{sub}</span>}
      </span>
      <span className="kit-kv-v">{shown}</span>
    </div>
  );
}
