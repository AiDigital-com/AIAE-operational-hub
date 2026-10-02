// workspace/src/pages/Dashboard/components/LineItemList/PaceBar.jsx
import { memo } from 'react';
import { useDashboardStore } from '../store.js';
import { fPP } from '../format.js';
import PacingCore from '../pacing-core.js';

/**
 * PaceBar — centered bar indicator showing pacing imbalance (%).
 *
 * Props:
 *   value  {number}  pacing imbalance % from PacingCore.pacingIndex()
 *   status {string}  optional override: 'not_started'|'no_data'|'active'|'ended'
 *
 * Mirror of vanilla paceBar(pp, st) in render.js.
 */
function PaceBar({ value, status }) {
  const notify = useDashboardStore((s) => s.notify);
  const cfg = notify?.alerts?.pacing_off_pace || {};
  const pacingLow = cfg.low ?? -5;
  const pacingHigh = cfg.high ?? 5;

  // N/A states — show dash with empty track
  if (status === 'not_started' || status === 'no_data') {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-13 font-semibold min-w-[52px] whitespace-nowrap text-[var(--text-muted)]">
          —
        </span>
        <div className="w-14 h-[5px] bg-[var(--border-soft)] rounded-full flex-shrink-0 relative">
          <div className="absolute left-1/2 w-px h-full bg-[var(--border-hover)]" />
        </div>
      </div>
    );
  }

  const ps = PacingCore.pacingStatus(value, pacingLow, pacingHigh);
  const colorVar =
    ps === 'g' ? 'var(--status-green)' :
    ps === 'b' ? 'var(--status-red)' :
    'var(--status-amber)';

  const textCls =
    ps === 'g' ? 'text-[var(--status-green)]' :
    ps === 'b' ? 'text-[var(--status-red)]' :
    'text-[var(--status-amber)]';

  // Clamp to ±20 pp for bar width, matching vanilla (20 = 50% of bar)
  const clamped = Math.min(20, Math.max(-20, value));
  const bw = (Math.abs(clamped) / 20) * 50;
  const bl = value >= 0 ? 50 : 50 - bw;

  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-13 font-semibold min-w-[52px] whitespace-nowrap ${textCls}`}>
        {fPP(value)}
      </span>
      <div
        className="w-14 h-[5px] bg-[var(--border-soft)] rounded-full flex-shrink-0 relative"
        style={{ width: '56px' }}
      >
        {/* Center tick */}
        <div className="absolute left-1/2 w-px h-full bg-[var(--border-hover)]" />
        {/* Fill bar */}
        <div
          className="absolute h-full rounded-full transition-[width,left] duration-300"
          style={{
            left: `${bl.toFixed(1)}%`,
            width: `${bw.toFixed(1)}%`,
            background: colorVar,
          }}
        />
      </div>
    </div>
  );
}

export default memo(PaceBar);
