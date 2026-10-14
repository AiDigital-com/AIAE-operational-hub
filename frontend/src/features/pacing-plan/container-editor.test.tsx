/**
 * The split rows have to be able to AUTHOR what the engine reads off them.
 *
 * Coefficient margin mode resolves a fact row's margin down four levels - dim child → date child →
 * container → line item (`PacingCore.buildMarginIndex`, which reads `margin_percent` at each one).
 * This editor offered the margin on three of them: a date split had Name / Start / End / Units and
 * nothing else, so its own margin could be read by the maths and written by nobody. Neither split
 * carried a budget either, while the retired SPA's `PacingTab.jsx` gave both. Closed 2026-10-08.
 *
 * Money follows the reference's `setSpendNative` (2026-10-14): the typed amount is `native_budget`,
 * `target_spend` is its USD figure at the campaign rate, and the units follow the new budget in
 * proportion to the line item's own units per USD. A USD campaign shows `target_spend` in the cell,
 * any other the native amount.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContainerCard } from "./container-editor";
import { buildDateChild, buildDimChild, type PacingContainer } from "./containers";

/** EUR at 1.1 USD; the line item plans 2,000,000 units on $20,000 - 100 units per dollar. */
const RATE = 1.1;
const LI = { planImpr: 2_000_000, budgetUsd: 20_000 };

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
    dim_children: [buildDimChild("audience", "Sports fans")],
  };
}

function renderCard(over: Partial<Parameters<typeof ContainerCard>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ContainerCard
      liId="111"
      container={aContainer()}
      groups={[]}
      onGroupValues={() => {}}
      li={LI}
      currency="EUR"
      rate={RATE}
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

  it("writes the contract amount, its USD figure, and units that follow the budget", () => {
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText("Date split spend (EUR)"), { target: { value: "2500" } });
    const dc = onChange.mock.calls[0][0].date_children[0];
    expect(dc.native_budget).toBe(2500);
    expect(dc.target_spend).toBeCloseTo(2750, 6);
    expect(dc.target_impressions).toBe(275_000);
  });

  it("clears both money fields and leaves the units alone when the spend is emptied", () => {
    const c = aContainer();
    Object.assign(c.date_children[0], { native_budget: 2500, target_spend: 2750, target_impressions: 9 });
    const onChange = renderCard({ container: c });
    fireEvent.change(screen.getByLabelText("Date split spend (EUR)"), { target: { value: "" } });
    const dc = onChange.mock.calls[0][0].date_children[0];
    expect(dc.native_budget).toBeNull();
    expect(dc.target_spend).toBeNull();
    expect(dc.target_impressions).toBe(9);
  });
});

describe("sub-breakdown", () => {
  it("can author a spend too, which makes the target an absolute unit count", () => {
    const c = aContainer();
    Object.assign(c.dim_children[0], { target_mode: "percent", target_value: 40 });
    const onChange = renderCard({ container: c });
    fireEvent.change(screen.getByLabelText("Dim split spend (EUR)"), { target: { value: "900" } });
    const dx = onChange.mock.calls[0][0].dim_children[0];
    expect(dx.native_budget).toBe(900);
    expect(dx.target_spend).toBeCloseTo(990, 6);
    expect(dx.target_mode).toBe("absolute");
    expect(dx.target_value).toBe(99_000);
  });

  it("converts the number when the target switches between units and percent", () => {
    const c = aContainer();
    Object.assign(c.dim_children[0], { target_value: 250_000, native_budget: 900, target_spend: 990 });
    const onChange = renderCard({ container: c });
    fireEvent.change(screen.getByLabelText("Dim split target mode"), { target: { value: "percent" } });
    const dx = onChange.mock.calls[0][0].dim_children[0];
    // 250,000 of the container's 1,000,000 - not 250,000 %. A share carries no budget.
    expect(dx).toMatchObject({ target_mode: "percent", target_value: 25, native_budget: null, target_spend: null });
  });
});

describe("number fields", () => {
  it("keeps a just-typed decimal point instead of eating it", () => {
    renderCard();
    const spend = screen.getByLabelText("Container spend");
    fireEvent.focus(spend);
    fireEvent.change(spend, { target: { value: "1808." } });
    expect(spend).toHaveValue("1808.");
  });

  it("shows the native amount with its USD figure under it on a converted campaign", () => {
    renderCard();
    expect(screen.getByLabelText("Container spend")).toHaveValue("10,000");
    expect(screen.getByText("= $11,000 USD")).toBeInTheDocument();
  });

  it("shows the USD figure on a USD campaign", () => {
    const c = aContainer();
    Object.assign(c, { native_budget: null, target_spend: 4200.5 });
    renderCard({ container: c, currency: "USD", rate: 1 });
    expect(screen.getByLabelText("Container spend")).toHaveValue("4,200.50");
    expect(screen.queryByText(/USD$/)).not.toBeInTheDocument();
  });

  it("offers to set the units from the budget when they differ", () => {
    const c = aContainer();
    c.target_spend = 11_000;
    const onChange = renderCard({ container: c });
    fireEvent.click(screen.getByRole("button", { name: "Set units from budget: 1,100,000" }));
    expect(onChange.mock.calls[0][0].target_impressions).toBe(1_100_000);
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
    expect(screen.getByLabelText("Dim split margin percent")).toHaveAttribute("aria-invalid", "true");
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
