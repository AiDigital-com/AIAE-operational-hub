import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aCampaignRefV1,
  aPacingAlertV1,
  aPacingListResponseV1,
  aPacingRowV1,
  aPacingScopeV1,
} from "@/test/factories";
import { ApiError } from "../../shared/api/api-error";
import { listPacingOverview } from "./api";
import { PacingOverview } from "./pacing-overview";

vi.mock("./api", () => ({
  listPacingOverview: vi.fn(),
}));

/** Stands in for the real campaign Pacing tab, to assert on WHAT a clicked row navigated to
 *  (US-113) without pulling in the whole campaign workspace. */
function LandedOnCampaignTab() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const location = useLocation();
  const state = location.state as { openPacingId?: string } | null;
  return <p>Landed on campaign {campaignId}, open {state?.openPacingId}</p>;
}

function renderPacingOverview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PacingOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PacingOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should request the list exactly once for the whole screen (US-109)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [aPacingRowV1()] }));

    // When:
    renderPacingOverview();
    await screen.findByRole("table");

    // Then: one request for the whole page, never one per row
    expect(listPacingOverview).toHaveBeenCalledTimes(1);
  });

  it("should render the columns US-109 asks for", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            id: "p1",
            name: "Nike SS26 Display",
            status: "Live",
            ownerName: "Azat Nabiev",
            marginActualPct: 18.5,
            marginTargetPct: 25,
            pacingDeviationPct: -12.3,
            paceStatus: "under",
            budgetTotal: 1_250_000,
            flightStart: "2026-08-01",
            flightEnd: "2026-09-30",
            lineItemCount: 4,
          }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    const row = (await screen.findByText("Nike SS26 Display")).closest("tr") as HTMLElement;

    // Then: campaign, status, owner, margin actual/target, pacing deviation, budget, flight, line items
    expect(within(row).getByText("Live")).toBeInTheDocument();
    expect(within(row).getByText("Azat Nabiev")).toBeInTheDocument();
    expect(within(row).getByText(/18\.5%/)).toBeInTheDocument();
    expect(within(row).getByText(/25%/)).toBeInTheDocument();
    expect(within(row).getByText(/-12\.3pp/)).toBeInTheDocument();
    expect(within(row).getByText("Under pace")).toBeInTheDocument();
    expect(within(row).getByText("$1.3M")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
  });

  it("should show the first campaign plus a count of the rest on a multi-campaign row (US-107)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            campaigns: [
              { id: "CAMP-NIKE", name: "Nike SS26" },
              { id: "CAMP-ADIDAS", name: "Adidas Q4" },
              { id: "CAMP-PUMA", name: "Puma Retarget" },
            ],
          }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    const table = await screen.findByRole("table");

    // Then: the primary campaign is named, and the other two are collapsed into a count. Scoped to
    // the table body, not the campaign filter dropdown, which also lists every campaign by name.
    expect(within(table).getByText("Nike SS26")).toBeInTheDocument();
    expect(within(table).getByText("+2 more")).toBeInTheDocument();
    expect(within(table).queryByText("Adidas Q4")).not.toBeInTheDocument();
  });

  it("should render alert badges grouped by severity (US-110)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            alerts: [
              aPacingAlertV1({ type: "pacing_off_pace", severity: "critical", text: "Pacing way off" }),
              aPacingAlertV1({ type: "margin_below_target", severity: "warning", text: "Margin low" }),
              aPacingAlertV1({ type: "stale_data", severity: "warning", text: "Data is stale" }),
            ],
          }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByRole("table");

    // Then: one badge per severity present, counting how many alerts of that severity fired
    expect(screen.getByText("1")).toBeInTheDocument(); // critical
    expect(screen.getByText("2")).toBeInTheDocument(); // warning
  });

  it("should filter by status against the already-loaded set, without a second request", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Live Pacing", status: "Live" }),
          aPacingRowV1({ id: "p2", name: "Paused Pacing", status: "Paused" }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Live Pacing");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "Paused");

    // Then:
    expect(screen.queryByText("Live Pacing")).not.toBeInTheDocument();
    expect(screen.getByText("Paused Pacing")).toBeInTheDocument();
    expect(listPacingOverview).toHaveBeenCalledTimes(1);
  });

  it("should drop archived pacings from the default view but keep them findable via the status filter (§9, US-128)", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Live Pacing", status: "Live" }),
          aPacingRowV1({ id: "p2", name: "Retired Pacing", status: "Archive" }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Live Pacing");

    // Then: archived stays out of "All statuses" ...
    expect(screen.queryByText("Retired Pacing")).not.toBeInTheDocument();

    // ... but selecting "Archive" explicitly still finds it.
    await user.selectOptions(screen.getByLabelText("Filter by status"), "Archive");
    expect(screen.getByText("Retired Pacing")).toBeInTheDocument();
    expect(screen.queryByText("Live Pacing")).not.toBeInTheDocument();
  });

  it("should filter by campaign against the already-loaded set", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Nike Pacing", campaigns: [{ id: "CAMP-NIKE", name: "Nike SS26" }] }),
          aPacingRowV1({ id: "p2", name: "Adidas Pacing", campaigns: [{ id: "CAMP-ADIDAS", name: "Adidas Q4" }] }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Nike Pacing");
    await user.selectOptions(screen.getByLabelText("Filter by campaign"), "CAMP-ADIDAS");

    // Then:
    expect(screen.queryByText("Nike Pacing")).not.toBeInTheDocument();
    expect(screen.getByText("Adidas Pacing")).toBeInTheDocument();
  });

  it("should search across name, owner and campaign name in the loaded set", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Nike Pacing", ownerName: "Alice", campaigns: [] }),
          aPacingRowV1({ id: "p2", name: "Other Pacing", ownerName: "Bob", campaigns: [{ id: "c1", name: "Reebok Launch" }] }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Nike Pacing");
    await user.type(screen.getByLabelText("Search pacings"), "reebok");

    // Then: debounced search narrows to the row matching by campaign name
    await waitFor(() => expect(screen.queryByText("Nike Pacing")).not.toBeInTheDocument());
    expect(screen.getByText("Other Pacing")).toBeInTheDocument();
  });

  it("should sort by a clicked column and cycle asc -> desc -> off", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Bravo", budgetTotal: 500 }),
          aPacingRowV1({ id: "p2", name: "Alpha", budgetTotal: 900 }),
        ],
      })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Bravo");
    const rowNames = () => screen.getAllByRole("row").slice(1).map((row) => within(row).queryAllByRole("cell")[0]?.textContent);

    await user.click(screen.getByRole("button", { name: /Campaign/ }));

    // Then: ascending by name puts Alpha first
    await waitFor(() => expect(rowNames()[0]).toContain("Alpha"));

    // When: clicked again, descending
    await user.click(screen.getByRole("button", { name: /Campaign/ }));
    await waitFor(() => expect(rowNames()[0]).toContain("Bravo"));
  });

  it("should explain an empty Client Services scope rather than showing a blank table (US-111)", async () => {
    // Given: the Hub cannot yet resolve which NetSuite campaigns a CS user owns, so it sends an empty
    // campaigns scope and Pacing correctly returns nothing.
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ scope: aPacingScopeV1({ kind: "campaigns", ids: [] }), pacings: [] })
    );

    // When:
    renderPacingOverview();

    // Then:
    expect(await screen.findByText(/Campaign ownership isn't resolved yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("should explain an empty owners scope differently from an empty campaigns scope", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ scope: aPacingScopeV1({ kind: "owners", ids: [] }), pacings: [] })
    );

    // When:
    renderPacingOverview();

    // Then:
    expect(await screen.findByText(/Nobody in scope yet/)).toBeInTheDocument();
  });

  it("should distinguish a filtered-to-empty result from an empty scope", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Nike Pacing", status: "Live" })] })
    );

    // When:
    renderPacingOverview();
    await screen.findByText("Nike Pacing");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "Live");
    await user.type(screen.getByLabelText("Search pacings"), "does-not-exist");

    // Then: a distinct "matched nothing" message, not the scope-empty copy, plus a way back
    expect(await screen.findByText(/No pacings match your filters/)).toBeInTheDocument();
    const clearButton = screen.getByRole("button", { name: /Clear filters/ });
    await user.click(clearButton);
    expect(await screen.findByText("Nike Pacing")).toBeInTheDocument();
  });

  it("should show a friendly message when the Hub reports the account isn't synced to Pacing yet (409)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockRejectedValue(new ApiError("Conflict", 409));

    // When:
    renderPacingOverview();

    // Then:
    expect(await screen.findByText(/isn't synced to Pacing yet/)).toBeInTheDocument();
  });

  it("should surface a generic failure message for any other error", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockRejectedValue(new Error("Pacing is unreachable"));

    // When:
    renderPacingOverview();

    // Then:
    expect(await screen.findByText("Pacing is unreachable")).toBeInTheDocument();
  });

  it("should open a pacing on its first campaign's Pacing tab when its row is clicked (US-113)", async () => {
    // Given: a pacing whose first campaign is id 42
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [aPacingRowV1({ id: "pacing-1", name: "Nike Pacing", campaigns: [aCampaignRefV1({ id: "42" })] })],
      })
    );

    // When:
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/pacing"]}>
          <Routes>
            <Route path="/pacing" element={<PacingOverview />} />
            <Route path="/campaigns/:campaignId/pacing" element={<LandedOnCampaignTab />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await user.click(await screen.findByText("Nike Pacing"));

    // Then: navigated to campaign 42's Pacing tab, carrying which pacing to open
    expect(await screen.findByText("Landed on campaign 42, open pacing-1")).toBeInTheDocument();
  });

  it("should not attach a click handler to a row with no resolvable campaign", async () => {
    // Given: no campaigns at all - nothing to navigate to
    const user = userEvent.setup();
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Orphan Pacing", campaigns: [] })] })
    );

    // When:
    renderPacingOverview();
    await user.click(await screen.findByText("Orphan Pacing"));

    // Then: still on the Overview - clicking did nothing
    expect(screen.getByText("Orphan Pacing")).toBeInTheDocument();
  });
});
