import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backfillOrderNumbers, deletePacing, refreshAllDashboards, revalidatePacing } from "./api";

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

/**
 * Fills missing IO numbers across all pacings. On success invalidates the "pacing" prefix like a
 * revalidate does: a filled insertion_order_id changes what each dashboard's campaign.orderNumber
 * reads, so the cached dashboards (and their header IO chips) are stale the moment it lands.
 */
export function useBackfillOrderNumbers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: backfillOrderNumbers,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}

/**
 * Re-pulls one pacing's configuration from the NetSuite master. Invalidates the same "pacing"-prefixed
 * queries a delete does: a re-validate can move margin, targets, flight dates and the campaign set, so
 * every list and dashboard showing this pacing is stale the moment it lands.
 */
export function useRevalidatePacing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pacingId: string) => revalidatePacing(pacingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}
