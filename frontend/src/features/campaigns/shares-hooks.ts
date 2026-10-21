import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCampaignShare,
  deleteCampaignShare,
  listCampaignShares,
  listShareCandidates,
} from "./shares-api";

/** Who the campaign is shared with. Refetched on focus: a colleague may have added or removed
 *  somebody while this tab sat open, and the avatars in the hero are what everyone looks at. */
export function useCampaignShares(campaignId: number | undefined) {
  return useQuery({
    queryKey: ["campaigns", "shares", campaignId],
    queryFn: () => listCampaignShares(campaignId as number),
    enabled: campaignId !== undefined && Number.isFinite(campaignId),
  });
}

/** The people a campaign could be shared with, for the search box. Fetched only while the picker is
 *  open; the previous answer stays on screen while a new fragment loads, so the list does not blink. */
export function useShareCandidates(campaignId: number, query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["campaigns", "share-candidates", campaignId, query],
    queryFn: () => listShareCandidates(campaignId, query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * Adds or removes a person - each invalidating this campaign's shares AND the pacing lists.
 *
 * The pacing lists matter as much as the share list: a share decides what the RECIPIENT can see, so
 * granting or removing one legitimately adds rows to or removes them from somebody's overview.
 */
function useShareMutation<T>(campaignId: number, fn: (campaignId: number, input: T) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => fn(campaignId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns", "shares", campaignId] });
      void queryClient.invalidateQueries({ queryKey: ["campaigns", "share-candidates", campaignId] });
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}

export function useCreateShare(campaignId: number) {
  return useShareMutation<number>(campaignId, createCampaignShare);
}

export function useDeleteShare(campaignId: number) {
  return useShareMutation<number>(campaignId, deleteCampaignShare);
}
