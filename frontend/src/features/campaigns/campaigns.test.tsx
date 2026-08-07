import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aCampaignPageV1, aCampaignV1, anInsertionOrderLineItemV1, anInsertionOrderV1 } from "@/test/factories";
import { listCampaignInsertionOrders, searchCampaigns } from "./api";
import { Campaigns } from "./campaigns";

vi.mock("./api", () => ({
  searchCampaigns: vi.fn(),
  listCampaignInsertionOrders: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function clientSearch(clientName: string): string {
  return `?clientName=${encodeURIComponent(clientName)}`;
}

function renderCampaigns(
  clientId: number,
  queryClient: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  clientName = `Client ${clientId}`,
  includeClientSearch = true
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{
          pathname: `/agencies/7/clients/${clientId}`,
          search: includeClientSearch ? clientSearch(clientName) : "",
          state: { clientName, agencyId: 7, agencyName: "Agency" },
        }]}
      >
        <Routes>
          <Route path="/agencies/:agencyId/clients/:clientId" element={<Campaigns />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderSwitchableCampaigns(queryClient: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  function Shell({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    return (
      <>
        <button
          type="button"
          onClick={() => navigate("/agencies/7/clients/99?clientName=Client%2099", { state: { clientName: "Client 99", agencyId: 7, agencyName: "Agency" } })}
        >
          Switch client
        </button>
        {children}
      </>
    );
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{
          pathname: "/agencies/7/clients/42",
          search: "?clientName=Client%2042",
          state: { clientName: "Client 42", agencyId: 7, agencyName: "Agency" },
        }]}
      >
        <Routes>
          <Route path="/agencies/:agencyId/clients/:clientId" element={<Shell><Campaigns /></Shell>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Mimics the topbar's `q` param write, so a test can change the URL-driven search mid-lifecycle.
function SearchControl({ query }: { query: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <button
      type="button"
      onClick={() => {
        const next = new URLSearchParams(searchParams);
        next.set("q", query);
        setSearchParams(next);
      }}
    >
      Change search
    </button>
  );
}

function renderCampaignsWithSearchControl(clientId: number, query: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{
          pathname: `/agencies/7/clients/${clientId}`,
          search: clientSearch(`Client ${clientId}`),
          state: { clientName: `Client ${clientId}`, agencyId: 7, agencyName: "Agency" },
        }]}
      >
        <Routes>
          <Route
            path="/agencies/:agencyId/clients/:clientId"
            element={
              <>
                <SearchControl query={query} />
                <Campaigns />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderCampaignsWithDestinationRoute(clientId: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{
          pathname: `/agencies/7/clients/${clientId}`,
          search: clientSearch(`Client ${clientId}`),
          state: { clientName: `Client ${clientId}`, agencyId: 7, agencyName: "Agency" },
        }]}
      >
        <Routes>
          <Route path="/agencies/:agencyId/clients/:clientId" element={<Campaigns />} />
          <Route path="/campaigns/:campaignId" element={<div>Campaign detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show a spinner while the first campaign page loads", async () => {
    // Given: the campaigns request has not resolved yet
    const pending = deferred<ReturnType<typeof aCampaignPageV1>>();
    vi.mocked(searchCampaigns).mockReturnValue(pending.promise);

    // When: the campaign overview renders
    renderCampaigns(42);

    // Then: the visible loading text is replaced by a spinner status
    expect(screen.getByRole("status", { name: "Loading campaigns" })).toBeInTheDocument();
    expect(screen.queryByText(/Loading campaigns/i)).not.toBeInTheDocument();

    pending.resolve(aCampaignPageV1({ content: [] }));
  });

  it("should show an updating spinner when switching clients with previous campaign data kept", async () => {
    // Given: one client page is visible and the next client request is still in flight
    const pending = deferred<ReturnType<typeof aCampaignPageV1>>();
    vi.mocked(searchCampaigns)
      .mockResolvedValueOnce(aCampaignPageV1({
        content: [aCampaignV1({ id: 1, name: "Old Client Campaign", client_id: 42 })],
        totalElements: 1,
        totalPages: 1,
      }))
      .mockReturnValueOnce(pending.promise);

    renderSwitchableCampaigns();
    expect(await screen.findByText("Old Client Campaign")).toBeInTheDocument();

    // When: the user switches to another client
    await userEvent.click(screen.getByText("Switch client"));

    // Then: stale campaigns stay visible and an updating spinner appears
    expect(screen.getByText("Old Client Campaign")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Updating campaigns" })).toBeInTheDocument();

    pending.resolve(aCampaignPageV1({
      content: [aCampaignV1({ id: 2, name: "New Client Campaign", client_id: 99 })],
      totalElements: 1,
      totalPages: 1,
    }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Updating campaigns" })).not.toBeInTheDocument());
    expect(await screen.findByText("New Client Campaign")).toBeInTheDocument();
  });

  it("should issue exactly one request, for page 1, when the search changes while on a later page", async () => {
    // Given: two pages of campaigns, so pagination is available
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 1, name: "Campaign One", client_id: 42 })],
      totalElements: 20,
      totalPages: 2,
    }));

    renderCampaignsWithSearchControl(42, "acme");
    await screen.findByText("Campaign One");
    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(searchCampaigns).toHaveBeenLastCalledWith(2, 16, expect.anything()));
    vi.mocked(searchCampaigns).mockClear();

    // When: the (URL-driven) search changes while page 2 is showing
    await userEvent.click(screen.getByRole("button", { name: "Change search" }));

    // Then: exactly one request fires, for page 1 with the new filter — never a wasted
    // (page 2, new search) request
    await waitFor(() => {
      expect(searchCampaigns).toHaveBeenCalledWith(1, 16, {
        filters: [
          { field: "CLIENT_ID", value: "42", operation: "EQUALS", caseSensitive: false },
          { field: "AGENCY_ID", value: "7", operation: "EQUALS", caseSensitive: false },
          { field: "CLIENT_NAME", value: "Client 42", operation: "EQUALS", caseSensitive: false },
          { field: "NAME", value: "acme", operation: "CONTAINS", caseSensitive: false },
        ],
        sorting: { field: "NAME", direction: "ASC" },
      });
    });
    expect(searchCampaigns).toHaveBeenCalledTimes(1);
  });

  it("should show the line-item and budget rollup in the subtitle", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [
        aCampaignV1({ id: 1, name: "Campaign One", client_id: 42, budget: 10_000 }),
        aCampaignV1({ id: 2, name: "Campaign Two", client_id: 42, budget: 20_000 }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));

    // When:
    renderCampaigns(42);
    await screen.findByText("Campaign One");

    // Then: N campaigns is real/exact; line items/budget are rolled up from the mock pacing overlay
    expect(screen.getByText(/^2 campaigns · \d+ line items? · \$/)).toBeInTheDocument();
  });

  it("should prefer the API client name over a stale client placeholder from route state", async () => {
    // Given: navigation state was seeded before the campaign API could resolve the mart client name.
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 42452, name: "TCL Mobile/Tablets 2026", client_id: 42, client_name: "TCL" })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    renderCampaigns(42, undefined, "Client without name", false);

    // Then:
    expect(await screen.findByRole("heading", { name: "TCL" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Client without name" })).not.toBeInTheDocument();
  });

  it("should keep the fallback client bucket as an explicit API scope", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 42452, name: "Unmatched Campaign", client_id: 0, client_name: null })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    renderCampaigns(0, undefined, "Client without name");
    await screen.findByText("Unmatched Campaign");

    // Then:
    expect(searchCampaigns).toHaveBeenCalledWith(1, 16, {
      filters: [
        { field: "CLIENT_ID", value: "0", operation: "EQUALS", caseSensitive: false },
        { field: "AGENCY_ID", value: "7", operation: "EQUALS", caseSensitive: false },
        { field: "CLIENT_NAME", value: "Client without name", operation: "EQUALS", caseSensitive: false },
      ],
      sorting: { field: "NAME", direction: "ASC" },
    });
  });

  it("should default a legacy client-id-zero route to the fallback bucket", async () => {
    // Given: /clients/0 without a clientName query is ambiguous and used to fetch the whole placeholder bucket.
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 30728, name: "Fallback Campaign", client_id: 0, client_name: null })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    renderCampaigns(0, undefined, "", false);
    await screen.findByText("Fallback Campaign");

    // Then:
    expect(searchCampaigns).toHaveBeenCalledWith(1, 16, {
      filters: [
        { field: "CLIENT_ID", value: "0", operation: "EQUALS", caseSensitive: false },
        { field: "AGENCY_ID", value: "7", operation: "EQUALS", caseSensitive: false },
        { field: "CLIENT_NAME", value: "Client without name", operation: "EQUALS", caseSensitive: false },
      ],
      sorting: { field: "NAME", direction: "ASC" },
    });
  });

  it("should filter the visible campaigns by status segment", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [
        aCampaignV1({ id: 1, name: "Live Campaign", client_id: 42, status: "Live" }),
        aCampaignV1({ id: 2, name: "Paused Campaign", client_id: 42, status: "Paused" }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));
    renderCampaigns(42);
    await screen.findByText("Live Campaign");
    expect(screen.getByText("Paused Campaign")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Paused" }));

    // Then:
    expect(screen.getByText("Paused Campaign")).toBeInTheDocument();
    expect(screen.queryByText("Live Campaign")).not.toBeInTheDocument();
  });

  it("should expand a campaign row to show its real line items, and collapse it again", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 1, name: "Campaign One", client_id: 42 })],
      totalElements: 1,
      totalPages: 1,
    }));
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
    renderCampaigns(42);
    const row = (await screen.findByText("Campaign One")).closest("tr") as HTMLElement;

    // When: the row's own expand chevron is clicked (not the row itself, which navigates)
    await userEvent.click(within(row).getByRole("button", { name: /Expand Campaign One/ }));

    // Then: the real line item renders - real id, real budget, no mocked pacing/CTR-VCR-ACR numbers
    expect(await screen.findByText("LI 1001")).toBeInTheDocument();
    expect(screen.getByText(/CTV\/OTT · Flat · Jun 17, 2026 – Sep 17, 2026/)).toBeInTheDocument();
    expect(screen.getByText("$15.0K")).toBeInTheDocument();
    expect(listCampaignInsertionOrders).toHaveBeenCalledWith(1);

    // When: collapsed again
    await userEvent.click(within(row).getByRole("button", { name: /Collapse Campaign One/ }));

    // Then:
    expect(screen.queryByText("LI 1001")).not.toBeInTheDocument();
  });

  it("should navigate to the campaign's page when its row is clicked", async () => {
    // Given:
    vi.mocked(searchCampaigns).mockResolvedValue(aCampaignPageV1({
      content: [aCampaignV1({ id: 55, name: "Campaign One", client_id: 42 })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    renderCampaignsWithDestinationRoute(42);
    await userEvent.click(await screen.findByText("Campaign One"));

    // Then:
    expect(await screen.findByText("Campaign detail page")).toBeInTheDocument();
  });
});
