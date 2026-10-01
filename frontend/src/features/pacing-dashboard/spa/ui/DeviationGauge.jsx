import { highlightTextStyle, highlightTitle, highlightFill } from './highlight-style.js';
// workspace/src/components/kit/DeviationGauge.jsx
//
// Lift of OverviewBlock1's margin deviation bar (:509-524): a ±spread scale with the
// target at the midpoint and a fill that grows OUT from that midpoint — left when the
// value is under, right when it is over. Off-scale deviations clamp to the edge.
//
// It draws nothing without both numbers: a centre-anchored fill with no reference is
// not a smaller signal, it is a wrong one.
import { memo } from 'react';

const TONE = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)' };

export default memo(function DeviationGauge({
  value, target, spread = 10, status = 'g', unit = 'pp', minLabel, maxLabel, targetLabel = 'Target', highlight,
}) {
  if (value == null || target == null || !(spread > 0)) return null;
  const delta = value - target;
  const clamped = Math.max(-spread, Math.min(spread, delta));
  const width = (Math.abs(clamped) / spread) * 50;
  const left = delta >= 0 ? 50 : 50 - width;
  return (
    <div className="kit-gauge" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
      <div className="kit-gauge-track">
        <div
          className="kit-gauge-fill"
          style={{ left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%`, background: highlightFill(highlight) || TONE[status] || TONE.g }}
        />
        <div className="kit-gauge-mid" />
      </div>
      <div className="kit-gauge-labels">
        <span>{minLabel ?? `${'−'}${spread}${unit ? ` ${unit}` : ''}`}</span>
        <span>{targetLabel}</span>
        <span>{maxLabel ?? `+${spread}${unit ? ` ${unit}` : ''}`}</span>
      </div>
    </div>
  );
});
