import { cn } from "../../style/cn";
import "./margin-cell.css";

interface MarginCellProps {
  /** Actual margin percentage, or `null` when there is no margin data (e.g. a no-budget campaign). */
  actual: number | null;
  target: number;
  className?: string;
}

/**
 * Renders an actual-vs-target margin (e.g. "77.8% / 90%"), colored good/warn/bad by how far actual
 * trails target. Ported from the mockup's `marginCell()`.
 */
export function MarginCell({ actual, target, className }: MarginCellProps) {
  if (actual == null) {
    return <span className={cn("margin-cell", "margin-cell--na", className)}>—</span>;
  }
  const diff = actual - target;
  const modifier = diff >= 0 ? "good" : diff >= -5 ? "warn" : "bad";
  return (
    <span className={cn("margin-cell", `margin-cell--${modifier}`, className)}>
      {actual.toFixed(1)}% <span className="margin-cell__target">/ {target}%</span>
    </span>
  );
}
