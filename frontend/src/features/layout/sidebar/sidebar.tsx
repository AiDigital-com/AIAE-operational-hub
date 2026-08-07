import { UserButton } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Fragment, memo, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useMatch } from "react-router-dom";
import { useAgencyList, useAgencySearch } from "../../agencies/hooks";
import type { AgencyClientV1, AgencyPageResponseV1, AgencyV1 } from "../../agencies/types";
import { cn } from "../../../shared/style/cn";
import { useDebounce } from "../../../shared/hooks/use-debounce";
import { useTheme } from "../../../shared/style/theme";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TeamIcon,
} from "../../../shared/ui/icons/icons";
import { LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { useToast } from "../../../shared/ui/toast/toast";
import type { UserV1 } from "../../rbac/types";
import "./sidebar.css";

const CLIENT_WITHOUT_NAME = "Client without name";
// Must match the AgencyClients detail page size and the backend's EMBEDDED_CLIENTS_LIMIT, so the
// embedded clients can seed the detail page's first page exactly.
const DETAIL_CLIENTS_PAGE_SIZE = 16;
const SEARCH_DEBOUNCE_MS = 300;

function cleanClientName(value?: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed !== "-" && trimmed.toLowerCase() !== "null" ? trimmed : "";
}

function displayClientName(value?: string | null): string {
  return cleanClientName(value) || CLIENT_WITHOUT_NAME;
}

function clientRoute(agencyId: number, client: AgencyClientV1): string {
  return `/agencies/${agencyId}/clients/${client.id}?clientName=${encodeURIComponent(displayClientName(client.name))}`;
}

function highlightMatch(text: string, term: string): ReactNode {
  if (!term) return text;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return text;
  return (
    <Fragment>
      {text.slice(0, index)}
      <mark className="sidebar__mark">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </Fragment>
  );
}

interface SidebarProps {
  isAdmin: boolean;
  user: UserV1 | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn("sidebar__nav-item", isActive && "sidebar__nav-item--active");
}

// Memoized so topbar-search keystrokes (which re-render AppShell on every keystroke) do not also
// re-render the whole agency/client tree here; AppShell passes stable `user` (cached query data)
// and a useCallback-memoized `onToggleCollapsed`, so this memo is effective.
export const Sidebar = memo(function Sidebar({ isAdmin, user, collapsed, onToggleCollapsed }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const agencyMatch = useMatch("/agencies/:agencyId");
  const nestedClientMatch = useMatch("/agencies/:agencyId/clients/:clientId");
  const matchedAgencyId = nestedClientMatch?.params.agencyId ?? agencyMatch?.params.agencyId;
  const routeAgencyId = matchedAgencyId ? Number(matchedAgencyId) : null;
  const clientMatch = nestedClientMatch;
  const routeClientId = clientMatch?.params.clientId ? Number(clientMatch.params.clientId) : null;
  const location = useLocation();
  const routeClientName = cleanClientName(new URLSearchParams(location.search).get("clientName"));
  const activeAgencyId = routeAgencyId != null && Number.isFinite(routeAgencyId) ? routeAgencyId : null;

  // Navigating to an agency expands it; clicking the already-open agency toggles its sub-list shut.
  const [expandedId, setExpandedId] = useState<number | null>(activeAgencyId);
  useEffect(() => {
    if (activeAgencyId !== null) setExpandedId(activeAgencyId);
  }, [activeAgencyId]);

  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const searchTerm = useDebounce(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const isSearching = searchTerm.length > 0;

  // Sidebar agencies are listed alphabetically and loaded a page at a time — "… N more" fetches only
  // the next page instead of re-requesting everything shown so far. Clients are embedded so expanding
  // an agency is instant. Paused while searching (a single unfiltered fetch replaces it below).
  // Both queries live in features/agencies/hooks so the Overview agency filter shares these exact
  // cache entries instead of fetching its own copy of the same list.
  const agenciesQuery = useAgencyList(!isSearching);
  const searchQuery = useAgencySearch(searchTerm);

const searchResults: AgencyV1[] =
	isSearching
		? searchQuery.data?.pages.flatMap((page) => page.content) ?? []
		: [];
const searchTotal = isSearching ? searchQuery.data?.pages[0]?.totalElements ?? 0 : 0;
const searchingMore = isSearching && searchQuery.isFetchingNextPage;
const hasMoreSearch = isSearching && searchQuery.hasNextPage;
const canHideSearch = isSearching && (searchQuery.data?.pages.length ?? 0) > 1;

const agencies = isSearching
	? searchResults
	: agenciesQuery.data?.pages.flatMap((page) => page.content) ?? [];
const totalAgencies = isSearching
	? searchTotal
	: agenciesQuery.data?.pages[0]?.totalElements ?? 0;
const loadingMore = isSearching ? searchingMore : agenciesQuery.isFetchingNextPage;
const canHide = isSearching ? canHideSearch : (agenciesQuery.data?.pages.length ?? 0) > 1;
const hasMore = isSearching ? hasMoreSearch : agenciesQuery.hasNextPage;
const isPending = isSearching ? searchQuery.isPending : agenciesQuery.isPending;

function hideExtraAgencies() {
		if (isSearching) {
			queryClient.setQueryData<InfiniteData<AgencyPageResponseV1, number>>(
				["agencies", "sidebar", "search", searchTerm],
				(data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
			);
			return;
		}
		queryClient.setQueryData<InfiniteData<AgencyPageResponseV1, number>>(
			["agencies", "sidebar"],
			(data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
		);
	}

  function isSelectedClient(agencyId: number, client: AgencyClientV1): boolean {
    if (routeClientId !== client.id || activeAgencyId !== agencyId) {
      return false;
    }
    const clientName = displayClientName(client.name);
    return routeClientName || clientName ? routeClientName === clientName : true;
  }

  // Seed the AgencyClients detail page's first-page cache from the embedded clients, so clicking a
  // sidebar agency renders its clients without a follow-up request (the detail query has a matching
  // staleTime so it treats the seeded page as fresh). Deeper pages are fetched on demand.
  useEffect(() => {
    const pages = agenciesQuery.data?.pages;
    if (!pages) return;
    for (const page of pages) {
      for (const agency of page.content) {
        if (!agency.clients) continue;
        const total = agency.clientsCount ?? agency.clients.length;
        queryClient.setQueryData(["clients", "agency", agency.id, 1], {
          content: agency.clients.map((c) => ({ id: c.id, name: c.name ?? "", agency_id: agency.id })),
          pageNumber: 1,
          pageSize: DETAIL_CLIENTS_PAGE_SIZE,
          totalElements: total,
          totalPages: Math.max(1, Math.ceil(total / DETAIL_CLIENTS_PAGE_SIZE)),
        });
      }
    }
  }, [agenciesQuery.data, queryClient]);

  const userRole = user?.roles?.includes("ADMIN") ? "Admin" : "User";

  return (
    <aside className={cn("sidebar", collapsed && "sidebar--collapsed")} aria-label="Primary">
      <Link to="/" className="sidebar__brand" aria-label="Go to Overview">
        <span className="sidebar__brand-mark" aria-hidden="true">AI</span>
        <div className="sidebar__brand-full">
          <p className="sidebar__brand-logo">AI DIGITAL</p>
          <p className="sidebar__brand-sub">Workspace</p>
        </div>
      </Link>

      <nav className="sidebar__nav">
        <NavLink to="/" end className={navLinkClass}>
          <span className="sidebar__nav-icon" aria-hidden="true"><HomeIcon /></span>
          <span className="sidebar__nav-label">Overview</span>
        </NavLink>
        {isAdmin && (
          <NavLink to="/teams" className={navLinkClass}>
            <span className="sidebar__nav-icon" aria-hidden="true"><TeamIcon /></span>
            <span className="sidebar__nav-label">Team</span>
          </NavLink>
        )}
        {isAdmin && (
          <button
            type="button"
            className="sidebar__nav-item"
            onClick={() => toast.showError("Admin — out of scope for this phase.")}
          >
            <span className="sidebar__nav-icon" aria-hidden="true"><SettingsIcon /></span>
            <span className="sidebar__nav-label">Admin</span>
          </button>
        )}
      </nav>

      <label className="sidebar__search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search agencies or clients…"
          aria-label="Search agencies or clients"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </label>

      <div className="sidebar__divider" />
      <p className="sidebar__section-label">Agencies</p>

      <div className="sidebar__agencies">
        <div className="sidebar__agency-list">
        {isPending && (
          <div className="sidebar__agency-loading">
            <LoadingSpinner label="Loading sidebar agencies" size="sm" />
          </div>
        )}
        {!isPending && isSearching && agencies.length === 0 && (
          <p className="sidebar__empty">No matches</p>
        )}
        {agencies.map((agency) => {
          const isExpanded = isSearching ? true : expandedId === agency.id;
          const clients: AgencyClientV1[] = isExpanded ? agency.clients ?? [] : [];
          const clientCount = agency.clientsCount;

          return (
            <div key={agency.id} className="sidebar__agency-group">
              <NavLink
                to={`/agencies/${agency.id}`}
                state={{ agencyName: agency.name }}
                className={({ isActive }) =>
                  cn("sidebar__agency", isActive && "sidebar__agency--selected")
                }
                aria-expanded={isExpanded}
                onClick={() => setExpandedId((prev) => (prev === agency.id ? null : agency.id))}
              >
                <span className={cn("sidebar__agency-avatar", isExpanded && "sidebar__agency-avatar--open")}>
                  {initials(agency.name)}
                </span>
                <span className="sidebar__agency-name">{highlightMatch(agency.name, searchTerm)}</span>
                {clientCount !== undefined && (
                  <span className="sidebar__agency-count">{clientCount}</span>
                )}
                <ChevronRightIcon
                  className={cn("sidebar__agency-chev", isExpanded && "sidebar__agency-chev--open")}
                />
              </NavLink>

              {isExpanded && clients.length > 0 && (
                <div className="sidebar__clients">
                  {clients.map((client) => {
                    const selected = isSelectedClient(agency.id, client);
                    const displayName = displayClientName(client.name);
                    return (
                      <Link
                        key={`${client.id}:${displayName}`}
                        to={clientRoute(agency.id, client)}
                        state={{ clientName: displayName, agencyId: agency.id, agencyName: agency.name }}
                        className={cn("sidebar__client-row", selected && "active")}
                        aria-current={selected ? "page" : undefined}
                      >
                        <span className="sidebar__client-dot" aria-hidden="true" />
                        <span className="sidebar__client-name">
                          {highlightMatch(displayName, searchTerm)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </div>

        {!isPending && (hasMore || canHide) && (
          <div className="sidebar__more-row">
            {hasMore && (
              <button
                type="button"
                className="sidebar__more-btn"
                disabled={loadingMore}
                onClick={() =>
                  isSearching ? searchQuery.fetchNextPage() : agenciesQuery.fetchNextPage()
                }
              >
                {loadingMore ? <LoadingSpinner size="sm" /> : <span className="sidebar__agency-dots">···</span>}
                {totalAgencies - agencies.length} more
              </button>
            )}
            {canHide && (
              <button
                type="button"
                className="sidebar__more-btn sidebar__more-btn--hide"
                onClick={hideExtraAgencies}
              >
                Hide
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__theme-toggle">
          <button
            type="button"
            className={cn("sidebar__theme-opt", theme === "light" && "sidebar__theme-opt--active")}
            onClick={() => setTheme("light")}
          >
            <SunIcon /> <span>Light</span>
          </button>
          <button
            type="button"
            className={cn("sidebar__theme-opt", theme === "dark" && "sidebar__theme-opt--active")}
            onClick={() => setTheme("dark")}
          >
            <MoonIcon /> <span>Dark</span>
          </button>
        </div>
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeftIcon />
        </button>
        <div className="sidebar__user">
          <UserButton afterSignOutUrl="/" />
          <div className="sidebar__user-meta">
            <span className="sidebar__user-name">{user?.full_name || "Signed in"}</span>
            <span className="sidebar__user-role">{userRole}</span>
          </div>
        </div>
      </div>
    </aside>
  );
});

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
