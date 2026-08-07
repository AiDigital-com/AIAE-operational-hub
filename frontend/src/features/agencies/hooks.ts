import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { searchAgencies } from "./api";
import type { AgencyPageResponseV1 } from "./types";

/** Page size of the alphabetized agency list — also what "… N more" fetches one page at a time. */
export const AGENCY_LIST_PAGE_SIZE = 10;
/**
 * Server-side search page size. The backend matches agency name OR embedded client name
 * (CONTAINS_SUBSTR, case-insensitive), respects the page-size ceiling (100), and returns only matching
 * clients under agencies that matched via a client. Capped below 100 to bound cold-search payload size.
 */
export const AGENCY_SEARCH_PAGE_SIZE = 50;

const NAME_ASC = { field: "NAME", direction: "ASC" } as const;

function nextPageParam(lastPage: AgencyPageResponseV1) {
  return lastPage.pageNumber < lastPage.totalPages ? lastPage.pageNumber + 1 : undefined;
}

/**
 * The canonical owner of the alphabetized agency list, loaded a page at a time. Every surface that
 * needs "the agencies" — the sidebar tree, the Overview agency filter — must go through this hook so
 * they share one cache entry instead of each fetching its own copy under a different key.
 *
 * @param enabled whether to load (pass `false` while a search replaces this list)
 */
export function useAgencyList(enabled = true) {
  return useInfiniteQuery({
    queryKey: ["agencies", "sidebar"],
    queryFn: ({ pageParam }) =>
      searchAgencies(pageParam, AGENCY_LIST_PAGE_SIZE, { sorting: NAME_ASC, includeClients: true }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * The canonical owner of a server-side agency search, keyed by term so each term is cached on its own.
 * Paginated with the same infinite-query mechanism as {@link useAgencyList}, so a large result set
 * never requires an oversized single request.
 *
 * @param term the (already debounced and trimmed) search term; the query is disabled while it is empty
 */
export function useAgencySearch(term: string) {
  return useInfiniteQuery({
    queryKey: ["agencies", "sidebar", "search", term],
    queryFn: ({ pageParam }) =>
      searchAgencies(pageParam, AGENCY_SEARCH_PAGE_SIZE, {
        sorting: NAME_ASC,
        includeClients: true,
        search: term,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    placeholderData: keepPreviousData,
    enabled: term.length > 0,
    staleTime: 60_000,
  });
}
