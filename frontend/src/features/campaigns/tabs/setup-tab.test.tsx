import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aCampaignV1, anInsertionOrderLineItemV1, anInsertionOrderV1 } from "../../../test/factories";
import { listCampaignInsertionOrders } from "../api";
import type { CampaignTabContext } from "../campaign-workspace";
import type { CampaignV1 } from "../types";
import { SetupTab } from "./setup-tab";

vi.mock("../api", () => ({
  listCampaignInsertionOrders: vi.fn(),
}));

function renderSetupTab(campaign: CampaignV1 = aCampaignV1({ id: 46252 })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/campaigns/46252/setup"]}>
        <Routes>
          <Route
            path="/campaigns/:campaignId"
            element={<Outlet context={{ campaign } satisfies CampaignTabContext} />}
          >
            <Route path="setup" element={<SetupTab />} />
            <Route path="reporting" element={<div>Reporting content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetupTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show a loading indicator while insertion orders are being fetched", () => {
    // Given:
    vi.mocked(listCampaignInsertionOrders).mockReturnValue(new Promise(() => {}));

    // When:
    renderSetupTab();

    // Then:
    expect(screen.getByRole("status", { name: "Loading campaign setup" })).toBeInTheDocument();
  });

  it("should show a human-readable error when insertion orders fail to load", async () => {
    // Given:
    vi.mocked(listCampaignInsertionOrders).mockRejectedValue(new Error("Something went wrong. Please try again."));

    // When:
    renderSetupTab();

    // Then:
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("should show an empty state naming NetSuite, not a stray empty search string, when the campaign has no insertion orders", async () => {
    // Given:
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([]);

    // When:
    renderSetupTab();

    // Then:
    expect(await screen.findByText("No insertion orders found for this campaign in NetSuite.")).toBeInTheDocument();
  });

  it("should render the reference case - one real order, four real line items - with real ids, budgets, and status", async () => {
    // Given: campaign 46252 / order 276198
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([
      anInsertionOrderV1({
        order_id: 276198,
        order_number: "SO276198",
        status: "Finished",
        budget: 45000,
        media_tactics: ["CTV/OTT", "YouTube", "Native", "Audio"],
        line_items: [
          anInsertionOrderLineItemV1({ line_item_id: 1001, description: "CTV line", media_tactic: "CTV/OTT", budget: 15000 }),
          anInsertionOrderLineItemV1({ line_item_id: 1002, description: "YouTube line", media_tactic: "YouTube", budget: 10000 }),
          anInsertionOrderLineItemV1({ line_item_id: 1003, description: "Native line", media_tactic: "Native", budget: 10000 }),
          anInsertionOrderLineItemV1({ line_item_id: 1004, description: "Audio line", media_tactic: "Audio", budget: 10000 }),
        ],
      }),
    ]);

    // When:
    renderSetupTab();

    // Then: real order number as the title, real order_id in the sub-line, no mock "IO-xxxxx" ids
    expect(await screen.findByText("IO SO276198")).toBeInTheDocument();
    const orderRow = screen.getByText(/ID 276198 · 4 line items/).closest("tr") as HTMLElement;
    expect(within(orderRow).getByText("$45,000")).toBeInTheDocument();
    // A real NetSuite status string ("Finished") renders without crashing (the D7 regression risk),
    // displayed as "Complete" (see displayStatusLabel)
    expect(within(orderRow).getByText("Complete")).toBeInTheDocument();
    const meta = document.querySelector(".setup-tab__meta") as HTMLElement;
    expect(meta.textContent).toContain("1 insertion orders");
    expect(meta.textContent).toContain("4 line items");
  });

  it("should show the extra media tactics in a tooltip on the +N channel tag", async () => {
    // Given:
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([
      anInsertionOrderV1({ order_id: 276198, media_tactics: ["CTV/OTT", "YouTube", "Native", "Audio"] }),
    ]);

    // When:
    renderSetupTab();
    await screen.findByText(/IO SO/);

    // Then: the +3 tag is present, and hovering it reveals the remaining tactic names
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("YouTube, Native, Audio")).toBeInTheDocument();
  });

  it("should match a line item by its channel and show only that line item, not its order's other siblings", async () => {
    // Given: neither the order's name/id nor 3 of its 4 line items' own channel mention "meta" - only
    // one line item's channel does. The order's own channel/channelExtra is just the deduped union of
    // all its line items' channels, so it must never be treated as an order-level match on its own -
    // that would surface every sibling line item under it too (the exact regression this guards).
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([
      anInsertionOrderV1({
        order_id: 1,
        order_number: "SO1",
        media_tactics: ["DOOH", "YouTube", "Video", "Meta"],
        line_items: [
          anInsertionOrderLineItemV1({ line_item_id: 10, media_tactic: "DOOH" }),
          anInsertionOrderLineItemV1({ line_item_id: 20, media_tactic: "YouTube" }),
          anInsertionOrderLineItemV1({ line_item_id: 30, media_tactic: "Video" }),
          anInsertionOrderLineItemV1({ line_item_id: 40, media_tactic: "Meta" }),
        ],
      }),
    ]);
    renderSetupTab();
    await screen.findByText("IO SO1");

    // When:
    await userEvent.type(screen.getByLabelText("Search setup"), "meta");

    // Then: only the Meta line item shows, not its DOOH/YouTube/Video siblings
    expect(screen.getByText("LI 40")).toBeInTheDocument();
    expect(screen.queryByText("LI 10")).not.toBeInTheDocument();
    expect(screen.queryByText("LI 20")).not.toBeInTheDocument();
    expect(screen.queryByText("LI 30")).not.toBeInTheDocument();
  });

  it("should match a line item by its own channel when the parent order's channel doesn't match", async () => {
    // Given: the order's own media tactics don't mention "video" - only one of its line items does
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([
      anInsertionOrderV1({
        order_id: 1,
        order_number: "SO1",
        media_tactics: ["CTV/OTT"],
        line_items: [
          anInsertionOrderLineItemV1({ line_item_id: 10, description: "Prospecting", media_tactic: "CTV/OTT" }),
          anInsertionOrderLineItemV1({ line_item_id: 20, description: "Retargeting", media_tactic: "Video" }),
        ],
      }),
    ]);
    renderSetupTab();
    await screen.findByText("IO SO1");

    // When:
    await userEvent.type(screen.getByLabelText("Search setup"), "video");

    // Then:
    expect(screen.getByText("LI 20")).toBeInTheDocument();
    expect(screen.queryByText("LI 10")).not.toBeInTheDocument();
  });

  it("should request insertion orders exactly once per mount, with no refetch on a search keystroke", async () => {
    // Given:
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([anInsertionOrderV1({ order_id: 1 })]);
    renderSetupTab();
    await screen.findByText(/IO SO/);

    // When:
    await userEvent.type(screen.getByLabelText("Search setup"), "ctv");

    // Then:
    expect(listCampaignInsertionOrders).toHaveBeenCalledTimes(1);
    expect(listCampaignInsertionOrders).toHaveBeenCalledWith(46252);
  });

});
