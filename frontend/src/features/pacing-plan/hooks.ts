import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddablePacingLineItems, savePacingPlan, updatePacingStatus } from "./api";
import type { PacingLifecycleStatus, PacingLineItemPlanUpdateV1 } from "./types";

/**
 * This pacing's own campaign(s)' line items not already on it (§9, US-126) - fetched once when the
 * Add line item panel opens, filtered/picked client-side rather than re-fetched per keystroke.
 */
export function useAddableLineItems(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["pacing", "addable-line-items", slug],
    queryFn: () => getAddablePacingLineItems(slug as string),
    enabled: enabled && !!slug,
  });
}

/**
 * Saves a pacing's plan (§9, US-125/126/127). On success invalidates every list that shows this
 * pacing's figures - the dashboard itself, the Pacing Overview and every campaign's Pacing tab - so a
 * plan edit, an added/removed line item is reflected everywhere immediately, the same "one source of
 * truth, re-read after write" pattern the display save uses for the dashboard alone. A broad
 * invalidation (not a narrow, single query key) because a plan save can change a pacing's budget,
 * margin and line-item count, all of which the Overview and campaign-tab rows also show.
 */
export function useSavePacingPlan(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lineItems: PacingLineItemPlanUpdateV1[]) => savePacingPlan(slug as string, lineItems),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}

/**
 * Changes a pacing's administrative lifecycle status (§9, US-128). Same broad invalidation as
 * {@link useSavePacingPlan} - a status change is exactly what the Overview's status column and filter,
 * and the campaign Pacing tab, must reflect immediately.
 */
export function useUpdatePacingStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pacingId, status }: { pacingId: string; status: PacingLifecycleStatus }) =>
      updatePacingStatus(pacingId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    },
  });
}
