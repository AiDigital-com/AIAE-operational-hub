import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDraftLineItemV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { getAddablePacingLineItems, savePacingPlan } from "./api";
import { useRef, useState } from "react";
import { PacingPlanSection } from "./pacing-plan-sheet";
import type { SettingsSectionHandle } from "../pacing-dashboard/settings-section";
import type { PacingAddableLineItemsV1, PacingLineItemPlanUpdateV1, PacingLineItemPlanV1 } from "./types";

vi.mock("./api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
  updatePacingStatus: vi.fn(),
}));

/**
 * The plan section with a Save of its own.
 *
 * The real Save lives in the settings drawer's footer, shared with the data and widget sections,
 * and its rules (disabled until something is dirty, one error line per failed section) are that
 * component's and are tested there. Here the button is a plain trigger, so these cases stay about
 * what the plan editor does rather than about the chrome around it.
 */
function renderSheet(
  planByLineItem: Record<string, PacingLineItemPlanV1>,
  onClose = vi.fn(),
  // Coefficient margin mode's pacing switch (`data.coef_enabled`). Off by default, which is what
  // every case that predates the feature is asserting against - note that off does NOT mean the
  // controls are hidden: a line item already carrying the flag shows them on its own.
  coefEnabled = false,
  // The values the pacing has delivered (`availableSplits`) - what "+ Add dim split" lists.
  rawSplits: Record<string, Record<string, string[]>> | null = null,
  // The campaign's currency and exchange rate, as the drawer hands them down.
  money: { currency: string; rate: number; rateLocked?: boolean; nsRate?: number | null } = { currency: "USD", rate: 1 }
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const ref = useRef<SettingsSectionHandle>(null);
    const [error, setError] = useState<string | null>(null);
    return (
      <>
        <PacingPlanSection
          ref={ref}
          slug="nike-ss26"
          currency={money.currency}
          rate={money.rate}
          rateLocked={money.rateLocked}
          nsRate={money.nsRate}
          netFeatureOn={false}
          coefEnabled={coefEnabled}
          planByLineItem={planByLineItem}
          rawSplits={rawSplits}
          seedKey={1}
          onDirtyChange={() => {}}
        />
        {error && <p className="form-error">{error}</p>}
        <button
          type="button"
          onClick={async () => {
            const result = await ref.current?.save();
            if (result?.ok) onClose();
            else if (result) setError(result.message);
          }}
        >
          Save plan
        </button>
      </>
    );
  }
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    ),
  };
}

const emptyAddable: PacingAddableLineItemsV1 = { ok: true, addable: [], alreadyAdded: [] };

describe("PacingPlanSection", () => {
  beforeEach(() => {
    vi.mocked(savePacingPlan).mockReset();
    vi.mocked(getAddablePacingLineItems).mockReset().mockResolvedValue(emptyAddable);
  });

  it("seeds every field from the stored plan and saves the edited value in one request (US-125)", async () => {
    // Given:
    const user = userEvent.setup();
    const plan = aPacingLineItemPlanV1({
      lineItemId: "111",
      channel: "Display",
      plannedImpressions: 1_000_000,
      clientBudget: 5000,
      marginTargetPct: 20,
    });
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    const { onClose } = renderSheet({ "111": plan });

    // When: opens with the LI's current values shown, then edits the budget.
    await screen.findByText("LI 111");
    const budgetInput = screen.getByLabelText("Budget for line item 111");
    expect(budgetInput).toHaveValue("5,000");
    await user.clear(budgetInput);
    await user.type(budgetInput, "7500");
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: one save request, the edited value forwarded, everything else round-tripped verbatim -
    // never recomputed.
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [slug, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(slug).toBe("nike-ss26");
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].lineItemId).toBe("111");
    expect(lineItems[0].nativeBudget).toBe(7500);
    expect(lineItems[0].targetImpressions).toBe(1_000_000);
    expect(lineItems[0].marginTargetPct).toBe(20);
    // An existing line item's identity fields are never re-sent - Pacing preserves them by id.
    expect(lineItems[0].channel).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("names the field Pacing rejected, without pre-judging it locally (US-125)", async () => {
    // Given: a coefficient-margin rejection, exactly the shape the backend forwards.
    const user = userEvent.setup();
    const plan = aPacingLineItemPlanV1({ lineItemId: "111" });
    vi.mocked(savePacingPlan).mockRejectedValue(
      new Error("line item 111: its margin is out of range (coefficient-cost margin must be 0-99.99)")
    );
    renderSheet({ "111": plan });

    // When: the margin is edited to something Pacing refuses. The edit is the point, not
    // ceremony - a section with nothing to save does not call the endpoint at all, which is what
    // lets the drawer press one Save over three sections without three pointless requests.
    await screen.findByText("LI 111");
    const impressions = screen.getByLabelText("Units for line item 111");
    await user.clear(impressions);
    await user.type(impressions, "900000");
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: Pacing's own message, naming the line item and field, surfaces verbatim.
    await screen.findByText(/line item 111: its margin is out of range/);
  });

  it("confirms before removing a line item and states what plan data is lost (US-127)", async () => {
    // Given: two line items, so removal is actually allowed (the last one cannot be removed).
    const user = userEvent.setup();
    const planA = aPacingLineItemPlanV1({ lineItemId: "111" });
    const planB = aPacingLineItemPlanV1({ lineItemId: "222" });
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet({ "111": planA, "222": planB });
    await screen.findByText("LI 111");

    // When:
    await user.click(screen.getByRole("button", { name: "Remove line item 111" }));

    // Then: the confirmation names what is lost, not a generic "are you sure".
    const dialog = await screen.findByRole("dialog", { name: "Remove line item 111?" });
    expect(within(dialog).getByText(/entire plan/)).toBeInTheDocument();
    expect(within(dialog).getByText(/remaining line items and their delivery history are unaffected/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    // Then: the line item is gone from the editor, the other is untouched.
    expect(screen.queryByText("LI 111")).not.toBeInTheDocument();
    expect(screen.getByText("LI 222")).toBeInTheDocument();

    // And saving reflects the removal - only the remaining line item is sent.
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems.map((li) => li.lineItemId)).toEqual(["222"]);
  });

  it("does not offer to remove the only line item on the pacing (US-127)", async () => {
    // Given:
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) });
    await screen.findByText("LI 111");

    // When:
    await user.click(screen.getByRole("button", { name: "Remove line item 111" }));

    // Then: no destructive action offered - archiving the whole pacing is the way out instead.
    const dialog = await screen.findByRole("dialog", { name: "This is the last line item" });
    expect(within(dialog).getByText("This is the last line item")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("offers the campaign's not-yet-added line items and adds the selected one (US-126)", async () => {
    // Given:
    const user = userEvent.setup();
    const candidate = aPacingDraftLineItemV1({ lineItemId: "7", channel: "Video", currency: "USD" });
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, io: "3854", addable: [candidate], alreadyAdded: [] });
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) });
    await screen.findByText("LI 111");

    // When:
    await user.click(screen.getByRole("button", { name: "+ Add line item" }));
    await screen.findByText("LI 7");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add selected (1)" }));

    // Then: the new line item joins the editor, marked as new, and gets saved along with the rest.
    await screen.findByText("New");
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    const added = lineItems.find((li) => li.lineItemId === "7");
    expect(added).toBeDefined();
    expect(added?.channel).toBe("Video");
  });
});

// §10 sub-breakdowns (US-129/130), through the real sheet: authoring a sub-breakdown
// and getting it into the save request. The maths it feeds already ships on the
// Pacing side; what matters here is that the editor writes the shape that reader expects.
describe("PacingPlanSheet — sub-breakdowns", () => {
  beforeEach(() => {
    vi.mocked(savePacingPlan).mockReset();
    vi.mocked(getAddablePacingLineItems).mockReset().mockResolvedValue(emptyAddable);
  });

  async function openContainer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /line item 111/i }));
    await user.click(screen.getByRole("button", { name: /\+ Add container/i }));
  }

  it("names the first container Default and the next ones Container N, as the reference does", async () => {
    const user = userEvent.setup();
    renderSheet({
      "111": aPacingLineItemPlanV1({
        lineItemId: "111",
        plannedImpressions: 1_000_000,
        clientBudget: 5000,
        flightStart: "2026-09-01",
        flightEnd: "2026-10-31",
      }),
    });

    await openContainer(user);
    await user.click(screen.getByRole("button", { name: /\+ Add container/i }));

    // Only the first one may take the month name; a later one is numbered even in a one-month flight.
    expect(screen.getByDisplayValue("Default")).toBeInTheDocument();
    expect(screen.getByText("Container 2")).toBeInTheDocument();
  });

  /** "+ Add dim split" → "Type a value…": a split on a value that has not delivered yet. */
  async function typeDimSplit(user: ReturnType<typeof userEvent.setup>, dim: string, value: string) {
    await user.click(screen.getByRole("button", { name: /\+ Add dim split/i }));
    await user.click(screen.getByRole("button", { name: "Type a value…" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), dim);
    await user.type(screen.getByRole("textbox", { name: "Value" }), value);
    await user.click(screen.getByRole("button", { name: "Add" }));
  }

  it("adds a dim split on a value not delivered yet, with its own target and margin, and saves it", async () => {
    const user = userEvent.setup();
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000, clientBudget: 5000 }) });

    await openContainer(user);
    // A value NetSuite has never heard of - a campaign that starts next week can be planned today.
    await typeDimSplit(user, "audience", "Client's own label");
    fireEvent.change(screen.getByRole("textbox", { name: /dim split target/i }), { target: { value: "250000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /dim split margin percent/i }), { target: { value: "35" } });
    await user.click(screen.getByRole("button", { name: "Summary" }));

    await user.click(screen.getByRole("button", { name: /Save plan/i }));

    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    const containers = lineItems[0].containers as unknown as Array<{ dim_children: Array<Record<string, unknown>> }>;
    expect(containers[0].dim_children).toHaveLength(1);
    expect(containers[0].dim_children[0]).toMatchObject({
      dim_key: "audience",
      dim_value: "Client's own label",
      target_mode: "absolute",
      target_value: 250000,
      margin_percent: 35,
      notify_in_summary: true,
    });
  });

  it("offers the delivered values, minus the ones this container already splits on", async () => {
    const user = userEvent.setup();
    renderSheet(
      { "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000, clientBudget: 5000 }) },
      vi.fn(),
      false,
      { geo: { "111": ["TX", "NY"], "222": ["CA"] } }
    );

    await openContainer(user);
    await user.click(screen.getByRole("button", { name: /\+ Add dim split/i }));
    // Only this line item's values; CA belongs to another one.
    expect(screen.queryByRole("button", { name: "CA" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "TX" }));

    expect(screen.getByText("TX")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /\+ Add dim split/i }));
    expect(screen.queryByRole("button", { name: "TX" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "NY" })).toBeInTheDocument();
  });

  it("shows what a percent target resolves to against the parent container", async () => {
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000, clientBudget: 5000 }) });

    await openContainer(user);
    // buildDefaultContainer copies the LI's plan, so the parent carries 1,000,000.
    await typeDimSplit(user, "geo", "TX");
    // Mode first: switching an existing number converts it (30 units would become 0 %).
    await user.selectOptions(screen.getByRole("combobox", { name: /dim split target mode/i }), "percent");
    fireEvent.change(screen.getByRole("textbox", { name: /dim split target/i }), { target: { value: "30" } });

    // 30% of the parent's 1,000,000 - the number the manager would otherwise have to work out.
    expect(await screen.findByText("= 300,000")).toBeInTheDocument();
  });

  it("warns per dimension and never sums two different axes together", async () => {
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 100_000, clientBudget: 5000 }) });

    await openContainer(user);

    // Two axes, 60k each. Summed they would be 120k against a 100k container and warn for nothing.
    await typeDimSplit(user, "audience", "Sports fans");
    await typeDimSplit(user, "geo", "TX");
    const targets = screen.getAllByRole("textbox", { name: /dim split target/i });
    fireEvent.change(targets[0], { target: { value: "60000" } });
    fireEvent.change(targets[1], { target: { value: "60000" } });

    expect(screen.queryByText(/splits resolve to/i)).not.toBeInTheDocument();

    // Push ONE axis over on its own and it must say so, naming that axis.
    fireEvent.change(targets[1], { target: { value: "150000" } });
    expect(await screen.findByText(/Geo splits resolve to 150,000 — above the container target \(100,000\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Audience splits resolve to/i)).not.toBeInTheDocument();
  });

  it("removes a dim split without touching the date splits beside it", async () => {
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000, clientBudget: 5000 }) });

    await openContainer(user);
    await user.click(screen.getByRole("button", { name: /\+ Add date split/i }));
    await typeDimSplit(user, "geo", "TX");

    await user.click(screen.getByRole("button", { name: /Remove dim split Geo: TX/i }));

    expect(screen.queryByText("TX")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Date split name/i })).toBeInTheDocument();
  });

  it("distributes the container by month, the last month taking the remainder", async () => {
    const user = userEvent.setup();
    renderSheet({
      "111": aPacingLineItemPlanV1({
        lineItemId: "111",
        plannedImpressions: 1_000_000,
        clientBudget: 5000,
        flightStart: "2026-09-01",
        flightEnd: "2026-10-31",
      }),
    });

    await openContainer(user);
    await user.click(screen.getByRole("button", { name: /Distribute/ }));
    await user.click(screen.getByRole("menuitem", { name: "Equal (fixed per month)" }));

    expect(screen.getByDisplayValue("Sep 2026")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Oct 2026")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("500,000")).toHaveLength(2);
    expect(screen.getAllByDisplayValue("2,500")).toHaveLength(2);
  });

  it("offers to fit the line item to containers that outgrow it, and applies only what has to grow", async () => {
    const user = userEvent.setup();
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet({
      "111": aPacingLineItemPlanV1({
        lineItemId: "111",
        plannedImpressions: 100_000,
        clientBudget: 5000,
        flightStart: "2026-09-01",
        flightEnd: "2026-09-30",
        containers: [
          {
            id: "c1", name: "Big", fs: "2026-09-01", fe: "2026-10-15", target_impressions: 150_000,
            target_spend: 4000, native_budget: 4000, margin_percent: null, date_children: [], dim_children: [],
          },
        ],
      }),
    });

    await user.click(screen.getByRole("button", { name: /line item 111/i }));
    expect(screen.getByText(/Containers units sum \(150,000\) exceeds LI total \(100,000\)/)).toBeInTheDocument();
    expect(screen.getByText(/Container period extends past LI flight/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fit LI to containers" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: /Save plan/i }));

    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    // Units and the flight end grow; the budget already covers $4,000, so it stays.
    expect(lineItems[0]).toMatchObject({ targetImpressions: 150_000, flightEnd: "2026-10-15", flightStart: "2026-09-01", nativeBudget: 5000 });
  });

  it("makes a value group from the dim split menu and saves it with the plan", async () => {
    const user = userEvent.setup();
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet(
      { "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000, clientBudget: 5000 }) },
      vi.fn(),
      false,
      { geo: { "111": ["Dallas", "Austin", "NY"] } }
    );

    await openContainer(user);
    await user.click(screen.getByRole("button", { name: /\+ Add dim split/i }));
    await user.click(screen.getByRole("button", { name: "Group values…" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Dimension" }), "geo");
    await user.type(screen.getByRole("textbox", { name: "Group name" }), "Texas");
    await user.click(screen.getByRole("checkbox", { name: /Dallas/ }));
    await user.click(screen.getByRole("checkbox", { name: /Austin/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("Value groups (1)")).toBeInTheDocument();
    // The group is offered once, under its name, in place of its members.
    await user.click(screen.getByRole("button", { name: /\+ Add dim split/i }));
    expect(screen.getByRole("button", { name: /Texas\s*group · 2 values/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dallas" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Texas\s*group/ }));

    await user.click(screen.getByRole("button", { name: /Save plan/i }));
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems[0].dimGroups).toEqual([{ dim_key: "geo", name: "Texas", values: ["Dallas", "Austin"] }]);
    const containers = lineItems[0].containers as unknown as Array<{ dim_children: Array<Record<string, unknown>> }>;
    expect(containers[0].dim_children[0]).toMatchObject({ dim_key: "geo", dim_value: "Texas" });
  });
});

// Coefficient margin mode (Pacing's per-LI `cost_coef`): client cost becomes spend / (1 - margin),
// with the margin resolved per fact row. The pacing-level switch is a pure VISIBILITY gate - it
// decides whether these controls are on screen and whether the key rides the wire at all, never
// whether a stored flag still computes.
describe("PacingPlanSection - coefficient margin mode", () => {
  beforeEach(() => {
    vi.mocked(savePacingPlan).mockReset().mockResolvedValue({ saved: true });
    vi.mocked(getAddablePacingLineItems).mockReset().mockResolvedValue(emptyAddable);
  });

  /** A container Pacing's own `validateCoefLi` refuses: a margin outside [0,100). */
  function aBadMarginContainer(targetImpressions = 500_000) {
    return {
      id: "c1",
      name: "March 2026",
      // Inside the factory's Aug-Sep flight: a container outside it is a second, separate warning.
      fs: "2026-08-01",
      fe: "2026-08-31",
      target_impressions: targetImpressions,
      target_spend: 1000,
      margin_percent: 150,
      date_children: [],
      dim_children: [],
    };
  }

  it("shows the control for a line item carrying the flag even while the pacing switch is off", async () => {
    // Given: a line item ALREADY on coefficient cost, on a pacing whose switch is off. Pacing
    // supports exactly this state - the Data tab's own hint says existing coefficient line items
    // keep working while the switch is off - and a pacing created with the mode on reaches it the
    // moment someone unticks the switch.
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true }) });
    await screen.findByText("LI 111");

    // Then: the checkbox is there anyway. Gating it on the switch alone would leave this line item
    // computing client cost from a coefficient with no control anywhere to turn it off, while its
    // Margin field still reads as the formula's divisor - visible effects, unreachable cause.
    expect(screen.getByRole("checkbox", { name: /Coefficient cost for line item 111/ })).toBeChecked();
    expect(screen.getByText("Margin % (client cost)")).toBeInTheDocument();

    // When: the user clears it and saves
    await user.click(screen.getByRole("checkbox", { name: /Coefficient cost for line item 111/ }));
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: the clear reaches Pacing. The key rides UNCONDITIONALLY for this reason - a wire gated
    // on "is anything still ticked" would go false on this very tick and drop the edit.
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems[0].costCoef).toBe(false);
  });

  it("round-trips a stored flag unchanged through an edit that has nothing to do with it", async () => {
    // Given: the switch off and a line item carrying the flag - the same stranded state as above.
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true }) });
    await screen.findByText("LI 111");

    // When: only the budget is edited
    const budget = screen.getByLabelText("Budget for line item 111");
    await user.clear(budget);
    await user.type(budget, "7500");
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: the flag goes back as it came. This is what makes sending it always safe - the value is
    // seeded from storage, so an untouched line item's round-trip is the identity, and `cost_coef`
    // is not a NetSuite field, so no revalidate can be clobbered by it.
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems[0].costCoef).toBe(true);
  });

  it("keeps the control away from a pacing that uses neither the switch nor the flag", async () => {
    // The other half of the OR: nothing on, nothing stored, nothing shown. Without this the two
    // cases above would pass just as well on a component that always renders the checkbox.
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: false }) });
    await screen.findByText("LI 111");

    expect(screen.queryByRole("checkbox", { name: /Coefficient cost for line item 111/ })).not.toBeInTheDocument();
    expect(screen.getByText("Target margin %")).toBeInTheDocument();
  });

  it("relabels the margin field and sends an explicit false when the box is cleared", async () => {
    // Given: the switch on, and a line item carrying the flag.
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true }) }, vi.fn(), true);
    await screen.findByText("LI 111");

    // Then: the Margin cell says what it now does - it is the formula's divisor, not a target.
    expect(screen.getByText("Margin % (client cost)")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Coefficient cost for line item 111/ })).toBeChecked();

    // When:
    await user.click(screen.getByRole("checkbox", { name: /Coefficient cost for line item 111/ }));
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: false is the instruction to clear - an omitted key would be preserved from storage, so
    // the box could never be unticked.
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems[0].costCoef).toBe(false);
    expect(screen.getByText("Target margin %")).toBeInTheDocument();
  });

  it("turns coefficient cost on for every line item from one action", async () => {
    // Given: three line items, none on coefficient cost.
    const user = userEvent.setup();
    renderSheet(
      {
        "111": aPacingLineItemPlanV1({ lineItemId: "111" }),
        "222": aPacingLineItemPlanV1({ lineItemId: "222" }),
        "333": aPacingLineItemPlanV1({ lineItemId: "333" }),
      },
      vi.fn(),
      true
    );
    await screen.findByText("LI 111");

    // When:
    await user.click(screen.getByRole("button", { name: /Coef → all LIs/ }));
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    // Then: every line item, including the two whose cards are collapsed.
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, lineItems] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    expect(lineItems.map((li) => li.costCoef)).toEqual([true, true, true]);
  });

  it("does not offer the bulk action on a pacing with one line item", async () => {
    // Given: nothing to apply "to all" that the single card does not already offer.
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) }, vi.fn(), true);
    await screen.findByText("LI 111");

    // Then:
    expect(screen.queryByRole("button", { name: /Coef → all LIs/ })).not.toBeInTheDocument();
  });

  it("warns before Save when the coefficient margins are the ones Pacing will refuse", async () => {
    // Given: a coefficient line item whose container margin is out of range. Pacing answers the whole
    // settings save with `bad_coef_config` on this, so without the warning the only way to find out
    // is to press Save.
    renderSheet(
      { "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true, containers: [aBadMarginContainer()] }) },
      vi.fn(),
      true
    );
    await screen.findByText("LI 111");

    // Then: the line item's warning badge carries the coefficient sentence, naming both ways this can fail.
    expect(
      screen.getByRole("img", { name: /Coefficient margins block saving - overlapping containers both set a margin/ })
    ).toBeInTheDocument();
  });

  it("names both axes when the containers also outrun the line item's own plan", async () => {
    // Given: one container that is both over the plan AND carrying an out-of-range margin.
    renderSheet(
      {
        "111": aPacingLineItemPlanV1({
          lineItemId: "111",
          costCoef: true,
          plannedImpressions: 100_000,
          containers: [aBadMarginContainer(500_000)],
        }),
      },
      vi.fn(),
      true
    );
    await screen.findByText("LI 111");

    // Then: one sentence covering both - the container-sum line on its own would name the lesser of
    // the two reasons the save is about to fail.
    expect(
      screen.getByRole("img", { name: /Containers exceed the LI plan, and the coefficient margins block saving/ })
    ).toBeInTheDocument();
  });

  it("stops the save before sending it and names what the coefficient check refuses", async () => {
    // Given: the out-of-range container margin, and an edit that makes the plan dirty.
    const user = userEvent.setup();
    renderSheet(
      { "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true, containers: [aBadMarginContainer()] }) },
      vi.fn(),
      true
    );
    await user.click(screen.getByRole("button", { name: /line item 111/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /target impressions|units/i }), { target: { value: "900000" } });

    // When:
    await user.click(screen.getByRole("button", { name: /Save plan/i }));

    // Then: nothing is sent; the reason is the reference's sentence.
    expect(await screen.findByText(/Can’t save — LI 111: container “March 2026” must be ≥ 0 and < 100/)).toBeInTheDocument();
    expect(savePacingPlan).not.toHaveBeenCalled();
  });

  it("stays silent about a margin on a line item that is not on coefficient cost", async () => {
    // Given: the SAME container, on a flat-margin line item. `validateCoefLi` returns early there, so
    // a margin nothing reads is not a problem to report.
    renderSheet(
      { "111": aPacingLineItemPlanV1({ lineItemId: "111", containers: [aBadMarginContainer(50_000)] }) },
      vi.fn(),
      true
    );
    await screen.findByText("LI 111");

    // Then:
    expect(screen.queryByRole("img", { name: /Coefficient margins block saving/ })).not.toBeInTheDocument();
  });

  it("tints the margin cell when a coefficient line item's own margin is out of range", async () => {
    // Given: 150% as the divisor of spend / (1 - margin) - a meaningless client cost.
    const user = userEvent.setup();
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111", costCoef: true, marginTargetPct: 150 }) }, vi.fn(), true);
    await screen.findByText("LI 111");

    // Then: the cell itself says so - a full-cell tint, never an edge accent.
    const margin = screen.getByRole("spinbutton", { name: "Margin % (client cost)" });
    expect(margin).toHaveAttribute("aria-invalid", "true");
    expect(margin.className).toContain("pplan__input--invalid");

    // When: corrected
    await user.clear(margin);
    await user.type(margin, "30");

    // Then: the tint clears as it is typed, not on save.
    expect(screen.getByRole("spinbutton", { name: "Margin % (client cost)" })).not.toHaveAttribute("aria-invalid");
  });
});

describe("PacingPlanSection - exchange rate", () => {
  beforeEach(() => {
    vi.mocked(savePacingPlan).mockReset().mockResolvedValue({ saved: true });
    vi.mocked(getAddablePacingLineItems).mockReset().mockResolvedValue(emptyAddable);
  });

  const cadPlan = () => ({
    "111": aPacingLineItemPlanV1({ lineItemId: "111", clientBudget: 7500, nativeBudget: 10_000 }),
  });

  it("is not drawn on a USD campaign", () => {
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) });
    expect(screen.queryByText("Exchange Rate")).not.toBeInTheDocument();
  });

  it("saves a typed rate, locked, in the same request as the line items", async () => {
    const user = userEvent.setup();
    renderSheet(cadPlan(), vi.fn(), false, null, { currency: "CAD", rate: 0.75, nsRate: 0.75 });

    const input = screen.getByRole("textbox", { name: /USD per CAD/ });
    await user.clear(input);
    await user.type(input, "0.8");
    await user.tab();
    expect(screen.getByText("Locked")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Save plan/i }));

    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    const [, lineItems, rate] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[], unknown];
    expect(lineItems.map((li) => li.lineItemId)).toEqual(["111"]);
    expect(rate).toEqual({ rate: 0.8, rateLocked: true });
  });

  it("restores the NetSuite rate and clears the lock", async () => {
    const user = userEvent.setup();
    renderSheet(cadPlan(), vi.fn(), false, null, { currency: "CAD", rate: 0.8, rateLocked: true, nsRate: 0.75 });

    await user.click(screen.getByRole("button", { name: "Reset to NS" }));

    expect(screen.getByRole("textbox", { name: /USD per CAD/ })).toHaveValue("0.75");
    await user.click(screen.getByRole("button", { name: /Save plan/i }));
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    expect(vi.mocked(savePacingPlan).mock.calls[0][2]).toEqual({ rate: 0.75, rateLocked: false });
  });

  it("sends no rate when only a line item changed", async () => {
    const user = userEvent.setup();
    renderSheet(cadPlan(), vi.fn(), false, null, { currency: "CAD", rate: 0.75, nsRate: 0.75 });

    await user.click(screen.getByRole("button", { name: /line item 111/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Units for line item 111/ }), { target: { value: "900000" } });
    await user.click(screen.getByRole("button", { name: /Save plan/i }));

    await waitFor(() => expect(savePacingPlan).toHaveBeenCalled());
    expect(vi.mocked(savePacingPlan).mock.calls[0][2]).toBeUndefined();
  });

  it("shows the line item's budget in its own currency with the USD figure under it", async () => {
    const user = userEvent.setup();
    renderSheet(cadPlan(), vi.fn(), false, null, { currency: "CAD", rate: 0.75, nsRate: 0.75 });

    await user.click(screen.getByRole("button", { name: /line item 111/i }));

    expect(screen.getByRole("textbox", { name: /Budget for line item 111/ })).toHaveValue("10,000");
    expect(screen.getByText("= $7,500 USD")).toBeInTheDocument();
  });
});
