import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anAgencyPageV1, anAgencyV1 } from "@/test/factories";
import { searchAgencies } from "./api";
import { searchClients } from "../clients/api";
import { AgencyList } from "./agency-list";

vi.mock("./api", () => ({
  searchAgencies: vi.fn(),
}));

vi.mock("../clients/api", () => ({
  searchClients: vi.fn(),
}));

function renderAgencyList(initialEntry: string = "/agencies") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AgencyList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Mimics the page's own `q` param write, so a test can change the URL-driven search mid-lifecycle.
function SearchControl({ query }: { query: string }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ q: query })}>
      Change search
    </button>
  );
}

function renderAgencyListWithSearchControl(query: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agencies"]}>
        <SearchControl query={query} />
        <AgencyList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AgencyList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load and render agencies from the BigQuery-backed API", async () => {
    // Given: the agencies endpoint returns a page from BigQuery
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({ id: 101, name: "Northstar Media", status: "ACTIVE" }),
        anAgencyV1({ id: 202, name: "Blue Peak", status: "INACTIVE" }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));

    // When: the page renders
    renderAgencyList();

    // Then: it requests the first agency page and displays the returned cards
    expect(await screen.findByText("Northstar Media")).toBeInTheDocument();
    expect(screen.getByText("Blue Peak")).toBeInTheDocument();
    expect(searchAgencies).toHaveBeenCalledWith(1, 16, { sorting: { field: "NAME", direction: "ASC" } });
  });

  it("should show the client count inline from the agency payload without a per-card request", async () => {
    // Given: agencies arrive with their client counts embedded in the page payload
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({ id: 101, name: "Northstar Media", clientsCount: 12 }),
        anAgencyV1({ id: 202, name: "Solo Shop", clientsCount: 1 }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));

    // When: the page renders
    renderAgencyList();

    // Verification: counts render from the agency payload — and clients are never fetched per card
    expect(await screen.findByText("12 clients")).toBeInTheDocument();
    expect(screen.getByText("1 client")).toBeInTheDocument();
    expect(searchClients).not.toHaveBeenCalled();
  });

  it("should apply a server-side NAME filter from the search query param", async () => {
    // Given: the page is opened with a search term in the URL
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Acme Media" })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When: the page renders at /agencies?q=acme
    renderAgencyList("/agencies?q=acme");

    // Then: it requests agencies filtered by NAME CONTAINS the search term
    expect(await screen.findByText("Acme Media")).toBeInTheDocument();
    expect(searchAgencies).toHaveBeenCalledWith(1, 16, {
      filters: [{ field: "NAME", value: "acme", operation: "CONTAINS", caseSensitive: false }],
      sorting: { field: "NAME", direction: "ASC" },
    });
  });

  it("should show a search-aware empty state when nothing matches", async () => {
    // Given: the search matches no agencies
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({ content: [], totalElements: 0, totalPages: 0 }));

    // When: the page renders with a search term
    renderAgencyList("/agencies?q=zzz");

    // Then: the empty state names the search term
    expect(await screen.findByText('No agencies match "zzz".')).toBeInTheDocument();
  });

  it("should show the empty state when no agencies are visible", async () => {
    // Given: the user has no visible agencies
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({ content: [], totalElements: 0, totalPages: 0 }));

    // When: the page renders
    renderAgencyList();

    // Then: a clear empty state is shown
    expect(await screen.findByText("No agencies found.")).toBeInTheDocument();
  });

  it("should issue exactly one request, for page 1, when the search changes while on a later page", async () => {
    // Given: two pages of agencies, so pagination is available
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 1, name: "Agency One" })],
      totalElements: 20,
      totalPages: 2,
    }));

    renderAgencyListWithSearchControl("acme");
    await screen.findByText("Agency One");
    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(searchAgencies).toHaveBeenLastCalledWith(2, 16, expect.anything()));
    vi.mocked(searchAgencies).mockClear();

    // When: the (URL-driven) search changes while page 2 is showing
    await userEvent.click(screen.getByRole("button", { name: "Change search" }));

    // Then: exactly one request fires, for page 1 with the new filter — never a wasted
    // (page 2, new search) request
    await waitFor(() => {
      expect(searchAgencies).toHaveBeenCalledWith(1, 16, {
        filters: [{ field: "NAME", value: "acme", operation: "CONTAINS", caseSensitive: false }],
        sorting: { field: "NAME", direction: "ASC" },
      });
    });
    expect(searchAgencies).toHaveBeenCalledTimes(1);
  });

  it("should show a human-readable error when agencies fail to load", async () => {
    // Given: the agencies endpoint fails
    vi.mocked(searchAgencies).mockRejectedValue(new Error("Something went wrong. Please try again."));

    // When: the page renders
    renderAgencyList();

    // Then: the error is visible instead of profile information
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});
