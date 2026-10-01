import { highlightForeground, highlightTextStyle, highlightTitle, highlightFill } from './highlight-style.js';
// Gradient scale + marker + target line. FIXED scale (spec §5.4): callers pass
// min/max derived from the TARGET ([target−20, target+10] clamped 0-100), so
// the scale never moves with the value. Off-scale values clamp to the track
// edge and show an out-of-range arrow.
export default function BulletMeter({ value, target, min, max, valueLabel, targetLabel, invert = false, minLabel, maxLabel, highlight }) {
  const span = max - min || 1;
  const pos = ((value - min) / span) * 100;
  const tpos = ((target - min) / span) * 100;
  const clamped = Math.max(0, Math.min(100, pos));
  const off = pos < 0 ? 'lo' : pos > 100 ? 'hi' : null;
  return (
    <div className="kit-meter" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
      <div className="kit-meter-track" style={invert ? { background: 'linear-gradient(90deg, var(--status-green), var(--status-amber), var(--status-red))' } : undefined}>
        <div className="kit-meter-target" style={{ left: `${Math.max(0, Math.min(100, tpos))}%` }} />
        <div className={`kit-meter-marker${off ? ' kit-meter-marker--off' : ''}`} style={{ left: `${clamped}%`, ...(highlightFill(highlight) ? { background: highlightFill(highlight), color: highlightFill(highlight) } : {}) }}>
          {off === 'lo' ? '◂' : off === 'hi' ? '▸' : ''}
        </div>
      </div>
      <div className="kit-meter-labels">
        <span>{minLabel ?? `${min}%`}</span>
        {valueLabel && <span className="kit-meter-vl" style={highlightForeground(highlight)}>{valueLabel}</span>}
        {targetLabel && <span className="kit-meter-tl">{targetLabel}</span>}
        <span>{maxLabel ?? `${max}%`}</span>
      </div>
    </div>
  );
}
