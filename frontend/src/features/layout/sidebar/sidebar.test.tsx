import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anAgencyClientV1, anAgencyPageV1, anAgencyV1, aUserV1 } from "@/test/factories";
import { ThemeProvider } from "../../../shared/style/theme";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import { searchAgencies } from "../../agencies/api";
import { searchClients } from "../../clients/api";
import { Sidebar } from "./sidebar";

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => null,
}));

vi.mock("../../agencies/api", () => ({
  searchAgencies: vi.fn(),
}));

vi.mock("../../clients/api", () => ({
  searchClients: vi.fn(),
}));

// Testing Library's default text matcher only reads an element's own direct text-node children, not
// text nested inside a child element — so a highlighted name (split across plain text + <mark>) can't
// be matched by a whole-string query on the parent. This matches on the element's full textContent
// instead, regardless of how the highlight split it up.
function fullTextEquals(expected: string, className: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === expected && element.classList.contains(className);
}

function renderSidebar(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <Sidebar isAdmin user={aUserV1({ roles: ["ADMIN"] })} collapsed={false} onToggleCollapsed={() => {}} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should link the brand back to the overview", () => {
    // Given:
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1());

    // When:
    renderSidebar("/teams");

    // Then:
    expect(screen.getByRole("link", { name: "Go to Overview" })).toHaveAttribute("href", "/");
  });

  it("should request agencies with their clients embedded in a single call", async () => {
    // Given: the sidebar agency page returns one agency with a client count
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [anAgencyV1({ id: 42, name: "Northstar Media", clientsCount: 3 })],
      totalElements: 1,
      totalPages: 1,
    }));

    // When: the sidebar renders on the overview route
    renderSidebar("/");

    // Then: the count badge renders, and it requested the first ten agencies alphabetically with clients
    expect(await screen.findByText("Northstar Media")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(searchAgencies).toHaveBeenCalledWith(1, 10, {
      sorting: { field: "NAME", direction: "ASC" },
      includeClients: true,
    });
  });

  it("should fetch only the next page when '… more' is clicked, keeping the agencies already shown", async () => {
    // Given: 25 agencies total; each page returns 10 rows numbered from the requested page
    vi.mocked(searchAgencies).mockImplementation(async (pageNumber, pageSize) =>
      anAgencyPageV1({
        content: Array.from({ length: pageSize }, (_, i) =>
          anAgencyV1({
            id: (pageNumber - 1) * pageSize + i + 1,
            name: `Agency ${(pageNumber - 1) * pageSize + i + 1}`,
          })
        ),
        pageNumber,
        totalElements: 25,
        totalPages: 3,
      })
    );

    renderSidebar("/");
    await screen.findByText("Agency 1");
    // 25 total − 10 shown = 15 more
    await userEvent.click(screen.getByRole("button", { name: /15 more/ }));

    // Then: exactly one additional request is made, for page 2 at the same page size — not a
    // re-request of everything shown so far
    await screen.findByText("Agency 11");
    expect(screen.getByText("Agency 1")).toBeInTheDocument();
    expect(searchAgencies).toHaveBeenCalledTimes(2);
    expect(searchAgencies).toHaveBeenLastCalledWith(2, 10, {
      sorting: { field: "NAME", direction: "ASC" },
      includeClients: true,
    });
  });

  it("should collapse the list back to the initial ten when 'Hide' is clicked, without a further request", async () => {
    // Given: 25 agencies total; the second page has already been loaded
    vi.mocked(searchAgencies).mockImplementation(async (pageNumber, pageSize) =>
      anAgencyPageV1({
        content: Array.from({ length: pageSize }, (_, i) =>
          anAgencyV1({
            id: (pageNumber - 1) * pageSize + i + 1,
            name: `Agency ${(pageNumber - 1) * pageSize + i + 1}`,
          })
        ),
        pageNumber,
        totalElements: 25,
        totalPages: 3,
      })
    );
    renderSidebar("/");
    await screen.findByText("Agency 1");
    await userEvent.click(screen.getByRole("button", { name: /15 more/ }));
    await screen.findByText("Agency 11");

    // When: "Hide" is clicked
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    // Then: the list rolls back to the first ten, and no further request was made
    expect(screen.queryByText("Agency 11")).not.toBeInTheDocument();
    expect(screen.getByText("Agency 1")).toBeInTheDocument();
    expect(searchAgencies).toHaveBeenCalledTimes(2);
  });

  it("should render the expanded agency's embedded clients without a follow-up clients request", async () => {
    // Given: the selected agency carries its clients inline (one with a blank name)
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({
          id: 42,
          name: "Northstar Media",
          clientsCount: 2,
          clients: [
            anAgencyClientV1({ id: 1, name: "Acme Corp" }),
            anAgencyClientV1({ id: 2, name: "" }),
          ],
        }),
      ],
      totalElements: 1,
      totalPages: 1,
    }));

    // When: the sidebar renders on that agency's route (so it is expanded)
    renderSidebar("/agencies/42");

    // Then: the embedded clients render, blank names fall back, and no clients request is made
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Client without name")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme Corp/ }))
      .toHaveAttribute("href", "/agencies/42/clients/1?clientName=Acme%20Corp");
    expect(screen.getByRole("link", { name: /Client without name/ }))
      .toHaveAttribute("href", "/agencies/42/clients/2?clientName=Client%20without%20name");
    expect(searchClients).not.toHaveBeenCalled();
  });

  it("should scope selected client rows by agency when client ids repeat", async () => {
    // Given: two agencies both expose NetSuite client id 0
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({
          id: 12760,
          name: "TCL",
          clientsCount: 1,
          clients: [anAgencyClientV1({ id: 0, name: "" })],
        }),
        anAgencyV1({
          id: 45059,
          name: "TCL Canada",
          clientsCount: 1,
          clients: [anAgencyClientV1({ id: 0, name: "TCL Canada" })],
        }),
      ],
      totalElements: 2,
      totalPages: 1,
    }));

    // When:
    const { container } = renderSidebar("/agencies/12760/clients/0?clientName=Client%20without%20name");

    // Then: only the route's agency/client pair is highlighted, not every /clients/0 link
    expect(await screen.findByText("Client without name")).toBeInTheDocument();
    expect(screen.queryByText("TCL Canada", { selector: ".sidebar__client-name" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".sidebar__client-row.active")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Client without name/ }))
      .toHaveAttribute("href", "/agencies/12760/clients/0?clientName=Client%20without%20name");
  });

  it("should scope selected client rows by effective client name when one id is split", async () => {
    // Given: one agency exposes several effective mart clients under the same placeholder id
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({
          id: 12760,
          name: "TCL",
          clientsCount: 1,
          clients: [
            anAgencyClientV1({ id: 0, name: "Sunland Park" }),
            anAgencyClientV1({ id: 0, name: "Comfort Care" }),
          ],
        }),
      ],
      totalElements: 1,
      totalPages: 1,
    }));

    // When:
    const { container } = renderSidebar("/agencies/12760/clients/0?clientName=Sunland%20Park");

    // Then:
    expect(await screen.findByText("Sunland Park")).toBeInTheDocument();
    expect(screen.getByText("Comfort Care")).toBeInTheDocument();
    expect(container.querySelectorAll(".sidebar__client-row.active")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Sunland Park/ }))
      .toHaveAttribute("href", "/agencies/12760/clients/0?clientName=Sunland%20Park");
  });

  it("should collapse the open agency's client list when its row is clicked again", async () => {
    // Given: the agency is open (route-matched) with its clients showing
    vi.mocked(searchAgencies).mockResolvedValue(anAgencyPageV1({
      content: [
        anAgencyV1({
          id: 42,
          name: "Northstar Media",
          clientsCount: 1,
          clients: [anAgencyClientV1({ id: 1, name: "Acme Corp" })],
        }),
      ],
      totalElements: 1,
      totalPages: 1,
    }));
    renderSidebar("/agencies/42");
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();

    // When: the already-open agency row is clicked again
    fireEvent.click(screen.getByRole("link", { name: /Northstar Media/ }));

    // Then: its client sub-list collapses
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });

  describe("search", () => {
    function stubSearch() {
      // Server-side search: returns the matching rows for the given search term; non-search calls
      // (the alphabetized initial list) return the two agencies the non-search tests rely on.
      vi.mocked(searchAgencies).mockImplementation(async (pageNumber, pageSize, body) => {
        const term = (body.search ?? "").toLowerCase();
        if (term.startsWith("north")) {
          return anAgencyPageV1({
            content: [
              anAgencyV1({
                id: 1,
                name: "Northstar Media",
                clientsCount: 2,
                clients: [anAgencyClientV1({ id: 10, name: "Acme Corp" }), anAgencyClientV1({ id: 11, name: "Globex" })],
              }),
            ],
            pageNumber,
            totalElements: 1,
            totalPages: 1,
          });
        }
        if (term.startsWith("ford")) {
          return anAgencyPageV1({
            content: [
              anAgencyV1({
                id: 2,
                name: "Blue Chair",
                clientsCount: 1,
                clients: [anAgencyClientV1({ id: 20, name: "Ourisman Ford" })],
              }),
            ],
            pageNumber,
            totalElements: 1,
            totalPages: 1,
          });
        }
        if (term.startsWith("zzz")) {
          return anAgencyPageV1({
            content: [],
            pageNumber,
            totalElements: 0,
            totalPages: 0,
          });
        }
        return anAgencyPageV1({
          content: [
            anAgencyV1({
              id: 1,
              name: "Northstar Media",
              clientsCount: 2,
              clients: [anAgencyClientV1({ id: 10, name: "Acme Corp" }), anAgencyClientV1({ id: 11, name: "Globex" })],
            }),
            anAgencyV1({
              id: 2,
              name: "Blue Chair",
              clientsCount: 1,
              clients: [anAgencyClientV1({ id: 20, name: "Ourisman Ford" })],
            }),
          ],
          pageNumber,
          totalElements: 2,
          totalPages: 1,
        });
      });
    }

    it("should request matching agencies from the server when searching", async () => {
      // Given: both agencies are visible before searching
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");
      await screen.findByText("Blue Chair");

      // When: typing "north" sends the search term to the backend
      await userEvent.type(screen.getByLabelText("Search agencies or clients"), "north");

      // Then: only the server-returned matching agency remains, and the request carried the term
      await waitFor(() => {
        expect(screen.queryByText("Blue Chair")).not.toBeInTheDocument();
        expect(screen.getByText(fullTextEquals("Northstar Media", "sidebar__agency-name"))).toBeInTheDocument();
      });
      expect(searchAgencies).toHaveBeenLastCalledWith(1, 50, {
        sorting: { field: "NAME", direction: "ASC" },
        includeClients: true,
        search: "north",
      });
    });

    it("should surface matching clients even when the parent agency's name does not match", async () => {
      // Given: clients aren't shown at all before searching (no agency is expanded on "/")
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");
      expect(screen.queryByText("Ourisman Ford")).not.toBeInTheDocument();

      // When: "ford" doesn't match either agency's name, but the backend returns Blue Chair with
      // only its matching client
      await userEvent.type(screen.getByLabelText("Search agencies or clients"), "ford");

      // Then: Blue Chair is shown (auto-expanded) with its matching client; Northstar is gone
      await waitFor(() => {
        expect(screen.getByText(fullTextEquals("Ourisman Ford", "sidebar__client-name"))).toBeInTheDocument();
        expect(screen.getByText("Blue Chair")).toBeInTheDocument();
        expect(screen.queryByText("Northstar Media")).not.toBeInTheDocument();
        expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
      });
    });

    it("should highlight the matched substring", async () => {
      // Given:
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");

      // When:
      await userEvent.type(screen.getByLabelText("Search agencies or clients"), "north");

      // Then:
      const mark = await screen.findByText("North", { selector: "mark" });
      expect(mark).toBeInTheDocument();
    });

    it("should show a no-matches message when the server returns no results", async () => {
      // Given:
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");

      // When:
      await userEvent.type(screen.getByLabelText("Search agencies or clients"), "zzz");

      // Then:
      expect(await screen.findByText("No matches")).toBeInTheDocument();
    });

    it("should restore the normal paginated list when the search is cleared", async () => {
      // Given:
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");
      const input = screen.getByLabelText("Search agencies or clients");
      await userEvent.type(input, "north");
      await waitFor(() => expect(screen.queryByText("Blue Chair")).not.toBeInTheDocument());

      // When:
      await userEvent.clear(input);

      // Then: both agencies are visible again
      await waitFor(() => expect(screen.queryByText("Blue Chair")).toBeInTheDocument());
      expect(screen.getByText("Northstar Media")).toBeInTheDocument();
    });

    it("should issue exactly one search request regardless of how many characters are typed", async () => {
      // Given:
      stubSearch();
      renderSidebar("/");
      await screen.findByText("Northstar Media");
      const callsBeforeSearch = vi.mocked(searchAgencies).mock.calls.length;

      // When: typed as separate keystrokes, each re-debounced into the same final search term
      await userEvent.type(screen.getByLabelText("Search agencies or clients"), "north");
      await waitFor(() => expect(screen.queryByText("Blue Chair")).not.toBeInTheDocument());

      // Then: the debounced server-side search fires once, not once per keystroke
      expect(vi.mocked(searchAgencies).mock.calls.length - callsBeforeSearch).toBe(1);
    });
  });
});
