import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay } from "../../shared/ui/loading-spinner/loading-spinner";
import { searchAgencies } from "./api";
import type { AgencyV1, DirectionEnumV1 } from "./types";
import "./agency-list.css";

const PAGE_SIZE = 16;
const SEARCH_DEBOUNCE_MS = 300;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The agencies grid at `/agencies` (previously the Overview page, before Overview became the
 * operational pacing overview at `/`).
 */
export function AgencyList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInput = searchParams.get("q") ?? "";
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(1);

  function onSearchChange(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  }

  // A new search resets to the first page — derived synchronously during render (not in an effect
  // reacting to `search`) so the query key never briefly pairs the stale page with the new search.
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    setPage(1);
  }

  const agenciesQuery = useQuery({
    queryKey: ["agencies", "overview", page, search],
    queryFn: () =>
      searchAgencies(page, PAGE_SIZE, {
        ...(search
          ? { filters: [{ field: "NAME" as const, value: search, operation: "CONTAINS" as const, caseSensitive: false }] }
          : {}),
        sorting: { field: "NAME", direction: "ASC" as DirectionEnumV1 },
      }),
    placeholderData: keepPreviousData,
  });

  const agencies = agenciesQuery.data?.content ?? [];
  const totalPages = agenciesQuery.data?.totalPages ?? 1;
  const totalElements = agenciesQuery.data?.totalElements ?? 0;
  const refreshing = agenciesQuery.isFetching && !agenciesQuery.isPending;

  return (
    <section className="agency-list">
      <div className="agency-list__crumbs">
        <span className="agency-list__crumbs-cur">Agencies</span>
      </div>

      <h1 className="agency-list__page-title">Agencies</h1>
      <p className="agency-list__page-sub">Select an agency to view its clients.</p>

      <label className="agency-list__search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search agencies…"
          aria-label="Search agencies"
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {agenciesQuery.isPending && <LoadingBlock label="Loading agencies" />}

      {agenciesQuery.isError && (
        <p className="form-error">{formatError(agenciesQuery.error)}</p>
      )}

      {agenciesQuery.isSuccess && agencies.length === 0 && (
        <p className="agency-list__empty">
          {search ? `No agencies match "${search}".` : "No agencies found."}
        </p>
      )}

      {agenciesQuery.isSuccess && agencies.length > 0 && (
        <>
          <div className="agency-list__grid-wrap" aria-busy={refreshing}>
            <div className="agency-list__grid">
              {agencies.map((agency) => (
                <AgencyCard
                  key={agency.id}
                  agency={agency}
                  onClick={() => navigate(`/agencies/${agency.id}`, { state: { agencyName: agency.name } })}
                />
              ))}
            </div>
            {refreshing && <LoadingOverlay label="Updating agencies" />}
          </div>

          {totalPages > 1 && (
            <div className="agency-list__pagination">
              <button
                type="button"
                className="agency-list__page-btn"
                disabled={page === 1 || refreshing}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span className="agency-list__page-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalElements)} of {totalElements}
              </span>
              <button
                type="button"
                className="agency-list__page-btn"
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

function AgencyCard({
  agency,
  onClick,
}: {
  agency: AgencyV1;
  onClick: () => void;
}) {
  const count = agency.clientsCount;
  const metaText = count !== undefined
    ? `${count} client${count !== 1 ? "s" : ""}`
    : null;

  return (
    <button type="button" className="agency-card" onClick={onClick}>
      <div className="agency-card__top">
        <div className="agency-card__logo" aria-hidden="true">
          {initials(agency.name)}
        </div>
        <div>
          <div className="agency-card__title">{agency.name}</div>
          <div className="agency-card__meta">{metaText}</div>
        </div>
      </div>
      <div className="agency-card__footer">
        <span className="agency-card__tag">Agency</span>
        <span className="agency-card__go">
          View clients
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
