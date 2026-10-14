/**
 * Period scope - the reference's Full Flight / Period Scope toggle (`FilterBar.jsx:793-811`), its
 * `PeriodPicker.jsx` and `PeriodScopeBanner.jsx`, ported to BEM + TypeScript like the rest of this
 * filter bar. Behaviour and copy are the reference's; the state itself is resolved in
 * `spa/store.js` (`usePacingState`) and saved by the page (`pacing-dashboard.tsx`).
 *
 * A period is one `fs..fe` window the line items' containers define (`PacingCore.extractPeriods`):
 * date splits first, standalone sub-window containers second. Its key is `fs|fe`.
 */
import { useEffect, useRef, useState } from "react";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { fD } from "../spa/format.js";
import "./period-scope.css";

export interface ScopePeriod {
  fs: string;
  fe: string;
  label?: string | null;
}

/** `PacingCore.periodKeyOf`, restated: the key a period is saved and compared by. */
export function periodKeyOf(period: ScopePeriod): string {
  return `${period.fs}|${period.fe}`;
}

/** The reference's `formatPeriod`: the period's own name when it has one that is not just its
 *  dates, else its dates WITH the year - periods can span years, and "Jul 1 – Jun 30" is ambiguous. */
function formatPeriod(period: ScopePeriod): string {
  const autoLabel = `${period.fs} – ${period.fe}`;
  if (period.label && period.label !== autoLabel) return period.label;
  return `${fD(period.fs)} – ${fD(period.fe)}`;
}

export interface PeriodScopeControlProps {
  scoped: boolean;
  periods: readonly ScopePeriod[];
  selectedKey: string | null;
  onToggle: (mode: "full" | "period") => void;
  onSelect: (key: string) => void;
}

/** The segmented toggle, and - while scoped - the period picker beside it. */
export function PeriodScopeControl({ scoped, periods, selectedKey, onToggle, onSelect }: PeriodScopeControlProps) {
  return (
    <div className="fb-scope">
      <div className="fb-seg" role="group" aria-label="Period scope">
        <button
          type="button"
          className={`fb-seg__btn${scoped ? "" : " fb-seg__btn--active"}`}
          aria-pressed={!scoped}
          onClick={() => onToggle("full")}
        >
          Full Flight
        </button>
        <button
          type="button"
          className={`fb-seg__btn${scoped ? " fb-seg__btn--active" : ""}`}
          aria-pressed={scoped}
          onClick={() => onToggle("period")}
        >
          Period Scope
        </button>
      </div>
      {scoped && <PeriodPicker periods={periods} selectedKey={selectedKey} onSelect={onSelect} />}
    </div>
  );
}

interface PeriodPickerProps {
  periods: readonly ScopePeriod[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/** The reference's `PeriodPicker.jsx`. Hidden with one period or none - nothing to choose between. */
function PeriodPicker({ periods, selectedKey, onSelect }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (periods.length <= 1) return null;
  const selected = periods.find((period) => periodKeyOf(period) === selectedKey);

  function handleSelect(key: string) {
    setOpen(false);
    if (key !== selectedKey) onSelect(key);
  }

  return (
    <div ref={ref} className="fb-period">
      <button
        type="button"
        className={`fb-control fb-period__trigger${open ? " fb-control--active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="fb-period__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
        <span className="fb-period__label">{selected ? formatPeriod(selected) : "Select period"}</span>
        <span className="fb-period__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="fb-period__list" role="listbox" aria-label="Period">
          {periods.map((period) => {
            const key = periodKeyOf(period);
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={active}
                className={`fb-period__option${active ? " fb-period__option--active" : ""}`}
                onClick={() => handleSelect(key)}
              >
                {formatPeriod(period)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface PeriodScopeBannerProps {
  scoped: boolean;
  /** `PacingCore.resolvePeriodKey`'s state: in_period / ended / upcoming / no_period. */
  state: string | null;
  periods: readonly ScopePeriod[];
  selectedKey: string | null;
}

/**
 * The reference's `PeriodScopeBanner.jsx`: one banner, four states, the same story the Overview row
 * badge and the Slack footer tell. A tinted box and an inline dot - no side stripe (project ban).
 */
export function PeriodScopeBanner({ scoped, state, periods, selectedKey }: PeriodScopeBannerProps) {
  if (!scoped) return null;
  const period = selectedKey ? periods.find((p) => periodKeyOf(p) === selectedKey) : undefined;
  const autoLabel = period ? `${period.fs} – ${period.fe}` : "";
  const customLabel = period && period.label && period.label !== autoLabel ? period.label : null;
  const range = period ? `${fD(period.fs)} – ${fD(period.fe)}` : "";
  const suffix = customLabel ? <span className="period-banner__label">({customLabel})</span> : null;

  let tone: "info" | "warn" = "info";
  let tag = "Period scope active";
  let body: React.ReactNode;
  if (state === "ended") {
    tone = "warn";
    tag = "Out of period";
    body = <>{range} has ended — newer delivery is outside this period{suffix}</>;
  } else if (state === "upcoming") {
    tone = "warn";
    tag = "Upcoming";
    body = <>{range} hasn’t started yet — no delivery in this period yet{suffix}</>;
  } else if (state === "no_period" || !period) {
    tone = "warn";
    tag = "Period scope on";
    body = <>no period defined — showing full flight</>;
  } else {
    body = <>showing {range} only{suffix}</>;
  }

  return (
    <div className={`period-banner period-banner--${tone}`} role="status">
      <span className="period-banner__dot" aria-hidden="true" />
      <span className="period-banner__tag">{tag}</span>
      <span className="period-banner__sep" aria-hidden="true">·</span>
      <span className="period-banner__body">{body}</span>
    </div>
  );
}
