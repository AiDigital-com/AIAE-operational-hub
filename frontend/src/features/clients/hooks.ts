import { useInfiniteQuery } from "@tanstack/react-query";
import { searchClients } from "./api";
import type { ClientPageResponseV1 } from "./types";

/**
 * Page size of a client list, and so of one "… N more" step. Matches what the agency detail page reads,
 * which is what lets the sidebar's embedded clients stand in for that page exactly.
 */
export const CLIENTS_PAGE_SIZE = 16;

/**
 * The clients under one agency, read {@code pageSize} at a time from {@code firstPage} on.
 *
 * The sidebar already has an agency's first page for free: the agency list carries that many clients
 * embedded in each row, which is also what seeds the detail page's cache. What it did not have was any
 * way to reach the rest, so an agency with 22 clients showed 16 and no hint that six were missing
 * (PDI_104). This fills that in, a page at a time, and only for the one agency whose list is being
 * extended - the alternative was raising the embedded cap, which costs every agency in the list a
 * bigger payload on every load and puts the same ceiling back a little higher up.
 *
 * Its own query key, deliberately: `["clients", "agency", id, page]` belongs to the detail page, one
 * entry per page, and this is one entry accumulating pages. They read the same endpoint, so the only
 * request the two can duplicate is page one - which only the search case below asks for.
 *
 * @param agencyId  the agency whose list is being extended, or undefined while none is
 * @param firstPage where to start: page 2 when the row already shows the embedded first page, page 1
 *                  when what it shows is a search's matching subset that the full list has to replace
 * @param pageSize  how many to read at a time
 * @param enabled   whether there is in fact anything left to read
 */
export function useAgencyClientList(
  agencyId: number | undefined,
  firstPage: number,
  pageSize: number,
  enabled: boolean
) {
  return useInfiniteQuery({
    queryKey: ["clients", "agency", agencyId, "from-page", firstPage, pageSize],
    queryFn: ({ pageParam }) =>
      searchClients(pageParam, pageSize, {
        filters: [
          {
            field: "AGENCY_ID" as const,
            value: String(agencyId),
            operation: "EQUALS" as const,
            caseSensitive: false,
          },
        ],
        sorting: { field: "NAME", direction: "ASC" },
      }),
    initialPageParam: firstPage,
    getNextPageParam: (lastPage: ClientPageResponseV1) =>
      lastPage.pageNumber < lastPage.totalPages ? lastPage.pageNumber + 1 : undefined,
    enabled: agencyId != null && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
