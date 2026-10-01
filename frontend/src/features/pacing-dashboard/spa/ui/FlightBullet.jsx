import { highlightForeground, highlightTextStyle, highlightTitle, highlightFill } from './highlight-style.js';
export default function FlightBullet({ day, total, daysLeftText, highlight }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (day / total) * 100)) : 0;
  return (
    <div className="kit-flight" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
      <div className="kit-flight-day" style={highlightForeground(highlight)}>{`Day ${day} / ${total}`}</div>
      <div className="kit-flight-track"><div className="kit-flight-fill" style={{ width: `${pct}%`, ...(highlightFill(highlight) ? { background: highlightFill(highlight) } : {}) }} /></div>
      {daysLeftText && <div className="kit-flight-left" style={highlightForeground(highlight)}>{daysLeftText}</div>}
    </div>
  );
}
