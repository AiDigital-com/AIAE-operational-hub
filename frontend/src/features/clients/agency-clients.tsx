import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay } from "../../shared/ui/loading-spinner/loading-spinner";
import { searchClients } from "./api";
import type { ClientV1 } from "./types";
import "./agency-clients.css";

const PAGE_SIZE = 16;
const SEARCH_DEBOUNCE_MS = 300;

const UNNAMED = "Client without name";

function cleanClientName(value?: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed !== "-" && trimmed.toLowerCase() !== "null" ? trimmed : "";
}

function displayClientName(value?: string | null): string {
  return cleanClientName(value) || UNNAMED;
}

function clientRoute(agencyId: number, client: ClientV1): string {
  return `/agencies/${agencyId}/clients/${client.id}?clientName=${encodeURIComponent(displayClientName(client.name))}`;
}

function initials(name: string): string {
  if (!name?.trim()) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AgencyClients() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const location = useLocation();
  const agencyName = (location.state as { agencyName?: string } | null)?.agencyName;
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInput = searchParams.get("q") ?? "";
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(1);

  const id = Number(agencyId);

  // A new search resets to the first page — derived synchronously during render (not in an effect
  // reacting to `search`) so the query key never briefly pairs the stale page with the new search.
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    setPage(1);
  }

  function onSearchChange(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  }

  const clientsQuery = useQuery({
    // Without a search, the key matches the page-1 cache the sidebar seeds, so clicking a sidebar
    // agency renders instantly with no request; a search uses a distinct key and fetches filtered.
    queryKey: search ? ["clients", "agency", id, page, search] : ["clients", "agency", id, page],
    queryFn: () =>
      searchClients(page, PAGE_SIZE, {
        filters: [
          { field: "AGENCY_ID" as const, value: String(id), operation: "EQUALS" as const, caseSensitive: false },
          ...(search
            ? [{ field: "NAME" as const, value: search, operation: "CONTAINS" as const, caseSensitive: false }]
            : []),
        ],
        sorting: { field: "NAME", direction: "ASC" },
      }),
    enabled: Number.isFinite(id),
    placeholderData: keepPreviousData,
    // The sidebar seeds page 1 from the agency's embedded clients; a non-zero staleTime lets the
    // detail page treat that seed as fresh so clicking a sidebar agency doesn't trigger a refetch.
    staleTime: 5 * 60 * 1000,
  });

  const clients = clientsQuery.data?.content ?? [];
  const totalPages = clientsQuery.data?.totalPages ?? 1;
  const totalElements = clientsQuery.data?.totalElements ?? 0;
  const refreshing = clientsQuery.isFetching && !clientsQuery.isPending;

  const title = agencyName ?? `Agency ${agencyId}`;

  return (
    <section className="agency-clients">
      <div className="agency-clients__crumbs">
        <Link to="/agencies" className="agency-clients__crumbs-link">Agencies</Link>
        <span className="agency-clients__crumbs-sep">›</span>
        <span className="agency-clients__crumbs-cur">{title}</span>
      </div>

      <h1 className="agency-clients__page-title">{title}</h1>
      <p className="agency-clients__page-sub">
        {clientsQuery.isSuccess && totalElements > 0
          ? `${totalElements} client${totalElements !== 1 ? "s" : ""} · Select one to view their campaigns.`
          : "Select a client to view their campaigns."}
      </p>

      <label className="agency-clients__search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search clients…"
          aria-label="Search clients"
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {clientsQuery.isPending && <LoadingBlock label="Loading clients" />}

      {clientsQuery.isError && (
        <p className="form-error">{formatError(clientsQuery.error)}</p>
      )}

      {clientsQuery.isSuccess && clients.length === 0 && (
        <p className="agency-clients__empty">
          {search ? `No clients match "${search}".` : "No clients found for this agency."}
        </p>
      )}

      {clientsQuery.isSuccess && clients.length > 0 && (
        <>
          <div className="agency-clients__grid-wrap" aria-busy={refreshing}>
            <div className="agency-clients__grid">
              {clients.map((client) => (
                <ClientCard
                  key={`${client.id}:${client.name ?? ""}`}
                  client={client}
                  agencyId={id}
                  agencyName={title}
                />
              ))}
            </div>
            {refreshing && <LoadingOverlay label="Updating clients" />}
          </div>

          {totalPages > 1 && (
            <div className="agency-clients__pagination">
              <button
                type="button"
                className="agency-clients__page-btn"
                disabled={page === 1 || refreshing}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span className="agency-clients__page-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalElements)} of {totalElements}
              </span>
              <button
                type="button"
                className="agency-clients__page-btn"
                disabled={page >= totalPages || refreshing}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClientCard({
  client,
  agencyId,
  agencyName,
}: {
  client: ClientV1;
  agencyId: number;
  agencyName: string;
}) {
  const navigate = useNavigate();
  const displayName = displayClientName(client.name);
  return (
    <button
      type="button"
      className="client-card"
      onClick={() =>
        navigate(clientRoute(agencyId, client), {
          state: { clientName: displayName, agencyId, agencyName },
        })
      }
    >
      <div className="client-card__top">
        <div className="client-card__logo" aria-hidden="true">
          {initials(displayName)}
        </div>
        <div>
          <div className="client-card__title">{displayName}</div>
        </div>
      </div>
      <div className="client-card__footer">
        <span className="client-card__tag">Client</span>
        <span className="client-card__go">
          View campaigns
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={15}
            height={15}
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      </div>
    </button>
  );
}
