import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { searchCampaigns } from "../../campaigns/api";
import type { CampaignSearchRequestV1, CampaignV1 } from "../../campaigns/types";
import { toPacingCampaign } from "./adapter";
import { todayISO } from "./format";
import { buildOverview } from "./overview";
import { campPacing } from "./pacing";
import { bqName } from "./reports";
import type { DashSource, Overview } from "./types";

// Components never call the generators in ./overview, ./pacing directly — always through these hooks,
// so the eventual real-API swap (see 03-REAL-DASHBOARD-INTEGRATION.md) touches only this file. Setup
// is no longer mock-backed for the Setup tab (see features/campaigns/hooks.ts's own
// `useCampaignSetup`) - `buildSetup`/`mergeSetup` here now feed only the still-mocked Pacing/Overview
// rollup (01-MIGRATION-PLAN.md's follow-up plan §D10).

/** Matches Campaigns' (C1) own page size — Overview reuses the exact same table/row styling. */
export const OVERVIEW_PAGE_SIZE = 16;

/**
 * Everything the operational Overview needs: the user's real, RBAC-scoped campaigns - paginated and
 * filtered server-side via the same `searchCampaigns` the Campaigns page uses (see
 * 01-MIGRATION-PLAN.md O1) - with pacing generated per real campaign id. See `buildOverview`.
 *
 * The summary rollup only ever reflects campaigns loaded so far; it grows as `fetchNextPage` loads
 * more, exactly like the Reporting tab's infinite-scrolled rows. `totalElements` is the one number
 * that's always exact regardless of how much has loaded, since it comes from the server's own
 * pagination metadata rather than being computed from `campaigns`.
 *
 * Also exposes the raw `campaigns` list (keyed by real id via `OwnerCampaign.id`), so a campaign row's
 * click handler can navigate with the exact real `CampaignV1` the hub's own campaign-detail routing
 * already expects, rather than reconstructing a partial one from the flattened, pacing-only row shape.
 *
 * @param body the filter/sort request built from the Overview's search/status/agency controls
 */
export function useOverviewPacing(body: CampaignSearchRequestV1) {
  const campaignsQuery = useInfiniteQuery({
    queryKey: ["campaigns", "overview", body],
    queryFn: ({ pageParam }) => searchCampaigns(pageParam, OVERVIEW_PAGE_SIZE, body),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.pageNumber < lastPage.totalPages ? lastPage.pageNumber + 1 : undefined),
    // Keeps the previous filter's rows on screen (instead of a full-page loading flash) while a new
    // search/status/agency filter's page one loads - mirrors the Campaigns page's own useQuery.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const campaigns = useMemo(
    () => campaignsQuery.data?.pages.flatMap((page) => page.content) ?? [],
    [campaignsQuery.data]
  );
  const hasCampaignsData = campaignsQuery.data !== undefined;

  // buildOverview walks every loaded campaign generating a full pacing/IO/line-item RNG tree, so it's
  // memoized rather than recomputed on every render (e.g. every Overview search keystroke).
  const data: Overview | undefined = useMemo(
    () => (hasCampaignsData ? buildOverview(campaigns) : undefined),
    [hasCampaignsData, campaigns]
  );

  return {
    data,
    campaigns,
    totalElements: campaignsQuery.data?.pages[0]?.totalElements ?? 0,
    isPending: campaignsQuery.isPending,
    isError: campaignsQuery.isError,
    error: campaignsQuery.error,
    hasNextPage: campaignsQuery.hasNextPage,
    isFetchingNextPage: campaignsQuery.isFetchingNextPage,
    fetchNextPage: campaignsQuery.fetchNextPage,
  };
}

/** A single real campaign's mock pacing overlay, stable across re-renders (seeded by its real id). */
export function useCampaignPacing(campaign: CampaignV1 | undefined) {
  return useQuery({
    queryKey: ["pacing", "campaign", campaign?.id],
    queryFn: () => campPacing(toPacingCampaign(campaign as CampaignV1)),
    enabled: campaign != null,
    staleTime: Infinity,
  });
}

/**
 * A single real campaign's (mock, no-backend) Clicdata BQ data sources (W5). One per report type; the
 * only creatable type today is "basic" (matches the Reporting tab's only-active report type).
 */
export function useDashSources(campaign: CampaignV1 | undefined) {
  const queryClient = useQueryClient();
  const campaignId = campaign?.id;
  const key = ["pacing", "dashboards", campaignId];

  const query = useQuery({
    queryKey: key,
    queryFn: (): DashSource[] => [],
    enabled: campaign != null,
    staleTime: Infinity,
  });

  function createDashSource(breakdown: "creative" | "line_item") {
    if (!campaign) return;
    const table = bqName(toPacingCampaign(campaign), "basic") + (breakdown === "line_item" ? "_li" : "");
    const source: DashSource = {
      id: `ds-${Math.random().toString(36).slice(2, 9)}`,
      name: "Basic dashboard source",
      type: "basic",
      breakdown,
      table,
      created: todayISO(),
      status: "active",
    };
    queryClient.setQueryData<DashSource[]>(key, (current) => [...(current ?? []), source]);
  }

  function deleteDashSource(id: string) {
    queryClient.setQueryData<DashSource[]>(key, (current) => (current ?? []).filter((source) => source.id !== id));
  }

  return {
    sources: query.data ?? [],
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    createDashSource,
    deleteDashSource,
  };
}
