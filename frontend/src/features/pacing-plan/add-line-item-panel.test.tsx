import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../shared/api/api-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddablePacingLineItems, validatePacingLineItemsById } from "./api";
import { AddLineItemPanel } from "./add-line-item-panel";

vi.mock("./api", () => ({
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
}));

type Addable = Awaited<ReturnType<typeof getAddablePacingLineItems>>;
const CTV = (id: string) => ({
  lineItemId: id, channel: "CTV", rateType: "CPM", plannedUnits: 425000, budgetTotal: 21250,
  flightStart: "2026-10-20", flightEnd: "2026-10-26", description: "Local CTV", currency: "USD",
});

function renderPanel(existing: string[] = ["772066"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AddLineItemPanel slug="winsenate" currency="USD" existingIds={new Set(existing)} onAdd={() => {}} onClose={() => {}} />
    </QueryClientProvider>
  );
}

describe("AddLineItemPanel", () => {
  beforeEach(() => {
    vi.mocked(getAddablePacingLineItems).mockReset();
    vi.mocked(validatePacingLineItemsById).mockReset();
  });

  it("shows each candidate's rate type, plan and flight, as the reference's Add LI card does", async () => {
    // Given: the next week of a prolonged campaign, not yet on the pacing
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({
      ok: true,
      io: "4603",
      addable: [{
        lineItemId: "772073", channel: "CTV", rateType: "CPM", plannedUnits: 425000, budgetTotal: 21250,
        flightStart: "2026-10-20", flightEnd: "2026-10-26", description: "Local CTV", currency: "USD",
      }],
    } as Awaited<ReturnType<typeof getAddablePacingLineItems>>);

    // When:
    renderPanel();

    // Then: everything needed to pick it - the flight above all - is on the card
    expect(await screen.findByText("LI 772073")).toBeInTheDocument();
    expect(screen.getByText("CPM")).toBeInTheDocument();
    expect(screen.getByText("425,000 impr · $21,250.00")).toBeInTheDocument();
    expect(screen.getByText("Oct 20 – Oct 26")).toBeInTheDocument();
    expect(screen.getByText("Local CTV")).toBeInTheDocument();
  });

  it("names the unit a CPC line is bought on and leaves out what it does not know", async () => {
    // Given: a click-paced candidate with no budget and no flight
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({
      ok: true,
      io: "4603",
      addable: [{ lineItemId: "900001", channel: "Search", rateType: "CPC", plannedUnits: 1200, currency: "USD" }],
    } as Awaited<ReturnType<typeof getAddablePacingLineItems>>);

    // When:
    renderPanel();

    // Then:
    expect(await screen.findByText("1,200 clicks")).toBeInTheDocument();
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });

  it("opens on By ID and says why when the pacing has no order number", async () => {
    // Given:
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, addable: [], alreadyAdded: [] } as Addable);

    // When:
    renderPanel();

    // Then: no campaign tab to offer, and the reason is said instead of a blank box
    expect(await screen.findByText(/This pacing has no order number/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /From this campaign/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Line item IDs/)).toBeInTheDocument();
  });

  it("says every line item on the order is already in, rather than showing an empty list", async () => {
    // Given:
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, io: "4603", addable: [], alreadyAdded: ["772066"] } as Addable);

    // When:
    renderPanel();

    // Then:
    expect(await screen.findByText(/Every line item on order 4603 is already in this pacing/)).toBeInTheDocument();
  });

  it("shows a line item already added to the draft but does not let it be added twice", async () => {
    // Given: 772073 was added a moment ago and not saved, so the server still offers it
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({
      ok: true, io: "4603", addable: [CTV("772073"), CTV("772074")], alreadyAdded: ["772066"],
    } as Addable);

    // When:
    renderPanel(["772066", "772073"]);

    // Then:
    expect(await screen.findByText("in this pacing")).toBeInTheDocument();
    expect(screen.getByText("1 can be added · 1 cannot")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeDisabled();
    expect(boxes[1]).toBeEnabled();
  });

  it("selects every addable line item at once and clears them again", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({
      ok: true, io: "4603", addable: [CTV("772073"), CTV("772074")], alreadyAdded: [],
    } as Addable);
    renderPanel();
    await screen.findByText("LI 772073");

    // When:
    await user.click(screen.getByRole("button", { name: "Select all" }));

    // Then:
    expect(screen.getByRole("button", { name: "Add selected (2)" })).toBeEnabled();

    // When:
    await user.click(screen.getByRole("button", { name: "Clear" }));

    // Then:
    expect(screen.getByRole("button", { name: "Add selected" })).toBeDisabled();
  });

  it("reads the campaign list again on Refresh list", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, io: "4603", addable: [CTV("772073")], alreadyAdded: [] } as Addable);
    renderPanel();
    await screen.findByText("LI 772073");

    // When:
    await user.click(screen.getByRole("button", { name: "Refresh list" }));

    // Then:
    expect(getAddablePacingLineItems).toHaveBeenCalledTimes(2);
  });

  it("says too many lookups in words when NetSuite is rate limited", async () => {
    // Given:
    vi.mocked(getAddablePacingLineItems).mockRejectedValue(new ApiError("rate_limit_exceeded", 429));

    // When:
    renderPanel();

    // Then:
    expect(await screen.findByText(/Too many NetSuite lookups in the last minute/)).toBeInTheDocument();
  });

  it("names the ids it skipped because they are already in the pacing", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(getAddablePacingLineItems).mockResolvedValue({ ok: true, addable: [], alreadyAdded: [] } as Addable);
    vi.mocked(validatePacingLineItemsById).mockResolvedValue({ ok: true, lineItems: [CTV("772073")] } as Awaited<ReturnType<typeof validatePacingLineItemsById>>);
    renderPanel();
    await screen.findByText(/This pacing has no order number/);

    // When:
    await user.type(screen.getByPlaceholderText(/Line item IDs/), "772066, 772073");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    // Then:
    expect(await screen.findByText("Skipped (already added): 772066")).toBeInTheDocument();
    expect(screen.getByText("LI 772073")).toBeInTheDocument();
  });
});
