import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aCampaignPageV1,
  aCampaignV1,
  anAgencyPageV1,
  anAgencyV1,
  anInsertionOrderLineItemV1,
  anInsertionOrderV1,
} from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { searchAgencies } from "../agencies/api";
import { AGENCY_LIST_PAGE_SIZE, AGENCY_SEARCH_PAGE_SIZE } from "../agencies/hooks";
import { listCampaignInsertionOrders, searchCampaigns } from "../campaigns/api";
import { OVERVIEW_PAGE_SIZE } from "../pacing/mock/hooks";
import { Overview } from "./overview";

vi.mock("../campaigns/api", () => ({
  searchCampaigns: vi.fn(),
  listCampaignInsertionOrders: vi.fn(),
}));

vi.mock("../agencies/api", () => ({
  searchAgencies: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

let intersectionCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds = [];
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

/** Renders the current query string, so a test can assert what the page put in the address. */
function LocationProbe() {
  return <div data-testid="location-search">{useLocation().search}</div>;
}

function renderOverview(url = "/", userId = "user_1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seeded rather than fetched: the app shell holds Overview back until the profile is cached, and the
  // remembered filters are scoped to whoever it names.
  queryClient.setQueryData(["auth", "me"], { user_id: userId, email: "one@aidigital.com" });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}


/** One agency with two clients, each with one real campaign. */
function stubOneAgencyTwoCampaigns(overrides: { firstStatus?: string; secondStatus?: string } = {}) {
  vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
    content: [
      aCampaignV1({
        id: 100,
        name: "Summer Getaways",
        agency_name: "Northstar Media",
        client_name: "Acme Corp",
        status: overrides.firstStatus ?? "Live",
        budget: 50_000,
        start_date: "2026-06-01",
        end_date: "2026-08-31",
      }),
      aCampaignV1({
        id: 200,
        name: "Winter Push",
        agency_name: "Northstar Media",
        client_name: "Globex",
        status: overrides.secondStatus ?? "Paused",
        budget: 30_000,
        start_date: "2026-01-01",
        end_date: "2026-02-28",
      }),
    ],
    totalElements: 2,
  }));
  vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
    content: [anAgencyV1({ id: 1, name: "Northstar Media" })],
  }));
}

describe("Overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallback = null;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    // The page remembers its filters across visits on purpose, and jsdom keeps one store for the whole
    // file - so without this, one test's filter is the next test's starting state.
    sessionStorage.clear();
  });

  it("should show a loading indicator while the accessible campaigns are being aggregated", async () => {
    // Given: the underlying requests never resolve within this test
    vi.mocked(searchCampaigns).mockReturnValue(new Promise(() => {}));
    vi.mocked(searchAgencies).mockReturnValue(new Promise(() => {}));

    // When:
    renderOverview();

    // Then:
    expect(screen.getByRole("status", { name: "Loading overview" })).toBeInTheDocument();
  });

  it("should show a human-readable error when the accessible campaigns fail to load", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockRejectedValue(new Error("Something went wrong. Please try again."));
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({ content: [] }));

    // When:
    renderOverview();

    // Then:
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("should render every real accessible campaign with its real agency/client names", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview();

    // Then:
    expect(await screen.findByText("Summer Getaways")).toBeInTheDocument();
    expect(screen.getByText("Winter Push")).toBeInTheDocument();
    expect(screen.getByText("Northstar Media · Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Northstar Media · Globex")).toBeInTheDocument();
  });

  it("should request only page one, with no filters, on initial render", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview();
    await screen.findByText("Summer Getaways");

    // Then: exactly one request, for page one, with an empty filter set
    expect(searchCampaigns).toHaveBeenCalledTimes(1);
    expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, { filters: [] });
  });

  it("should show the summary strip", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview();
    await screen.findByText("Summer Getaways");

    // Then: labels/values are scoped to the summary strip, since column headers on the campaign
    // table below coincidentally repeat the same words ("Budget")
    const summary = document.querySelector(".overview__summary") as HTMLElement;
    expect(within(summary).getByText("Campaigns")).toBeInTheDocument();
    const campaignsStat = within(summary).getByText("Campaigns").closest(".overview__stat") as HTMLElement;
    expect(within(campaignsStat).getByText("2")).toBeInTheDocument();
    expect(within(summary).getByText("Line items")).toBeInTheDocument();
    expect(within(summary).getByText("Budget")).toBeInTheDocument();
  });

  it("should filter campaigns by status segment on the server, not just the loaded page", async () => {
    // Given:
    stubOneAgencyTwoCampaigns({ firstStatus: "Live", secondStatus: "Paused" });
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 200, name: "Winter Push", agency_name: "Northstar Media", client_name: "Globex", status: "Paused" })],
      totalElements: 1,
    }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Paused" }));

    // Then: a fresh page-one request carries the exact real status (EQUALS, not a CONTAINS on the
    // segment's own lowercase label - that would never match the real "Paused"/"Finished" values)
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [{ field: "STATUS", value: "Paused", operation: "EQUALS", caseSensitive: false }],
    }));
    expect(await screen.findByText("Winter Push")).toBeInTheDocument();
    expect(screen.queryByText("Summer Getaways")).not.toBeInTheDocument();
  });

  it("should show a table overlay while a status change reloads the campaign table", async () => {
    // Given: the initial table is rendered, and the next status-filtered request stays in flight
    stubOneAgencyTwoCampaigns({ firstStatus: "Live", secondStatus: "Paused" });
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();
    const reload = deferred<Awaited<ReturnType<typeof searchCampaigns>>>();
    vi.mocked(searchCampaigns).mockReturnValueOnce(reload.promise);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Paused" }));

    // Then: keepPreviousData leaves the previous rows visible, but the table clearly says it is updating
    expect(screen.getByText("Summer Getaways")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Updating campaigns" })).toBeInTheDocument();

    // And it goes away once the replacement page arrives
    await act(async () => {
      reload.resolve(aCampaignPageV1({
        content: [
          aCampaignV1({
            id: 200,
            name: "Winter Push",
            agency_name: "Northstar Media",
            client_name: "Globex",
            status: "Paused",
          }),
        ],
        totalElements: 1,
      }));
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Updating campaigns" })).not.toBeInTheDocument());
  });

  it("should filter campaigns by agency id on the server", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Northstar Media" }), anAgencyV1({ id: 2, name: "Blue Chair" })],
    }));
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 300, name: "Ford Promo", agency_name: "Blue Chair", client_name: "Ourisman Ford" })],
      totalElements: 1,
    }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Blue Chair" }));

    // Then:
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [{ field: "AGENCY_ID", value: "2", operation: "EQUALS", caseSensitive: false }],
    }));
    expect(await screen.findByText("Ford Promo")).toBeInTheDocument();
    expect(screen.queryByText("Summer Getaways")).not.toBeInTheDocument();
  });

  it("should send one AGENCY_ID filter per selected agency, which the backend ORs into an IN", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Northstar Media" }), anAgencyV1({ id: 2, name: "Blue Chair" })],
    }));
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();

    // When: both agencies picked at once
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Northstar Media" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // Then:
    await waitFor(() => expect(searchCampaigns).toHaveBeenLastCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [
        { field: "AGENCY_ID", value: "1", operation: "EQUALS", caseSensitive: false },
        { field: "AGENCY_ID", value: "2", operation: "EQUALS", caseSensitive: false },
      ],
    }));
  });

  it("should restore the unfiltered list from cache when the agency selection is cleared", async () => {
    // Given: one agency selected, which narrowed the list to its own campaign
    stubOneAgencyTwoCampaigns();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 2, name: "Blue Chair" })],
    }));
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 300, name: "Ford Promo", agency_name: "Blue Chair" })],
      totalElements: 1,
    }));
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Blue Chair" }));
    await screen.findByText("Ford Promo");
    vi.mocked(searchCampaigns).mockClear();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear All agencies" }));

    // Then: back to the unfiltered rows, served from the cache the first render already populated
    expect(await screen.findByText("Summer Getaways")).toBeInTheDocument();
    expect(screen.queryByText("Ford Promo")).not.toBeInTheDocument();
    expect(searchCampaigns).not.toHaveBeenCalled();
  });

  it("should restore the filters named in the URL rather than opening unfiltered", async () => {
    // Given: the address a user comes back to when they leave a campaign page (PDI_097)
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview("/?q=summer&status=live&agency=1&sort=START_DATE:DESC");

    // Then: the filters are in the very first request, not applied a render later - the page must not
    // briefly read as unfiltered, and must not spend a request finding that out
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [
        { field: "SEARCH", value: "summer", operation: "CONTAINS", caseSensitive: false },
        { field: "STATUS", value: "Live", operation: "EQUALS", caseSensitive: false },
        { field: "AGENCY_ID", value: "1", operation: "EQUALS", caseSensitive: false },
      ],
      sorting: { field: "START_DATE", direction: "DESC" },
    }));
  });

  it("should ignore a sort column the table does not offer", async () => {
    // Given: a hand-edited or stale address
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview("/?sort=DROP_TABLE:ASC");

    // Then: the default order, not a field passed through to the API because it arrived in a URL
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, { filters: [] }));
  });

  it("should write a chosen filter into the URL", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    renderOverview();
    await screen.findByText("Summer Getaways");

    // When: a status segment is chosen
    await userEvent.click(screen.getByRole("button", { name: "Live" }));

    // Then: the address carries it, which is what makes coming back to it work at all
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("status=live")
    );
  });

  it("should restore the last filters when it is reopened at a bare address", async () => {
    // Given: a filter chosen on a previous visit
    stubOneAgencyTwoCampaigns();
    const first = renderOverview();
    await screen.findByText("Summer Getaways");
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("status=live"));
    first.unmount();
    vi.clearAllMocks();
    stubOneAgencyTwoCampaigns();

    // When: the page is reopened with no filters in the address - what the sidebar's own "Overview" link
    // and the logo both navigate to, and how the filters were being lost even though the URL held them
    renderOverview("/");

    // Then: the filter is back, in the first request and in the address
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [{ field: "STATUS", value: "Live", operation: "EQUALS", caseSensitive: false }],
    }));
    expect(screen.getByTestId("location-search")).toHaveTextContent("status=live");
  });

  it("should let the address override what was remembered", async () => {
    // Given: a remembered status filter
    stubOneAgencyTwoCampaigns();
    const first = renderOverview();
    await screen.findByText("Summer Getaways");
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("status=live"));
    first.unmount();
    vi.clearAllMocks();
    stubOneAgencyTwoCampaigns();

    // When: a link naming a different filter is opened
    renderOverview("/?q=summer");

    // Then: the link wins - it is what someone sent, and what the back button expresses
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [{ field: "SEARCH", value: "summer", operation: "CONTAINS", caseSensitive: false }],
    }));
  });

  it("should not restore filters remembered for a different signed-in user", async () => {
    // Given: one user's filter, and the tab reused by another - sessionStorage outlives a Clerk sign-out,
    // which reloads the page rather than dropping the store
    stubOneAgencyTwoCampaigns();
    const first = renderOverview("/", "user_1");
    await screen.findByText("Summer Getaways");
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("status=live"));
    first.unmount();
    vi.clearAllMocks();
    stubOneAgencyTwoCampaigns();

    // When:
    renderOverview("/", "user_2");

    // Then: unfiltered, rather than campaigns quietly missing for someone who never chose that
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, { filters: [] }));
  });

  it("should not fetch its own copy of the agency list - it shares the sidebar's cached page", async () => {
    // Given: the sidebar's agency list is already cached under its own key
    stubOneAgencyTwoCampaigns();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Northstar Media" })],
    }));

    // When:
    renderOverview();
    await screen.findByText("Summer Getaways");

    // Then: exactly one agency request (the shared list's first page), for that shared page size -
    // never a second, differently-sized directory fetch of its own
    expect(searchAgencies).toHaveBeenCalledExactlyOnceWith(1, AGENCY_LIST_PAGE_SIZE, {
      includeClients: true,
      sorting: { field: "NAME", direction: "ASC" },
    });
  });

  it("should search agencies on the server rather than filtering a preloaded list", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Northstar Media" })],
    }));
    renderOverview();
    await screen.findByText("Summer Getaways");
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    vi.mocked(searchAgencies).mockClear();

    // When:
    await userEvent.type(screen.getByLabelText("Search all agencies"), "blue");

    // Then: the term goes to the backend, so agencies beyond the first page are reachable
    await waitFor(() => expect(searchAgencies).toHaveBeenCalledWith(1, AGENCY_SEARCH_PAGE_SIZE, {
      includeClients: true,
      search: "blue",
      sorting: { field: "NAME", direction: "ASC" },
    }));
  });

  it("should order by a clicked column, and return to the default order on the third click", async () => {
    // Given: the table as it loads, in the server's own flight-phase order
    stubOneAgencyTwoCampaigns();
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();

    // When: the Flight column is clicked
    await userEvent.click(screen.getByRole("button", { name: /Flight/ }));

    // Then: the order is asked of the server, not applied to the page in hand - the table is paged, and
    // sorting one loaded page would order a slice rather than the campaign list
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [],
      sorting: { field: "START_DATE", direction: "ASC" },
    }));

    // When: clicked again
    await userEvent.click(screen.getByRole("button", { name: /Flight/ }));

    // Then:
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [],
      sorting: { field: "START_DATE", direction: "DESC" },
    }));

    // When: a third time
    vi.mocked(searchCampaigns).mockClear();
    await userEvent.click(screen.getByRole("button", { name: /Flight/ }));

    // Then: the column reports no direction - the request body is back to carrying no sorting field, which
    // is how the default order returns (live, then upcoming, then finished). Without a third state that
    // order would be unreachable short of a page reload.
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: /Flight/ })).toHaveAttribute("aria-sort", "none")
    );
    // And no request went out for it: that body is the one the page opened with, so the answer was already
    // in hand. Re-fetching what is cached to show what was already shown would be the bug.
    expect(searchCampaigns).not.toHaveBeenCalled();
  });

  it("should filter campaigns by a search term on the server", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockClear();
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 100, name: "Summer Getaways", agency_name: "Northstar Media", client_name: "Acme Corp" })],
      totalElements: 1,
    }));

    // When:
    await userEvent.type(screen.getByLabelText("Search campaigns"), "summer");

    // Then: SEARCH, not NAME - the term is matched against the campaign, client and agency name
    // together, because that is what people type into a single box (PDI_085)
    await waitFor(() => expect(searchCampaigns).toHaveBeenCalledWith(1, OVERVIEW_PAGE_SIZE, {
      filters: [{ field: "SEARCH", value: "summer", operation: "CONTAINS", caseSensitive: false }],
    }));
    await waitFor(() => expect(screen.queryByText("Winter Push")).not.toBeInTheDocument());
    expect(screen.getByText("Summer Getaways")).toBeInTheDocument();
  });

  it("should show an empty state when the filters match nothing", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    renderOverview();
    await screen.findByText("Summer Getaways");
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({ content: [], totalElements: 0, totalPages: 0 }));

    // When:
    await userEvent.type(screen.getByLabelText("Search campaigns"), "zzz-no-match");

    // Then:
    expect(await screen.findByText("No campaigns match the current filters.")).toBeInTheDocument();
  });

  it("should show a scroll sentinel while more campaign pages remain", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({ pageNumber: 1, totalPages: 2 }));
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1());

    // When:
    renderOverview();

    // Then:
    await waitFor(() => expect(document.querySelector(".overview__load-more")).toBeInTheDocument());
  });

  it("should load page two and merge it into the campaign list when the scroll sentinel intersects", async () => {
    // Given:
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1());
    vi.mocked(searchCampaigns).mockImplementation((pageNumber) =>
      Promise.resolve(pageNumber === 1
        ? aCampaignPageV1({ pageNumber: 1, totalPages: 2, totalElements: 2, content: [aCampaignV1({ id: 100, name: "Summer Getaways" })] })
        : aCampaignPageV1({ pageNumber: 2, totalPages: 2, totalElements: 2, content: [aCampaignV1({ id: 200, name: "Winter Push" })] })
      )
    );
    renderOverview();
    await screen.findByText("Summer Getaways");

    // When: the IntersectionObserver reports the sentinel is now visible
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    // Then: both pages' campaigns render together
    expect(await screen.findByText("Winter Push")).toBeInTheDocument();
    expect(screen.getByText("Summer Getaways")).toBeInTheDocument();
    expect(searchCampaigns).toHaveBeenCalledTimes(2);
    expect(searchCampaigns).toHaveBeenNthCalledWith(2, 2, OVERVIEW_PAGE_SIZE, { filters: [] });
  });

  it("should keep the Campaigns stat at the server's full-dataset count, not just what's loaded", async () => {
    // Given: 2 total campaigns server-side, but only 1 has loaded so far
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1());
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      pageNumber: 1, totalPages: 2, totalElements: 2, content: [aCampaignV1({ name: "Summer Getaways" })],
    }));

    // When:
    renderOverview();
    await screen.findByText("Summer Getaways");

    // Then:
    const summary = document.querySelector(".overview__summary") as HTMLElement;
    const campaignsStat = within(summary).getByText("Campaigns").closest(".overview__stat") as HTMLElement;
    expect(within(campaignsStat).getByText("2")).toBeInTheDocument();
  });

  it("should expand a campaign row to show its real line items, and collapse it again", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    vi.mocked(listCampaignInsertionOrders).mockResolvedValue([
      anInsertionOrderV1({
        order_id: 276198,
        line_items: [
          anInsertionOrderLineItemV1({
            line_item_id: 1001,
            media_tactic: "CTV/OTT",
            rate_type: "Flat",
            budget: 15000,
            start_date: "2026-06-17",
            end_date: "2026-09-17",
          }),
        ],
      }),
    ]);
    renderOverview();
    const row = (await screen.findByText("Summer Getaways")).closest("tr") as HTMLElement;

    // When: the row's own expand chevron is clicked (not the row itself, which navigates)
    await userEvent.click(within(row).getByRole("button", { name: /Expand Summer Getaways/ }));

    // Then: the real line item renders - real id, real budget, no mocked pacing/CTR-VCR-ACR numbers
    expect(await screen.findByText("LI 1001")).toBeInTheDocument();
    expect(screen.getByText(/CTV\/OTT · Flat · Jun 17, 2026 – Sep 17, 2026/)).toBeInTheDocument();
    expect(screen.getByText("$15.0K")).toBeInTheDocument();
    expect(listCampaignInsertionOrders).toHaveBeenCalledWith(100);
    expect(mockNavigate).not.toHaveBeenCalled();

    // When: collapsed again
    await userEvent.click(within(row).getByRole("button", { name: /Collapse Summer Getaways/ }));

    // Then:
    expect(screen.queryByText("LI 1001")).not.toBeInTheDocument();
  });

  it("should navigate to the campaign when its row is clicked", async () => {
    // Given:
    stubOneAgencyTwoCampaigns();
    renderOverview();
    await screen.findByText("Summer Getaways");

    // When:
    await userEvent.click(screen.getByText("Summer Getaways"));

    // Then:
    expect(mockNavigate).toHaveBeenCalledWith("/campaigns/100", expect.objectContaining({
      state: expect.objectContaining({ agencyName: "Northstar Media", clientName: "Acme Corp" }),
    }));
  });
});
