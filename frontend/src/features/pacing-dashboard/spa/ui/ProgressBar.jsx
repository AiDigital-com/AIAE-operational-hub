import { highlightForeground, highlightTextStyle, highlightTitle, highlightFill, highlightBackground } from './highlight-style.js';
// Fill + optional target tick («нужно сегодня»). Generalized from block1's
// DeliveryBar (OverviewBlock1.jsx:77) — that original stays untouched.
const TONE = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)' };
const clamp = (n) => Math.max(0, Math.min(100, n || 0));
export default function ProgressBar({ pct, tickPct, tickLabel, status = 'g', tone, size, highlight }) {
  return (
    <div className="kit-bar-wrap" title={highlightTitle(highlight)} style={highlightTextStyle(highlight)}>
      <div className={`kit-bar${size === 'compact' ? ' kit-bar--compact' : ''}`} style={highlightBackground(highlight) ? { background: highlightBackground(highlight) } : undefined}>
        <div className="kit-bar-fill" style={{ width: `${clamp(pct)}%`, background: highlightFill(highlight) || (tone === 'neutral' ? 'var(--text-primary)' : (TONE[status] || TONE.g)) }} />
        {tickPct != null && <div className="kit-bar-tick" style={{ left: `${clamp(tickPct)}%` }} />}
      </div>
      {tickLabel && <div className="kit-bar-ticklabel" style={highlightForeground(highlight)}>{tickLabel}</div>}
    </div>
  );
}
