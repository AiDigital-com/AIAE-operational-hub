import { useEffect, useId, useRef, useState } from "react";
import { FilterIcon, SearchIcon } from "../../shared/ui/icons/icons";

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  /** Label shown above the field inside the popover (e.g. "Full name"). */
  fieldLabel: string;
  /** Accessible label for the input. */
  ariaLabel: string;
  placeholder?: string;
}

/**
 * A "Filters" button that opens a popover holding a single name search field. Shared by the Users
 * and Teams tabs so both filter through the same control.
 */
export function SearchFilter({ value, onChange, fieldLabel, ariaLabel, placeholder = "Search…" }: SearchFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="team-mgmt__filters" ref={ref}>
      <button
        type="button"
        className="button button--secondary button--sm team-mgmt__filter-btn"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FilterIcon /> Filters
      </button>
      {open && (
        <div className="team-mgmt__filter-pop">
          <label className="team-mgmt__filter-label" htmlFor={inputId}>{fieldLabel}</label>
          <span className="team-mgmt__search">
            <SearchIcon />
            <input
              id={inputId}
              type="search"
              autoFocus
              aria-label={ariaLabel}
              placeholder={placeholder}
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          </span>
        </div>
      )}
    </div>
  );
}
