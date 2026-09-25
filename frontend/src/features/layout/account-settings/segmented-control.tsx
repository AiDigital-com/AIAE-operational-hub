import { cn } from "../../../shared/style/cn";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  options: SegmentedOption<T>[];
  value: T | null;
  disabled?: boolean;
  onChange: (value: T) => void;
}

/**
 * One segmented-control look shared by every section of Account Settings (Appearance, Daily
 * Summary, ...), so they read as the same control by construction instead of by two copies of the
 * JSX happening to agree today. See `.acct-settings__seg` in account-settings-modal.css: the track
 * sizes to its own buttons rather than stretching to the modal's width, so a two-option control
 * comes out shorter than a three-option one instead of the same width split into fatter buttons.
 */
export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  disabled,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="acct-settings__seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn("acct-settings__seg-btn", value === option.value && "acct-settings__seg-btn--active")}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
