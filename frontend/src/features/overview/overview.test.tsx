import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aCampaignRefV1,
  anAgencyPageV1,
  anAgencyV1,
  aPacingLineItemHealthV1,
  aPacingListResponseV1,
  aPacingRowV1,
  aPacingScopeV1,
} from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { searchAgencies } from "../agencies/api";
import { triggerPacingRefresh } from "../pacing-dashboard/api";
import { listPacingOverview } from "../pacing-overview/api";
import { Overview } from "./overview";

vi.mock("../pacing-overview/api", () => ({
  listPacingOverview: vi.fn(),
  listCampaignPacings: vi.fn(),
  listAssignableOwners: vi.fn(),
  transferPacingOwner: vi.fn(),
  getPacingNsDiff: vi.fn(),
}));

vi.mock("../agencies/api", () => ({
  searchAgencies: vi.fn(),
}));

// The row menu's refresh path plus everything else the pacing-dashboard module graph exports that
// this page's imports touch - a partial mock would make the whole table throw on import.
vi.mock("../pacing-dashboard/api", () => ({
  triggerPacingRefresh: vi.fn(),
  getPacingDashboard: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  savePacingDataSettings: vi.fn(),
  savePacingNotifySettings: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

/** Renders the current query string, so a test can assert what the page put in the address. */
function LocationProbe() {
  return <div data-testid="location-search">{useLocation().search}</div>;
}

function renderOverview(url = "/", user: { user_id?: string; full_name?: string; roles?: string[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seeded rather than fetched: the app shell holds Overview back until the profile is cached, and
  // both the remembered filters and the own-group-first ordering are scoped to whoever it names.
  queryClient.setQueryData(["auth", "me"], {
    user_id: user.user_id ?? "user_1",
    email: "one@aidigital.com",
    full_name: user.full_name ?? "Azat Nabiev",
    roles: user.roles ?? [],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <Overview />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** The owner names in card order, for asserting group ordering. */
function ownerNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".overview__owner-name")).map((el) => el.textContent ?? "");
}

describe("Overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({ content: [anAgencyV1({ id: 1, name: "Northstar Media" })] }));
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [aPacingRowV1()] }));
  });

  it("should request the pacing list exactly once for the whole screen", async () => {
    // When:
    renderOverview();
    await screen.findByRole("table");

    // Then: one request, never one per row or per filter change
    expect(listPacingOverview).toHaveBeenCalledTimes(1);
  });

  it("should group pacings by owner: the viewer's group first, others alphabetical, Unassigned last", async () => {
    // Given: alphabetical order alone would put Boris first
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ ownerName: "Boris Antipov" }),
          aPacingRowV1({ ownerName: undefined }),
          aPacingRowV1({ ownerName: "Azat Nabiev" }),
        ],
      })
    );

    // When:
    const { container } = renderOverview("/", { full_name: "Azat Nabiev" });
    await screen.findAllByRole("table");

    // Then:
    expect(ownerNames(container)).toEqual(["Azat Nabiev", "Boris Antipov", "Unassigned"]);
  });

  it("should render the row's figures: status, budget, margin, pacing bar, flight with countdown, LI count", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            name: "Nike SS26 Display",
            status: "Live",
            agency: "Initiative",
            client: "Nike",
            budgetTotal: 1_250_000,
            marginActualPct: 18.5,
            marginTargetPct: 25,
            pacingDeviationPct: 12.3,
            flightStart: "2026-08-01",
            flightEnd: "2026-09-30",
            daysRemaining: 14,
            liCount: 4,
          }),
        ],
      })
    );

    // When:
    renderOverview();
    const row = (await screen.findByText("Nike SS26 Display")).closest("tr") as HTMLElement;

    // Then:
    expect(within(row).getByText("Live")).toBeInTheDocument();
    expect(within(row).getByText("Initiative · Nike")).toBeInTheDocument();
    expect(within(row).getByText("$1.3M")).toBeInTheDocument();
    expect(within(row).getByText(/18\.5%/)).toBeInTheDocument();
    expect(within(row).getByText(/\+12\.3 pp/)).toBeInTheDocument();
    expect(within(row).getByText(/08\/01/)).toBeInTheDocument();
    expect(within(row).getByText("14d")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
  });

  it("should show delegation pills and the period-scope marker", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            delegatedFrom: { name: "Daria Feofanova", expiresAt: "2026-10-01" },
            delegatedTo: [{ name: "Bob Petrov", expiresAt: "2026-10-15" }],
            periodScope: true,
            periodScopeState: "ended",
            periodLabel: "Sep 2026",
          }),
        ],
      })
    );

    // When:
    renderOverview();
    await screen.findByRole("table");

    // Then:
    expect(screen.getByText("← Daria Feofanova")).toBeInTheDocument();
    expect(screen.getByText("→ Bob Petrov")).toBeInTheDocument();
    expect(screen.getByText("Out of period · Sep 2026")).toBeInTheDocument();
  });

  it("should hide archived pacings under All and show them when Archived is picked (US-128)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ name: "Running", status: "Live" }),
          aPacingRowV1({ name: "Shelved", status: "Archive" }),
        ],
      })
    );

    // When:
    renderOverview();
    await screen.findByText("Running");

    // Then: All hides Archive
    expect(screen.queryByText("Shelved")).not.toBeInTheDocument();

    // When: picking Archived explicitly
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));

    // Then: the archived pacing is findable, the live one filtered out
    expect(await screen.findByText("Shelved")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("should filter by agency through any of a pacing's campaigns, dropping unresolved pacings", async () => {
    // Given: one pacing resolved to agency 1, one whose campaigns never resolved
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ name: "Resolved", campaigns: [aCampaignRefV1({ agencyId: 1, agencyName: "Northstar Media" })] }),
          aPacingRowV1({ name: "Unresolved", campaigns: undefined }),
        ],
      })
    );
    renderOverview();
    await screen.findByText("Resolved");

    // When: selecting the agency in the MultiSelect
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(await screen.findByText("Northstar Media"));

    // Then: the pacing with no resolvable agency honestly drops out
    await waitFor(() => expect(screen.queryByText("Unresolved")).not.toBeInTheDocument());
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("should search across pacing name, owner, campaigns, agency and client", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ name: "First", client: "Globex Corp" }),
          aPacingRowV1({ name: "Second", client: "Acme" }),
        ],
      })
    );
    renderOverview();
    await screen.findByText("First");

    // When: searching by the CLIENT name, which the old search never matched
    await userEvent.type(screen.getByRole("searchbox", { name: "Search pacings" }), "globex");

    // Then:
    await waitFor(() => expect(screen.queryByText("Second")).not.toBeInTheDocument());
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("should expand a row into its line items, with the heatmap and KPI sparkline", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            name: "Nike SS26 Display",
            lineItems: [aPacingLineItemHealthV1({ lineItemId: "599888" })],
            liNames: { "599888": "Prospecting" },
            liDesc: { "599888": "NW | Native Display" },
          }),
        ],
      })
    );
    const { container } = renderOverview();
    await screen.findByText("Nike SS26 Display");

    // Then: nothing expanded yet
    expect(screen.queryByText("599888")).not.toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand Nike SS26 Display" }));

    // Then: the LI identity, its custom caption, the heatmap cells and the sparkline label
    expect(await screen.findByText("599888")).toBeInTheDocument();
    expect(screen.getByText("Prospecting")).toBeInTheDocument();
    expect(container.querySelector(".heatmap-strip svg")).toBeInTheDocument();
    expect(screen.getByText("CTR")).toBeInTheDocument();
  });

  it("should say so when an expanded pacing has no line item data", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Fresh", lineItems: undefined })] })
    );
    renderOverview();
    await screen.findByText("Fresh");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand Fresh" }));

    // Then:
    expect(await screen.findByText("No line item data")).toBeInTheDocument();
  });

  it("should expand and collapse every row from the toolbar, and a whole group from its header", async () => {
    // Given: two owners, one pacing each
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ name: "Mine", ownerName: "Azat Nabiev", lineItems: [aPacingLineItemHealthV1({ lineItemId: "111" })] }),
          aPacingRowV1({ name: "Theirs", ownerName: "Boris Antipov", lineItems: [aPacingLineItemHealthV1({ lineItemId: "222" })] }),
        ],
      })
    );
    renderOverview();
    await screen.findByText("Mine");

    // When: the toolbar's Expand All
    await userEvent.click(screen.getByRole("button", { name: "Expand All" }));

    // Then: both groups' line items are open, and the button reads Collapse All
    expect(await screen.findByText("111")).toBeInTheDocument();
    expect(screen.getByText("222")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Collapse All" }));
    expect(screen.queryByText("111")).not.toBeInTheDocument();

    // When: one group's own "Expand all"
    await userEvent.click(screen.getAllByRole("button", { name: "Expand all" })[0]);

    // Then: only that group's rows open
    expect(await screen.findByText("111")).toBeInTheDocument();
    expect(screen.queryByText("222")).not.toBeInTheDocument();
  });

  it("should navigate to the primary campaign's Pacing tab from the row's open button (US-113)", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [aPacingRowV1({ id: "p1", name: "Nike", campaigns: [aCampaignRefV1({ id: "310739" })] })],
      })
    );
    renderOverview();
    await screen.findByText("Nike");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Open pacing" }));

    // Then:
    expect(mockNavigate).toHaveBeenCalledWith("/campaigns/310739/pacing", { state: { openPacingId: "p1" } });
  });

  it("should compute the summary stats from the filtered set", async () => {
    // Given: an archived pacing that the default view hides
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ status: "Live", liCount: 3, budgetTotal: 10_000 }),
          aPacingRowV1({ status: "Archive", liCount: 9, budgetTotal: 90_000 }),
        ],
      })
    );

    // When:
    renderOverview();
    await screen.findByRole("table");

    // Then: the archived row counts toward nothing
    const pacingsStat = screen.getByText("Pacings", { selector: ".overview__stat-label" }).parentElement as HTMLElement;
    expect(within(pacingsStat).getByText("1")).toBeInTheDocument();
    const liStat = screen.getByText("Line items", { selector: ".overview__stat-label" }).parentElement as HTMLElement;
    expect(within(liStat).getByText("3")).toBeInTheDocument();
    const budgetStat = screen.getByText("Budget", { selector: ".overview__stat-label" }).parentElement as HTMLElement;
    expect(within(budgetStat).getByText("$10.0K")).toBeInTheDocument();
  });

  it("should write the filters to the URL and remember them for the session (PDI_097)", async () => {
    // Given:
    renderOverview();
    await screen.findByRole("table");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));

    // Then: the URL carries the filter, and the session remembers it for this user
    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("status=archive"));
    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem("overview-filters") ?? "{}") as { user?: string; filters?: string };
      expect(stored.user).toBe("user_1");
      expect(stored.filters).toContain("status=archive");
    });
  });

  it("should restore this user's remembered filters when the URL carries none", async () => {
    // Given: a filtered view remembered earlier this session
    sessionStorage.setItem("overview-filters", JSON.stringify({ user: "user_1", filters: "status=archive" }));
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [aPacingRowV1({ name: "Running", status: "Live" }), aPacingRowV1({ name: "Shelved", status: "Archive" })],
      })
    );

    // When: arriving by the sidebar's bare "/"
    renderOverview("/", { user_id: "user_1" });

    // Then: the archived-only view is restored
    expect(await screen.findByText("Shelved")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("should not restore another user's remembered filters", async () => {
    // Given:
    sessionStorage.setItem("overview-filters", JSON.stringify({ user: "someone_else", filters: "status=archive" }));
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Running", status: "Live" })] })
    );

    // When:
    renderOverview("/", { user_id: "user_1" });

    // Then: the default (All, Archive hidden) view opens
    expect(await screen.findByText("Running")).toBeInTheDocument();
  });

  it("should explain an empty list from the asserted scope (US-111)", async () => {
    // Given: a Client Services user whose campaign ownership is not resolved yet
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [], scope: aPacingScopeV1({ kind: "campaigns", ids: [] }) })
    );

    // When:
    renderOverview();

    // Then:
    expect(await screen.findByText("Campaign ownership isn't resolved yet")).toBeInTheDocument();
  });

  it("should offer to clear the filters when they match nothing", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Only", status: "Live" })] })
    );
    renderOverview();
    await screen.findByText("Only");

    // When: a search that matches nothing
    await userEvent.type(screen.getByRole("searchbox", { name: "Search pacings" }), "zzz-no-match");
    await screen.findByText("No pacings match your filters");

    // Then: clearing restores the list
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Only")).toBeInTheDocument();
  });

  it("should sort rows within each group when a column header is clicked", async () => {
    // Given: one owner, two pacings whose status order and budget order disagree
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ name: "Small Live", status: "Live", budgetTotal: 100, ownerName: "A" }),
          aPacingRowV1({ name: "Big Paused", status: "Paused", budgetTotal: 900, ownerName: "A" }),
        ],
      })
    );
    renderOverview();
    await screen.findByText("Small Live");

    // Then: default order is status priority (Live first)
    const namesBefore = screen.getAllByText(/Small Live|Big Paused/).map((el) => el.textContent);
    expect(namesBefore).toEqual(["Small Live", "Big Paused"]);

    // When: sorting by budget descending (two clicks)
    await userEvent.click(screen.getByRole("button", { name: "Budget" }));
    await userEvent.click(screen.getByRole("button", { name: "Budget" }));

    // Then:
    const namesAfter = screen.getAllByText(/Small Live|Big Paused/).map((el) => el.textContent);
    expect(namesAfter).toEqual(["Big Paused", "Small Live"]);
    expect(screen.getByTestId("location-search")).toHaveTextContent("sort=BUDGET%3ADESC");
  });

  it("should offer a non-admin only Refresh and Transfer owner in the row menu", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Nike", status: "Live" })] })
    );
    renderOverview("/", { roles: [] });
    await screen.findByText("Nike");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for Nike" }));

    // Then: refresh + transfer, and neither admin action - hidden, not disabled, since a non-admin
    // can never reach them
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Refresh data" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Transfer owner" })).toBeInTheDocument();
    expect(screen.queryByText("Revalidate from NS")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("should additionally offer an admin Revalidate and Delete", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Nike", status: "Live" })] })
    );
    renderOverview("/", { roles: ["ADMIN"] });
    await screen.findByText("Nike");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for Nike" }));

    // Then:
    expect(screen.getByRole("menuitem", { name: "Refresh data" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Revalidate from NS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer owner" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  // ── §13's NetSuite diff, and §12's delegations: both moved here when /pacing was retired, which
  //    was the only screen either could be reached from.
  it("should show a pacing's NetSuite drift in its own column, and offer the diff to a non-admin", async () => {
    // Given: one pacing checked and drifting, one checked and clean, one never checked
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            id: "p1",
            name: "Drifting",
            // Off the factory default of 3, so the drift count below is unambiguous on screen.
            lineItemCount: 9,
            nsDiffSummary: {
              inSync: false,
              computedAt: "2026-09-29T02:00:00Z",
              counts: {
                missingInNetsuite: 0,
                missingInPacing: 2,
                fieldDiff: 1,
                planDiff: 0,
                foreignCampaign: 0,
                ownerDiff: 0,
              },
            },
          }),
          aPacingRowV1({ id: "p2", name: "Clean", lineItemCount: 8, nsDiffSummary: { inSync: true, computedAt: "2026-09-29T02:00:00Z", counts: { missingInNetsuite: 0, missingInPacing: 0, fieldDiff: 0, planDiff: 0, foreignCampaign: 0, ownerDiff: 0 } } }),
          aPacingRowV1({ id: "p3", name: "Unchecked", lineItemCount: 7 }),
        ],
      })
    );

    // When: a plain user opens the page
    const { container } = renderOverview("/", { roles: [] });
    await screen.findByText("Drifting");

    // Then: the count is on the row, the clean one says so, and the never-checked one is a dash
    // rather than a zero it has not earned
    // Scoped to the badge: 3 is also a line-item count somewhere on this page, and the assertion is
    // about the drift count specifically.
    expect(container.querySelector(".ns-diff__badge")).toHaveTextContent("3");
    expect(screen.getByText("In sync")).toBeInTheDocument();
    expect(screen.getByTitle("Not yet checked against NetSuite")).toBeInTheDocument();

    // And: the sheet is reachable from the row menu without being an admin - looking at a drift
    // writes nothing back, unlike Revalidate
    await userEvent.click(screen.getByRole("button", { name: "Actions for Drifting" }));
    expect(screen.getByRole("menuitem", { name: "NetSuite diff" })).toBeInTheDocument();
  });

  it("should open the delegations panel from the header", async () => {
    // Given: a user with no create permission - granting your own access is not creating a pacing,
    // so the button is not gated on it
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Nike" })], scope: aPacingScopeV1({ can_create: false }) })
    );
    renderOverview("/", { roles: [] });
    await screen.findByText("Nike");

    // Then: offered even though Create pacing is not
    const button = screen.getByRole("button", { name: "Delegations" });
    expect(screen.queryByRole("button", { name: "Create pacing" })).not.toBeInTheDocument();

    // When:
    await userEvent.click(button);

    // Then: the panel opens in place, no navigation
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("should hide Revalidate on an archived pacing even for an admin", async () => {
    // Given: nothing to re-seed on an archived pacing
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Old", status: "Archive" })] })
    );
    renderOverview("/?status=archive", { roles: ["ADMIN"] });
    await screen.findByText("Old");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for Old" }));

    // Then:
    expect(screen.queryByText("Revalidate from NS")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("should disable Refresh with a reason on a row that is not Live", async () => {
    // Given: Pacing answers 400 pacing_not_live for anything else, so the item must be disabled -
    // not hidden - with the reason said where the user is looking
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Held", status: "Paused" })] })
    );
    renderOverview("/?status=paused");
    await screen.findByText("Held");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for Held" }));

    // Then:
    expect(screen.getByRole("menuitem", { name: "Refresh data" })).toBeDisabled();
    expect(screen.getByText("Only a Live pacing can be refreshed.")).toBeInTheDocument();
    expect(triggerPacingRefresh).not.toHaveBeenCalled();
  });

  it("should put a cooldown answer's countdown into the Refresh label", async () => {
    // Given: a refresh refused inside Pacing's two-minute window comes back as seconds, not an error
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ name: "Nike", status: "Live" })] })
    );
    vi.mocked(triggerPacingRefresh).mockResolvedValue({ status: "cooldown", retryAfterSeconds: 42 });
    renderOverview();
    await screen.findByText("Nike");

    // When: refreshing, then reopening the menu
    await userEvent.click(screen.getByRole("button", { name: "Actions for Nike" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Refresh data" }));
    await userEvent.click(screen.getByRole("button", { name: "Actions for Nike" }));

    // Then: the item is off for the remaining window and says for how long
    const item = await screen.findByRole("menuitem", { name: /Refresh data \(4[12]s\)/ });
    expect(item).toBeDisabled();
  });

  it("should not toggle the row's expansion when the kebab is clicked", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [aPacingRowV1({ name: "Nike", status: "Live", lineItems: [aPacingLineItemHealthV1({ lineItemId: "599888" })] })],
      })
    );
    renderOverview();
    await screen.findByText("Nike");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for Nike" }));

    // Then: the menu is open and the row stayed collapsed
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByText("599888")).not.toBeInTheDocument();
  });

  it("shows the Create pacing button only when the resolved scope carries can_create, and it opens the modal in place", async () => {
    // Given: §8's second entry point - creating without first navigating into a campaign.
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ scope: aPacingScopeV1({ can_create: true }), pacings: [aPacingRowV1()] })
    );
    renderOverview();

    // When:
    const button = await screen.findByRole("button", { name: "Create pacing" });
    await userEvent.click(button);

    // Then: the Create Pacing modal opens right here - no navigation, no URL change.
    expect(await screen.findByRole("dialog", { name: "Create Pacing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Insertion order number")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    // When: closing it (step 1 holds no work, so it closes without a confirm).
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    // Then:
    expect(screen.queryByRole("dialog", { name: "Create Pacing" })).not.toBeInTheDocument();
  });

  it("draws no Create pacing button for a scope without can_create", async () => {
    // Given: the same gate the campaign tab's button reads - no door for a user who may not create.
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ scope: aPacingScopeV1({ can_create: false }), pacings: [aPacingRowV1()] })
    );
    renderOverview();
    await screen.findByText("Pacings");

    // Then:
    expect(screen.queryByRole("button", { name: "Create pacing" })).not.toBeInTheDocument();
  });
});
