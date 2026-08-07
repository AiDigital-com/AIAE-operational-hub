import { cn } from "../../style/cn";
import "./toggle.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  sub?: string;
  className?: string;
}

/** A labeled on/off switch row: label (+ optional sub-label) on the left, the switch on the right. */
export function Toggle({ checked, onChange, label, sub, className }: ToggleProps) {
  return (
    <div className={cn("toggle-row", className)}>
      <div>
        <div className="toggle-row__label">{label}</div>
        {sub && <div className="toggle-row__sub">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn("toggle-row__switch", checked && "toggle-row__switch--on")}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
