import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDraftLineItemV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { getAddablePacingLineItems, savePacingPlan } from "./api";
import { PacingPlanSheet } from "./pacing-plan-sheet";
import type { PacingAddableLineItemsV1, PacingLineItemPlanUpdateV1, PacingLineItemPlanV1 } from "./types";

vi.mock("./api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
  updatePacingStatus: vi.fn(),
}));

function renderSheet(planByLineItem: Record<string, PacingLineItemPlanV1>, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PacingPlanSheet open onClose={onClose} slug="nike-ss26" currency="USD" planByLineItem={planByLineItem} />
      </QueryClientProvider>
    ),
  };
}

const emptyAddable: PacingAddableLineItemsV1 = { ok: true, addable: [], alreadyAdded: [] };

describe("PacingPlanSheet", () => {
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

    // When:
    await screen.findByText("LI 111");
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
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, addable: [candidate], alreadyAdded: [] });
    vi.mocked(savePacingPlan).mockResolvedValue({ saved: true });
    renderSheet({ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) });
    await screen.findByText("LI 111");

    // When:
    await user.click(screen.getByRole("button", { name: "+ Add line item" }));
    await screen.findByText("LI 7");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add selected" }));

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
