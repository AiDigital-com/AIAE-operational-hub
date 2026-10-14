/**
 * The campaign's exchange rate - the reference's `RateControl.jsx` and `rate-control-state.js`
 * (Settings · Pacing). Read-only currency, an editable "USD per <CUR>" rate, and Reset to NS. Not
 * drawn on a USD campaign. A typed rate locks itself, so a NetSuite refresh does not overwrite it
 * until Reset to NS clears the lock.
 *
 * The rate is saved WITH the plan, in the same request (`PacingPlanUpdateV1.rate` / `rateLocked`):
 * dash-gate applies the new rate before it re-derives every line item's and container's USD figure
 * from its contract amount, which a separate request would not do.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrency } from "../pacing-dashboard/engine/engine-loader";

/** The editable rate and its lock - the reference's `{ rate, rateLocked }`. */
export interface RateState {
  rate: number;
  rateLocked: boolean;
}

/** `normRateInput`: commas stripped; blank, junk or <= 0 is null. */
export function normRateInput(value: unknown): number | null {
  if (value == null) return null;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `initRateState`: the campaign's rate (1 when absent - a legacy or USD pacing), and its lock. */
export function initRateState(rate: number | null | undefined, rateLocked: boolean | null | undefined): RateState {
  const r = Number(rate);
  return { rate: Number.isFinite(r) && r > 0 ? r : 1, rateLocked: !!rateLocked };
}

/** `rateConfigPatch`: the wire never carries a null rate - a blank one is saved as 1. */
export function rateWire(state: RateState): { rate: number; rateLocked: boolean } {
  const r = Number(state.rate);
  return { rate: Number.isFinite(r) && r > 0 ? r : 1, rateLocked: !!state.rateLocked };
}

/** `rateDirty`. */
export function rateDirty(state: RateState, base: RateState): boolean {
  return Number(state.rate) !== Number(base.rate) || !!state.rateLocked !== !!base.rateLocked;
}

export function RateControl({
  currency,
  nsRate,
  value,
  onChange,
}: {
  currency: string;
  /** The NetSuite rate Reset to NS restores; null when NetSuite reports none. */
  nsRate: number | null | undefined;
  value: RateState;
  onChange: (next: RateState) => void;
}) {
  // The text is the user's while they type; it is committed on blur.
  const [raw, setRaw] = useState(value.rate != null ? String(value.rate) : "");
  const hasFocus = useRef(false);
  useEffect(() => {
    if (!hasFocus.current) setRaw(value.rate != null ? String(value.rate) : "");
  }, [value.rate]);

  // Gated on the campaign currency, not on the edited rate, so the control never vanishes while
  // someone types a passing "1".
  const cur = String(currency || "USD").toUpperCase();
  if (cur === "USD" || !currency) return null;

  const Currency = getCurrency();
  const converted = Currency.isConverted(currency, value.rate);
  const canReset = nsRate != null && Number(nsRate) > 0 && (value.rateLocked || Number(value.rate) !== Number(nsRate));
  const exNative = Currency.formatNative(1000, cur);
  const exUsd = converted && normRateInput(value.rate) ? `$${Math.round(1000 * Number(value.rate)).toLocaleString("en-US")}` : null;

  function commit(text: string) {
    hasFocus.current = false;
    // A manual edit locks the rate (`rateEditPatch`).
    const next = normRateInput(text);
    setRaw(next != null ? String(next) : "");
    if (next !== normRateInput(value.rate)) onChange({ rate: next as number, rateLocked: true });
  }
  function reset() {
    // `rateResetPatch`: exactly the NetSuite rate, lock cleared.
    const ns = Number(nsRate);
    const rate = Number.isFinite(ns) && ns > 0 ? ns : 1;
    setRaw(String(rate));
    onChange({ rate, rateLocked: false });
  }

  return (
    <section className="pplan__rate" aria-label="Exchange rate">
      <div className="pplan__subsection-head">Exchange Rate</div>
      <div className="pplan__field-row">
        <div className="pplan__field">
          <span className="pplan__field-label" title="Auto-detected from NetSuite — not editable">Currency</span>
          <span className="pplan__rate-currency">{cur}</span>
        </div>
        <label className="pplan__field">
          <span className="pplan__field-label">USD per {cur}</span>
          <input
            type="text"
            inputMode="decimal"
            className="pplan__input pplan__input--num"
            value={raw}
            placeholder="1.00"
            onFocus={() => {
              hasFocus.current = true;
            }}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
          />
        </label>
      </div>
      {/* The field's own actions sit under it; both slots stay laid out, so nothing moves when they
          appear mid-edit. */}
      <div className="pplan__rate-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          style={{ visibility: canReset ? "visible" : "hidden" }}
          tabIndex={canReset ? 0 : -1}
          aria-hidden={!canReset}
          title={canReset ? `Reset to the NetSuite rate (${nsRate})` : undefined}
          onClick={reset}
        >
          Reset to NS
        </button>
        <span
          className="pplan__badge"
          style={{ visibility: value.rateLocked ? "visible" : "hidden" }}
          aria-hidden={!value.rateLocked}
          title={value.rateLocked ? "Rate set manually — NS refresh won't overwrite it until you reset" : undefined}
        >
          Locked
        </span>
      </div>
      {exUsd && (
        <p className="pplan__hint">
          {exNative} = {exUsd} USD. The dashboard computes in USD; you enter budgets in {cur}.
        </p>
      )}
    </section>
  );
}
