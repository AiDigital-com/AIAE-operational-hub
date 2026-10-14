/**
 * The container editor's number inputs, ported from the reference's Settings · Pacing tab:
 * `NumInput` and `UnitsBudgetField` (`PacingTab.jsx`) and `MoneyField` + `money-field-display.js`
 * (`workspace/src/components/ui/`). Behaviour is the reference's; markup is BEM like the rest of
 * this feature.
 *
 * Both inputs keep the text the user is typing as their own draft while focused, and only re-read
 * the parent's number once blurred. `NumericField` round-trips every keystroke through a number,
 * which drops a just-typed decimal point ("12." → "12") - the reason these exist.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrency } from "../pacing-dashboard/engine/engine-loader";

const int2Fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The reference's `fI2`: up to two decimals, comma-grouped; zero and junk read as blank. */
export function fmtUnits(value: number | null | undefined): string {
  const n = Number(value);
  return value == null || Number.isNaN(n) || n === 0 ? "" : int2Fmt.format(n);
}

function stripCommas(value: string): string {
  return value.replace(/,/g, "");
}

/**
 * The reference's `NumInput`. Every keystroke reports `parseFloat(text) || null`; blur reformats the
 * text and reports the same number once more (a blank or zero field reports null).
 */
export function UnitsInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  inputMode = "numeric",
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  inputMode?: "numeric" | "decimal";
}) {
  const [raw, setRaw] = useState(value != null ? fmtUnits(value) : "");
  const hasFocus = useRef(false);

  useEffect(() => {
    if (!hasFocus.current) setRaw(value != null ? fmtUnits(value) : "");
  }, [value]);

  return (
    <input
      type="text"
      inputMode={inputMode}
      className={className}
      value={raw}
      placeholder={placeholder ?? "0"}
      aria-label={ariaLabel}
      onFocus={() => {
        hasFocus.current = true;
      }}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(parseFloat(stripCommas(e.target.value)) || null);
      }}
      onBlur={() => {
        hasFocus.current = false;
        const n = parseFloat(stripCommas(raw)) || 0;
        setRaw(n ? fmtUnits(n) : "");
        onChange(n || null);
      }}
    />
  );
}

/**
 * The reference's `UnitsBudgetField`: the units input plus a "fill from budget" button. The button
 * shows only when a budget-derived figure exists and differs from what is typed; its slot is always
 * kept, so nothing beside it moves when it comes and goes.
 */
export function UnitsBudgetInput({
  value,
  onChange,
  fromBudget,
  className,
  ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** `unitsFromBudget` for this row's own budget, or null when the line item has no budget. */
  fromBudget: number | null;
  className?: string;
  ariaLabel: string;
}) {
  const current = value == null ? null : Number(value);
  const canFill = fromBudget != null && fromBudget !== current;
  return (
    <div className="pplan-units">
      <UnitsInput
        value={value}
        onChange={onChange}
        placeholder={fromBudget == null ? "0" : int2Fmt.format(fromBudget)}
        className={className}
        ariaLabel={ariaLabel}
      />
      <button
        type="button"
        className="pplan-units__fill"
        style={{ visibility: canFill ? "visible" : "hidden" }}
        tabIndex={canFill ? 0 : -1}
        aria-hidden={!canFill}
        aria-label={canFill ? `Set units from budget: ${int2Fmt.format(fromBudget)}` : undefined}
        title={canFill ? `Set units from budget: ${int2Fmt.format(fromBudget)}` : undefined}
        onClick={() => {
          if (canFill) onChange(fromBudget);
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      </button>
    </div>
  );
}

/** `formatMoneyDisplay`: a fractional amount always shows two decimals ("1.80", never "1.8"). */
export function formatMoneyDisplay(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const n = parseFloat(stripCommas(String(value)));
  if (!Number.isFinite(n)) return "";
  const opts = n % 1 !== 0 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
  return n.toLocaleString("en-US", opts);
}

/** `isMoneyDraftValid`: digits and commas, at most one point - "1808." mid-typing is fine. */
function isMoneyDraftValid(value: string): boolean {
  return /^[0-9,]*\.?[0-9]*$/.test(value);
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = parseFloat(stripCommas(String(value)));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The reference's `MoneyField`: the native amount, with a muted "= $X USD" line under it on a
 * converted campaign. It only reports the raw text; the caller decides what gets stored.
 */
export function MoneyInput({
  value,
  rate,
  currency,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: number | string | null | undefined;
  rate: number;
  currency: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const focused = draft !== null;
  const Currency = getCurrency();
  const showUsd = Currency.isConverted(currency, rate);
  const usdLabel = showUsd
    ? `= ${Currency.formatUsd(Currency.currencyToUsd(toNumber(focused ? draft : value), rate))} USD`
    : null;
  // A non-USD campaign may have no USD line right now (rate 1, or none yet). Its box is kept anyway,
  // so the field does not change height when the rate crosses that line.
  const couldConvert = !!currency && currency.trim().toUpperCase() !== "USD";

  return (
    <div className={`pplan-money${showUsd ? " pplan-money--usd" : couldConvert ? " pplan-money--reserve" : ""}`}>
      <input
        type="text"
        inputMode="decimal"
        className={className}
        value={focused ? draft : formatMoneyDisplay(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => setDraft(value == null ? "" : stripCommas(String(value)))}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,]/g, "");
          if (!isMoneyDraftValid(next)) return;
          setDraft(next);
          onChange(next);
        }}
      />
      {showUsd && <div className="pplan-money__usd">{usdLabel}</div>}
    </div>
  );
}
