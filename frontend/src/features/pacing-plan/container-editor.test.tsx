/**
 * The split rows have to be able to AUTHOR what the engine reads off them.
 *
 * Coefficient margin mode resolves a fact row's margin down four levels - dim child → date child →
 * container → line item (`PacingCore.buildMarginIndex`, which reads `margin_percent` at each one).
 * This editor offered the margin on three of them: a date split had Name / Start / End / Units and
 * nothing else, so its own margin could be read by the maths and written by nobody. Neither split
 * carried a budget either, while the retired SPA's `PacingTab.jsx` gave both. Closed 2026-10-08.
 *
 * `native_budget` is the field the UI writes, never `target_spend`: the contract amount is the money
 * truth and dash-gate re-materializes the USD cache from it at the current campaign rate on every
 * save (`currency-detect.mjs`). A row that wrote both would go stale the first time the rate moved.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContainerCard } from "./container-editor";
import { buildDateChild, buildDimChild, type PacingContainer } from "./containers";

function aContainer(): PacingContainer {
  return {
    id: "c-1",
    name: "Oct 2026",
    fs: "2026-10-01",
    fe: "2026-10-31",
    target_impressions: 1_000_000,
    native_budget: 10_000,
    target_spend: null,
    margin_percent: null,
    date_children: [buildDateChild({ fs: "2026-10-01", fe: "2026-10-15" })],
    dim_children: [buildDimChild()],
  };
}

function renderCard(over: Partial<Parameters<typeof ContainerCard>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ContainerCard
      container={aContainer()}
      currency="EUR"
      liCoef={false}
      onChange={onChange}
      onRemove={() => {}}
      onDuplicate={() => {}}
      defaultOpen
      {...over}
    />
  );
  return onChange;
}

describe("date split", () => {
  it("can author the margin the coefficient chain reads off it", () => {
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText("Date split margin percent"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].date_children[0].margin_percent).toBe(42);
  });

  it("clearing the margin means inherit, not zero", () => {
    const c = aContainer();
    c.date_children[0].margin_percent = 42;
    const onChange = renderCard({ container: c });
    fireEvent.change(screen.getByLabelText("Date split margin percent"), { target: { value: "" } });
    expect(onChange.mock.calls[0][0].date_children[0].margin_percent).toBeNull();
  });

  it("writes the contract amount and leaves the USD cache to the server", () => {
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText("Date split budget (EUR)"), { target: { value: "2500" } });
    const dc = onChange.mock.calls[0][0].date_children[0];
    expect(dc.native_budget).toBe(2500);
    expect(dc.target_spend).toBeNull();
  });
});

describe("sub-breakdown", () => {
  it("can author a budget too", () => {
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText("Sub-breakdown budget (EUR)"), { target: { value: "900" } });
    const dx = onChange.mock.calls[0][0].dim_children[0];
    expect(dx.native_budget).toBe(900);
    expect(dx.target_spend).toBeNull();
  });
});

describe("out-of-range margin on a coefficient line item", () => {
  /** 100 makes `spend / (1 - margin)` a division by zero - the contract's open upper bound. */
  const OUT_OF_RANGE = 100;

  it("is flagged on both split levels", () => {
    const c = aContainer();
    c.date_children[0].margin_percent = OUT_OF_RANGE;
    c.dim_children[0].margin_percent = OUT_OF_RANGE;
    renderCard({ container: c, liCoef: true });
    expect(screen.getByLabelText("Date split margin percent")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Sub-breakdown margin percent")).toHaveAttribute("aria-invalid", "true");
  });

  it("is not flagged on a line item that is not on coefficient cost", () => {
    const c = aContainer();
    c.date_children[0].margin_percent = OUT_OF_RANGE;
    renderCard({ container: c, liCoef: false });
    expect(screen.getByLabelText("Date split margin percent")).not.toHaveAttribute("aria-invalid");
  });

  it("leaves a blank margin alone - inherit is always legal", () => {
    const c = aContainer();
    c.date_children[0].margin_percent = null;
    renderCard({ container: c, liCoef: true });
    expect(screen.getByLabelText("Date split margin percent")).not.toHaveAttribute("aria-invalid");
  });
});
