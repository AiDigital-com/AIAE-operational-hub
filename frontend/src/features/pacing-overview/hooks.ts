import { useQuery } from "@tanstack/react-query";
import { listCampaignPacings, listPacingOverview } from "./api";

/**
 * The canonical owner of the Pacing Overview list (§4 of the migration plan, US-109). One request
 * for the whole scoped list; the screen filters/sorts/searches the loaded set client-side rather than
 * re-fetching per interaction.
 */
export function usePacingOverview() {
  return useQuery({ queryKey: ["pacing", "overview"], queryFn: listPacingOverview });
}

/**
 * A single campaign's Pacing tab (§5 of the migration plan, US-112). Refetched per campaign id —
 * unlike the Overview this list is naturally small and scoped, so there is no client-side cache
 * worth sharing across campaigns the way the whole Overview set is.
 */
export function useCampaignPacings(campaignId: number | undefined) {
  return useQuery({
    queryKey: ["pacing", "campaign", campaignId],
    queryFn: () => listCampaignPacings(campaignId as number),
    enabled: campaignId !== undefined && Number.isFinite(campaignId),
  });
}
