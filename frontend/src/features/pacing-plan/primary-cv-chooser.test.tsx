/**
 * The chooser itself, rendered.
 *
 * `primary-cv-editor.test.ts` beside this covers the rules; this covers what a person sees, because
 * the one state a local environment can actually show is the empty one - a pacing only has
 * conversion ACTIONS after a refresh with Fetch conversions on, so the populated list cannot be
 * eyeballed without production data.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PacingPlanSection } from "./pacing-plan-sheet";
import type { PacingLineItemPlanV1 } from "./types";

vi.mock("./api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn().mockResolvedValue({ addable: [] }),
  validatePacingLineItemsById: vi.fn(),
  updatePacingStatus: vi.fn(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const LI = "100";

function plan(over: Partial<PacingLineItemPlanV1> = {}): Record<string, PacingLineItemPlanV1> {
  return {
    [LI]: {
      lineItemId: LI, channel: "Meta", rateType: "CPM", clientBudget: 10_000,
      plannedImpressions: 1_000_000, marginTargetPct: 25,
      flightStart: "2026-08-01", flightEnd: "2026-08-31", containers: [],
      ...over,
    } as unknown as PacingLineItemPlanV1,
  };
}

const ROWS = [
  { line_item_id: LI, date: "2026-08-01", conversion_action: "Purchase", conversions: 5 },
  { line_item_id: LI, date: "2026-08-01", conversion_action: "Page View", conversions: 40 },
];

function renderSheet(over: { conversions?: Any; planByLineItem?: Any; primaryCvEnabled?: boolean } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PacingPlanSection
        slug="s"
        currency="USD"
        netFeatureOn={false}
        coefEnabled={false}
        primaryCvEnabled={over.primaryCvEnabled ?? true}
        conversions={over.conversions ?? ROWS}
        planByLineItem={over.planByLineItem ?? plan()}
        seedKey={0}
        onDirtyChange={() => {}}
      />
    </QueryClientProvider>
  );
  // The first card opens by default; clicking its header here would COLLAPSE it.
  if (screen.queryByText("Primary conversions") === null) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`LI ${LI}`) }));
  }
}

describe("the primary conversions chooser", () => {
  it("offers the line item its own actions, biggest first, with their counts", () => {
    renderSheet();
    const pageView = screen.getByLabelText(`Count Page View for line item ${LI}`);
    const purchase = screen.getByLabelText(`Count Purchase for line item ${LI}`);
    expect(pageView).not.toBeChecked();
    expect(purchase).not.toBeChecked();
    // The counts are the reason the list is ranked - they are what tells someone which to pick.
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("says a line with no choice counts everything, not that it counts nothing", () => {
    renderSheet();
    expect(screen.getByText("counting every action")).toBeInTheDocument();
  });

  it("ticking an action records it and updates the count caption", () => {
    renderSheet();
    fireEvent.click(screen.getByLabelText(`Count Purchase for line item ${LI}`));
    expect(screen.getByLabelText(`Count Purchase for line item ${LI}`)).toBeChecked();
    expect(screen.getByText("1 of 2 chosen")).toBeInTheDocument();
  });

  it("names a stored choice the delivered rows no longer have", () => {
    renderSheet({ planByLineItem: plan({ storedPrimaryConversions: ["Renamed"] } as Any) });
    // Not silent: a choice matching nothing reads as zero conversions with no explanation.
    expect(screen.getByText(/Not in the delivered data: Renamed/)).toBeInTheDocument();
  });

  it("explains itself rather than drawing an empty list when there are no rows yet", () => {
    renderSheet({ conversions: [] });
    expect(screen.getByText(/No conversion rows for this line item yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText(`Count Purchase for line item ${LI}`)).toBeNull();
  });

  it("stays reachable for a line that already has a choice after the switch goes off", () => {
    // Otherwise the only way to clear a choice would be to turn the pacing switch back on first.
    renderSheet({ primaryCvEnabled: false, planByLineItem: plan({ storedPrimaryConversions: ["Purchase"] } as Any) });
    expect(screen.getByLabelText(`Count Purchase for line item ${LI}`)).toBeChecked();
  });

  it("is hidden on a pacing that uses neither the switch nor a stored choice", () => {
    renderSheet({ primaryCvEnabled: false });
    expect(screen.queryByText("Primary conversions")).toBeNull();
  });
});
