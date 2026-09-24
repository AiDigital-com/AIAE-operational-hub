import { createDelegation, extendDelegation, listDelegations, revokeDelegation } from "./delegations-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPacingNsDiff, listAssignableOwners, listCampaignPacings, listPacingOverview, transferPacingOwner } from "./api";

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

/**
 * The live, full NetSuite diff for one pacing (§13, US-136), fetched fresh every time the sheet that
 * shows it opens. `enabled` is that sheet's own open state - there is no polling, and the default
 * (zero) `staleTime` means re-opening the same pacing refetches rather than showing whatever it last
 * saw, which is the whole point: this is never read from the row's own nightly `nsDiffSummary` cache.
 */
export function usePacingNsDiff(pacingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pacing", "ns-diff", pacingId],
    queryFn: () => getPacingNsDiff(pacingId),
    enabled: enabled && pacingId !== "",
  });
}

/**
 * Delegations in force for the current user (§12, US-135) - granted and received.
 *
 * Pacing filters out revoked and expired rows, so this list needs no client-side status logic and
 * an expired grant leaves it by itself. Refetched on focus because a colleague may have revoked
 * one while this tab sat open, and "why can I still see this" is exactly the question the screen
 * exists to answer.
 */
export function useDelegations(enabled = true) {
  return useQuery({
    queryKey: ["pacing", "delegations"],
    queryFn: listDelegations,
    enabled,
  });
}

/**
 * Grants, extends or revokes - each invalidating both the delegation list and the pacing lists.
 *
 * The pacing lists matter as much as the list itself: a delegation decides what the DELEGATE can
 * see, so granting or revoking one legitimately adds rows to or removes them from somebody's
 * overview. Re-reading is the only honest way to show that.
 */
function useDelegationMutation<T>(fn: (input: T) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    // Wrapped rather than passed by reference: React Query calls a mutationFn with (variables,
    // context), so handing it the API function directly gives that function a second argument it
    // never asked for. Harmless today; a trap the day one of them grows an optional parameter.
    mutationFn: (input: T) => fn(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}

export function useCreateDelegation() {
  return useDelegationMutation(createDelegation);
}

export function useRevokeDelegation() {
  return useDelegationMutation(revokeDelegation);
}

export function useExtendDelegation() {
  return useDelegationMutation(({ delegationId, expiresAt }: { delegationId: string; expiresAt: string }) =>
    extendDelegation(delegationId, expiresAt)
  );
}
