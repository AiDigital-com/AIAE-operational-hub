import { useState } from "react";
import { fmtEditableNumber, rawNumber } from "./format";

/**
 * A plan-value input: shows the raw digits while focused (so typing is not fighting a live
 * comma-formatter) and a comma-grouped display once blurred (so a resting value reads like a number,
 * not a raw float). Used for every editable plan figure on the Create Pacing review panel (§8,
 * US-124) - budget, impressions, margin, CTR, VCR.
 */
export function NumericField({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused ? rawNumber(value) : fmtEditableNumber(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
