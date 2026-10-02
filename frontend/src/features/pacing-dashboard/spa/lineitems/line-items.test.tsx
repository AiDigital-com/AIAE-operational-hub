/**
 * The Line Items block, over the page that mounts it (§6, PDI_167).
 *
 * Asserted END TO END rather than against the tile in isolation, for the reason the moved renderer's
 * own page test gives: the payload, the state seam, the moved maths and the markup are four separate
 * things that can each be wrong, and only the whole path proves the block draws the figures a reader
 * will actually see.
 *
 * The block wraps itself in Pacing's `SectionBoundary`, which CATCHES a render error, logs it and
 * prints "Error in LineItems: …" in its place. A test that only checked the page still renders would
 * pass on a completely broken block, so every case below asserts on content, and the first one
 * asserts the boundary did NOT trip.
 *
 * Every card lookup is scoped to the block with `within(section)`. The Daily Performance table below
 * it prints the same `LI <id>` in a column of its own, so a page-wide query matches two elements and
 * would have failed on a perfectly good block.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "../../api";
import { ToastProvider } from "../../../../shared/ui/toast/toast";
import { PacingDashboard } from "../../pacing-dashboard";

vi.mock("../../api", () => ({
  getPacingDashboard: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  triggerPacingRefresh: vi.fn(),
  savePacingDisplay: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

/** Two line items on different channels, each with delivery, so the block has something to group,
 *  search and count. Figures are round on purpose - a reader can check the arithmetic by eye. */
function twoLineItems() {
  const display = aPacingLineItemPlanV1({
    lineItemId: "70123",
    channel: "Display",
    clientBudget: 10_000,
    plannedImpressions: 1_000_000,
  });
  const video = aPacingLineItemPlanV1({
    lineItemId: "70124",
    channel: "Video",
    clientBudget: 20_000,
    plannedImpressions: 2_000_000,
  });
  return { display, video };
}

function renderPage(payload: Parameters<typeof aPacingDashboardV1>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1(payload));
  vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PacingDashboard row={aPacingRowV1()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** The block's own card, found by the line item id it prints. */
async function lineItemsSection() {
  return waitFor(() => {
    const heading = screen.getByText("Line Items");
    const section = heading.closest("div")?.parentElement;
    expect(section).toBeTruthy();
    return section as HTMLElement;
  });
}

describe("Line Items block (PDI_167)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should draw one card per line item, with its figures", async () => {
    const { display, video } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: display, [video.lineItemId]: video },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
        { date: "2026-08-02", line_item_id: "70123", impressions: 150_000, clicks: 160, spend: 700 },
        { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
      ] as never,
    });

    const section = await lineItemsSection();
    // The boundary prints this instead of the block when anything inside throws. Checked FIRST:
    // without it every assertion below could be passing on a page that shows an error message.
    expect(document.body.textContent).not.toMatch(/Error in LineItems/);

    // Both line items are named. `LI <id>` is the card's fallback title, used when the pacing
    // carries no custom name and no description - which is this fixture.
    await waitFor(() => {
      expect(within(section).getByText("LI 70123")).toBeTruthy();
      expect(within(section).getByText("LI 70124")).toBeTruthy();
    });
    // And delivery actually reached the cards: 100 000 + 150 000 on the first line item, formatted
    // the way Pacing formats impressions. A card that rendered with zeroed facts would print 0.
    expect(section.textContent).toMatch(/250,000/);
  });

  it("should offer the channel grouping only when there is more than one channel", async () => {
    // One channel: the All lines / By channel pair is a control with nothing to switch between, so
    // Pacing hides it rather than offering a no-op.
    const { display } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: display },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());
    expect(within(section).queryByRole("button", { name: "By channel" })).toBeNull();
  });

  it("should group the cards under their channels when asked", async () => {
    const { display, video } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: display, [video.lineItemId]: video },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
        { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());

    await userEvent.click(within(section).getByRole("button", { name: "By channel" }));

    // Two channel headers appear, each counting its own lines. Read off the header rows themselves,
    // not by text: every card also carries its channel as a chip, so "Video" matches twice.
    const headers = await waitFor(() => {
      const rows = section.querySelectorAll(".lis-ch-head");
      expect(rows.length).toBe(2);
      return [...rows].map((r) => r.textContent ?? "");
    });
    // Video first: the grouping ranks channels by delivery, and Video delivered 300 000 against
    // Display's 100 000.
    expect(headers[0]).toMatch(/Video/);
    expect(headers[1]).toMatch(/Display/);
    // One line item under each, with its impressions beside the count.
    expect(headers[0]).toMatch(/1 line/);
    expect(headers[0]).toMatch(/300,000 impr/);
  });

  it("should filter the cards by the search box", async () => {
    const { display, video } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: display, [video.lineItemId]: video },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
        { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70124")).toBeTruthy());

    await userEvent.type(within(section).getByPlaceholderText("Search line items..."), "70123");

    await waitFor(() => expect(within(section).queryByText("LI 70124")).toBeNull());
    expect(within(section).getByText("LI 70123")).toBeTruthy();
  });

  it("should say so rather than go blank when the search matches nothing", async () => {
    const { display } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: display },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());

    await userEvent.type(within(section).getByPlaceholderText("Search line items..."), "zzzz");

    await waitFor(() => expect(section.textContent).toMatch(/No line items match/));
  });

  it("should filter the whole page by date when a timeline segment is clicked", async () => {
    // The card's flight bar is not decoration: a click on a segment sets the page's date range, which
    // is the one place the moved block writes back into this app's own filter state. Worth asserting
    // end to end - Pacing's `setFilters({ range: "custom", customRange })` patch shape has to match
    // what `use-url-filters.ts` accepts, and nothing but a running click proves that.
    // The bar maps the line item's CONTAINERS onto its flight, not the flight itself - a plan with no
    // containers draws an empty bar and there is nothing to click. So this one carries a container.
    const { display } = twoLineItems();
    const withContainer = {
      ...display,
      containers: [
        {
          id: "c1",
          name: "Initial",
          fs: "2026-08-05",
          fe: "2026-08-20",
          target_impressions: 400_000,
          date_children: [],
          dim_children: [],
        },
      ],
    };
    renderPage({
      planByLineItem: { [display.lineItemId]: withContainer as never },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());

    const segment = await waitFor(() => {
      const el = section.querySelector(".tl-seg");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await userEvent.click(segment);

    // The filter bar above the board now carries the segment's own window as an active date chip -
    // the PAGE moved, not just the card. Asserted on the dates rather than on the word "Custom",
    // which is the patch's internal range key and never reaches the screen.
    await waitFor(() => expect(document.body.textContent).toMatch(/Aug 5\s*–\s*Aug 20/));
  });

  it("should title a card by its custom name, and fall back to the description then the id", async () => {
    // `display.liNames` / `display.showDescription` are Pacing's own Display settings. The Hub's
    // contract does not name either field - it passes `display` through opaquely
    // (`additionalProperties: true`) - so "they arrive" is an assumption until something renders
    // them. No pacing in the local database carries them, which is exactly why this is a test and
    // not a look at the screen.
    const { display, video } = twoLineItems();
    renderPage({
      planByLineItem: {
        [display.lineItemId]: { ...display, description: "Southwest retargeting" } as never,
        [video.lineItemId]: video,
      },
      display: { rev: 1, widgets: [], liNames: { "70123": "Prospecting · CTV" }, showDescription: true } as never,
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
        { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
      ] as never,
    });

    const section = await lineItemsSection();

    // Custom name wins, and the raw id stays as a secondary chip so the row is still identifiable.
    await waitFor(() => expect(within(section).getByText("Prospecting · CTV")).toBeTruthy());
    expect(within(section).getByText("LI 70123")).toBeTruthy();

    // No custom name on the second line item, and it has no description either -> the id is the title.
    expect(within(section).getByText("LI 70124")).toBeTruthy();
    expect(within(section).queryByText("Southwest retargeting")).toBeNull();
  });

  it("should title a card by its description when there is no custom name", async () => {
    const { display } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: { ...display, description: "Southwest retargeting" } as never },
      display: { rev: 1, widgets: [], showDescription: true } as never,
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("Southwest retargeting")).toBeTruthy());
    expect(within(section).getByText("LI 70123")).toBeTruthy();
  });

  it("should ignore descriptions while showDescription is off", async () => {
    const { display } = twoLineItems();
    renderPage({
      planByLineItem: { [display.lineItemId]: { ...display, description: "Southwest retargeting" } as never },
      display: { rev: 1, widgets: [] },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());
    expect(within(section).queryByText("Southwest retargeting")).toBeNull();
  });

  it("should hold its shape on a pacing with no line items at all", async () => {
    // Pacing renders this block unconditionally - its registry entry carries no `visible` predicate -
    // so an empty plan gets the card, the heading and the search box with nothing under them. Kept as
    // it is rather than quietly adding a guard the reference does not have; asserted so the behaviour
    // is a decision on record rather than something nobody looked at.
    renderPage({ planByLineItem: {}, factsDaily: [] as never });

    const section = await lineItemsSection();
    expect(within(section).getByPlaceholderText("Search line items...")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Error in LineItems/);
  });

  it("should still draw the block on a pacing whose line items carry no containers", async () => {
    // The regression the removed "Containers and splits" table could not cover: that table hid
    // itself entirely when `metrics.containers` was empty, so a plan with no period splits had
    // nowhere at all to see its line items. This block does not depend on containers.
    const { display } = twoLineItems();
    expect(display.containers).toEqual([]);
    renderPage({
      planByLineItem: { [display.lineItemId]: display },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      ] as never,
    });

    const section = await lineItemsSection();
    await waitFor(() => expect(within(section).getByText("LI 70123")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/Error in LineItems/);
  });
});
