import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPacing, getPacingDraft } from "./api";
import type { PacingCreateV1 } from "./types";

/**
 * The campaign's insertion orders and line items for the Create Pacing review panel (§8, US-121).
 * One request per campaign, same pattern as `useCampaignPacings` - the screen reviews/selects
 * client-side rather than re-fetching per interaction.
 */
export function usePacingDraft(campaignId: number | undefined) {
  return useQuery({
    queryKey: ["pacing", "draft", campaignId],
    queryFn: () => getPacingDraft(campaignId as number),
    enabled: campaignId !== undefined && Number.isFinite(campaignId),
  });
}

/**
 * Creates the pacing (§8, US-123). On success, invalidates the campaign's Pacing tab list so the new
 * pacing appears there immediately without a full page reload.
 */
export function useCreatePacing(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PacingCreateV1) => createPacing(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing", "campaign", campaignId] });
    },
  });
}
