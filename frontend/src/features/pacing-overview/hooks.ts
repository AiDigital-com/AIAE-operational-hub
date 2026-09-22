import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAssignableOwners, listCampaignPacings, listPacingOverview, transferPacingOwner } from "./api";

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

/**
 * Who the current user may hand a pacing to (§11, US-131).
 *
 * Kept OUT of the row query on purpose: it does not vary by pacing, and refetching it per row would
 * turn a reassignment screen into a request storm. Loaded lazily — `enabled` is what the picker
 * flips when it opens, so a user who never reassigns anything never fetches this at all.
 */
export function useAssignableOwners(enabled: boolean) {
  return useQuery({
    queryKey: ["pacing", "assignable-owners"],
    queryFn: listAssignableOwners,
    enabled,
    // The roster changes when somebody joins or moves team, not between two clicks in one sitting.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reassigns a pacing and refreshes whatever list is on screen (§11, US-131).
 *
 * Invalidates both pacing lists rather than patching a row in place: ownership decides what the
 * viewer can SEE, so handing a pacing to someone outside their own scope legitimately removes it
 * from their list. Re-reading is the only way to show that honestly.
 */
export function useTransferPacingOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pacingId, newOwnerId }: { pacingId: string; newOwnerId: string }) =>
      transferPacingOwner(pacingId, newOwnerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing", "overview"] });
      void queryClient.invalidateQueries({ queryKey: ["pacing", "campaign"] });
    },
  });
}
