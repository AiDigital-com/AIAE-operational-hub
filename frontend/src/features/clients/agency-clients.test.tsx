import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aClientPageV1, aClientV1 } from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { searchClients } from "./api";
import { AgencyClients } from "./agency-clients";

vi.mock("./api", () => ({
  searchClients: vi.fn(),
}));

function renderAgencyClients(
  agencyId: number = 42,
  agencyName?: string,
  seed?: (queryClient: QueryClient) => void,
  search?: string
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter
          initialEntries={[{
            pathname: `/agencies/${agencyId}`,
            search: search ? `?q=${search}` : undefined,
            state: agencyName ? { agencyName } : undefined,
          }]}
        >
          <Routes>
            <Route path="/agencies/:agencyId" element={<AgencyClients />} />
            <Route path="/agencies/:agencyId/clients/:clientId" element={<div>Campaigns page</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

// Mimics the topbar's `q` param write, so a test can change the URL-driven search mid-lifecycle.
function SearchControl({ query }: { query: string }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ q: query })}>
      Change search
    </button>
  );
}

function renderAgencyClientsWithSearchControl(agencyId: number, query: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/agencies/${agencyId}`]}>
          <Routes>
            <Route
              path="/agencies/:agencyId"
              element={
                <>
                  <SearchControl query={query} />
                  <AgencyClients />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("AgencyClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load and render clients belonging to the agency", async () => {
    // Given: the clients endpoint returns clients for the agency
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({
      content: [
        aClientV1({ id: 1, name: "Acme Corp", agency_id: 42 }),
        aClientV1({ id: 2, name: "Globex Ltd", agency_id: 42 }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));

    // When: the agency clients page renders for agency 42
    renderAgencyClients(42, "Northstar Media");

    // Then: both client names are visible
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Globex Ltd")).toBeInTheDocument();

    // Execution: verify the correct agency filter was applied
    expect(searchClients).toHaveBeenCalledWith(
      1,
      16,
      expect.objectContaining({
        filters: [{ field: "AGENCY_ID", value: "42", operation: "EQUALS", caseSensitive: false }],
      })
    );
  });

  it("should display the agency name from router state as the page title", async () => {
    // Given: the clients endpoint returns some clients
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({
      content: [aClientV1({ name: "Test Client" })],
    }));

    // When: the page renders with agency name in location state
    renderAgencyClients(99, "Northstar Media");

    // Verification: the agency name appears as the heading
    expect(await screen.findByRole("heading", { name: "Northstar Media" })).toBeInTheDocument();
  });

  it("should show the empty state when the agency has no clients", async () => {
    // Given: the agency has no clients
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({ content: [], totalElements: 0, totalPages: 0 }));

    // When: the page renders
    renderAgencyClients(42);

    // Verification: empty state message is shown
    expect(await screen.findByText("No clients found for this agency.")).toBeInTheDocument();
  });

  it("should add a NAME filter alongside the agency filter when searching", async () => {
    // Given: a search term is present in the URL
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({
      content: [aClientV1({ id: 1, name: "Acme Corp" })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When: the agency page renders at /agencies/42?q=acme
    renderAgencyClients(42, "NCM", undefined, "acme");

    // Then: clients are filtered by both the agency and the NAME search term
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(searchClients).toHaveBeenCalledWith(
      1,
      16,
      expect.objectContaining({
        filters: [
          { field: "AGENCY_ID", value: "42", operation: "EQUALS", caseSensitive: false },
          { field: "NAME", value: "acme", operation: "CONTAINS", caseSensitive: false },
        ],
      })
    );
  });

  it("should reuse clients seeded by the sidebar without issuing its own request", async () => {
    // Given: the sidebar has already seeded this agency's first page into the query cache
    renderAgencyClients(42, "Northstar Media", (queryClient) => {
      queryClient.setQueryData(["clients", "agency", 42, 1], aClientPageV1({
        content: [aClientV1({ id: 1, name: "Seeded Client" })],
        totalElements: 1,
        totalPages: 1,
      }));
    });

    // Then: the seeded client renders and no clients request is made
    expect(await screen.findByText("Seeded Client")).toBeInTheDocument();
    expect(searchClients).not.toHaveBeenCalled();
  });

  it("should navigate to the agency-scoped client campaigns route", async () => {
    // Given:
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({
      content: [aClientV1({ id: 0, name: "Sunland Park", agency_id: 42 })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    renderAgencyClients(42, "TCL");
    await userEvent.click(await screen.findByRole("button", { name: /Sunland Park/ }));

    // Then:
    expect(await screen.findByText("Campaigns page")).toBeInTheDocument();
  });

  it("should issue exactly one request, for page 1, when the search changes while on a later page", async () => {
    // Given: two pages of clients, so pagination is available
    vi.mocked(searchClients).mockResolvedValue(aClientPageV1({
      content: [aClientV1({ id: 1, name: "Client One", agency_id: 42 })],
      totalElements: 20,
      totalPages: 2,
    }));

    renderAgencyClientsWithSearchControl(42, "acme");
    await screen.findByText("Client One");
    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(searchClients).toHaveBeenLastCalledWith(2, 16, expect.anything()));
    vi.mocked(searchClients).mockClear();

    // When: the (URL-driven) search changes while page 2 is showing
    await userEvent.click(screen.getByRole("button", { name: "Change search" }));

    // Then: exactly one request fires, for page 1 with the new filter — never a wasted
    // (page 2, new search) request
    await waitFor(() => {
      expect(searchClients).toHaveBeenCalledWith(
        1,
        16,
        expect.objectContaining({
          filters: [
            { field: "AGENCY_ID", value: "42", operation: "EQUALS", caseSensitive: false },
            { field: "NAME", value: "acme", operation: "CONTAINS", caseSensitive: false },
          ],
        })
      );
    });
    expect(searchClients).toHaveBeenCalledTimes(1);
  });

  it("should show a human-readable error when clients fail to load", async () => {
    // Given: the clients endpoint fails
    vi.mocked(searchClients).mockRejectedValue(new Error("Network error. Please try again."));

    // When: the page renders
    renderAgencyClients(42);

    // Verification: the error message is visible
    expect(await screen.findByText("Network error. Please try again.")).toBeInTheDocument();
  });
});
