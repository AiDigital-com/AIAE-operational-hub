import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDraftLineItemV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { savePacingPlan } from "./api";
import { PacingPlanSection, type PlanLineItemSummary } from "./pacing-plan-sheet";
import type { SettingsSectionHandle } from "../pacing-dashboard/settings-section";
import type { PacingLineItemPlanUpdateV1, PacingLineItemPlanV1 } from "./types";

vi.mock("./api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
}));

/**
 * The plan section driven the way the drawer drives it from a mapping picker: line items arrive
 * through the handle, not through the section's own panel.
 */
function renderSection(planByLineItem: Record<string, PacingLineItemPlanV1>, onLineItemsChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handle: { current: SettingsSectionHandle | null } = { current: null };
  function Harness() {
    const ref = useRef<SettingsSectionHandle>(null);
    return (
      <>
        <PacingPlanSection
          ref={(instance) => { ref.current = instance; handle.current = instance; }}
          slug="nike-ss26"
          currency="USD"
          rate={1}
          netFeatureOn={false}
          coefEnabled={false}
          primaryCvEnabled
          conversions={[]}
          cvData={{ primary_cv_enabled: true, fetch_conversions: true }}
          planByLineItem={planByLineItem}
          seedKey={1}
          onLineItemsChange={onLineItemsChange}
          onDirtyChange={() => {}}
        />
        <button type="button" onClick={() => void ref.current?.save()}>Save plan</button>
      </>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
  return handle;
}

describe("PacingPlanSection - line items added from another screen", () => {
  beforeEach(() => {
    vi.mocked(savePacingPlan).mockReset().mockResolvedValue({ saved: true });
  });

  it("joins the draft, is reported to the drawer, and starts with the primary conversions the others share", async () => {
    // Given: two line items that both count only Purchase
    const user = userEvent.setup();
    const onLineItemsChange = vi.fn();
    const handle = renderSection({
      "111": aPacingLineItemPlanV1({ lineItemId: "111", storedPrimaryConversions: ["Purchase"] }),
      "222": aPacingLineItemPlanV1({ lineItemId: "222", storedPrimaryConversions: ["Purchase"] }),
    }, onLineItemsChange);
    await screen.findByText("LI 111");

    // When: a mapping picker adds the next month's line item
    act(() => {
      handle.current?.addLineItems?.([aPacingDraftLineItemV1({ lineItemId: "333", channel: "CTV", currency: "USD" })]);
    });

    // Then: the drawer hears of it, so the pickers can offer it straight away…
    await waitFor(() => {
      const last = onLineItemsChange.mock.calls.at(-1)?.[0] as PlanLineItemSummary[];
      expect(last.map((li) => li.id)).toEqual(["111", "222", "333"]);
    });

    // …and it is saved counting Purchase, like the line items beside it
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(savePacingPlan).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(savePacingPlan).mock.calls[0] as [string, PacingLineItemPlanUpdateV1[]];
    const added = payload.find((li) => li.lineItemId === "333");
    expect(added?.primaryConversions).toEqual(["Purchase"]);
  });
});
