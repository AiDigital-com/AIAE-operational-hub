import { cn } from "../../style/cn";
import "./pacing-bar.css";

interface PacingBarProps {
  /** Pacing deviation in percentage points, or `null` when there is no pacing figure to show. */
  pp: number | null;
  className?: string;
}

const CLAMP_RANGE = 45;

/**
 * A pacing-deviation bar: a marker + fill on a center axis, ported from the mockup's `pacingCell()`.
 * Extreme deviations (e.g. +9515pp) clamp visually to ±{@link CLAMP_RANGE} so the bar never overflows.
 */
export function PacingBar({ pp, className }: PacingBarProps) {
  if (pp == null) {
    return (
      <div className={cn("pacing-bar", className)}>
        <span className="pacing-bar__value" style={{ color: "var(--muted)" }}>—</span>
        <div className="pacing-bar__track">
          <div className="pacing-bar__center" />
        </div>
      </div>
    );
  }

  const bounded = pp > 1000 ? CLAMP_RANGE : pp < -1000 ? -CLAMP_RANGE : pp;
  const clamped = Math.max(-CLAMP_RANGE, Math.min(CLAMP_RANGE, bounded));
  const position = 50 + clamped;
  const color = pp >= 0 ? "var(--good)" : "var(--bad)";
  const left = Math.min(50, position);
  const width = Math.abs(position - 50);

  return (
    <div className={cn("pacing-bar", className)}>
      <span className="pacing-bar__value" style={{ color }}>
        {pp > 0 ? "+" : ""}
        {pp.toFixed(1)} pp
      </span>
      <div className="pacing-bar__track">
        <div className="pacing-bar__center" />
        <div className="pacing-bar__fill" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
        <div className="pacing-bar__marker" style={{ left: `${position}%`, background: color }} />
      </div>
    </div>
  );
}
