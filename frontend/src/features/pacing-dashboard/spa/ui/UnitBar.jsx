import { highlightForeground, highlightTextStyle, highlightTitle, highlightFill } from './highlight-style.js';
// workspace/src/components/kit/UnitBar.jsx
//
// One delivery unit's row — lift of OverviewBlock1's DeliveryBar (:77), NoPlanRow
// (:146) and IndicatorRow (:168), which were always drawn as one thing: a header with
// the two percentages, the bar with its plan-pace tick, and the pace line under it.
// A unit with no goal set (`hasPlan: false`) shows its count and no bar — there is no
// pace to be on or off. `noPlanText` says why: «plan not set» by default, «no plan in this
// window» for a narrowed window that holds none of a unit's plan (brick-data deliveryUnits).
//
// The whole track is the flight (0→100% of plan); the coloured fill is actual delivery
// and the tick marks where delivery should be by now. The gap between them IS the pace
// delta printed underneath.
import { memo } from 'react';

const TONE = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)' };
const clamp = (n) => Math.max(0, Math.min(100, n || 0));

export default memo(function UnitBar({
  unit, hasPlan = true, noPlanText = 'plan not set', actualLabel, actualPct = 0, plannedPct = 0,
  paceDelta = 0, opText, status = 'g', highlight,
}) {
  if (!hasPlan) {
    return (
      <div className="kit-unitbar" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
        <div className="kit-unitbar-hd">
          <span className="kit-unitbar-u">{unit}</span>
          <span className="kit-unitbar-noplan" style={highlightForeground(highlight)}>{actualLabel} · {noPlanText}</span>
        </div>
      </div>
    );
  }
  const color = highlightFill(highlight) || TONE[status] || TONE.g;
  const sign = paceDelta >= 0 ? '+' : '−';
  const dir = paceDelta > 0.05 ? 'ahead of plan' : paceDelta < -0.05 ? 'behind plan' : 'on plan';
  return (
    <div className="kit-unitbar" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
      <div className="kit-unitbar-hd">
        <span className="kit-unitbar-u">{unit}</span>
        <span className="kit-unitbar-pcts" style={highlightForeground(highlight)}>
          Actual {actualPct.toFixed(1)}% <span className="kit-unitbar-sep">/</span> Plan {plannedPct.toFixed(1)}%
        </span>
      </div>
      <div className="kit-unitbar-bar">
        <div className="kit-unitbar-track">
          <div className="kit-unitbar-fill" style={{ width: `${clamp(actualPct).toFixed(1)}%`, background: color }} />
        </div>
        {/* Taller than the track so it reads as a tick; the halo keeps it visible over
            both the fill and the empty track. */}
        <div className="kit-unitbar-tick" style={{ left: `${clamp(plannedPct).toFixed(1)}%` }} />
      </div>
      <div className="kit-unitbar-ft">
        <span className="kit-unitbar-d" style={{ color }}>{sign}{Math.abs(paceDelta).toFixed(1)} pp</span>
        <span className="kit-unitbar-dir">{dir} ·</span>
        <span className="kit-unitbar-op" style={{ color }}>{opText}</span>
      </div>
    </div>
  );
});
