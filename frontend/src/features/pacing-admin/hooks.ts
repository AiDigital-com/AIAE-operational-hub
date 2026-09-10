import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deletePacing, refreshAllDashboards } from "./api";

/**
 * Deletes a pacing. On success invalidates every "pacing"-prefixed query - the admin table itself
 * (which shares `usePacingOverview`'s cache entry) and the Overview - the same broad invalidation
 * `useUpdatePacingStatus` (pacing-plan) uses, so the deleted row disappears everywhere at once rather
 * than only where the delete happened to be triggered from.
 */
export function useDeletePacing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pacingId: string) => deletePacing(pacingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}

/** Triggers the full nightly Daily Build off-schedule. Nothing to invalidate - it starts a build in
 *  n8n, it does not change anything the Hub already has cached. */
export function useRefreshAllDashboards() {
  return useMutation({ mutationFn: refreshAllDashboards });
}
