import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listPacingLibrary } from "../pacing-dashboard/api";
import { createPacing, getPacingDraft } from "./api";
import { creationLayoutOptions } from "./layout-options";
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
 * pacing appears there immediately without a full page reload - and the Overview list with it, which
 * is the other screen the new pacing belongs on. Without that second line the Overview keeps serving
 * its cached list (staleTime 30s), so a pacing created here is missing from it until the cache goes
 * stale or the page is reloaded. Same pair useTransferPacingOwner already invalidates.
 *
 * The Overview's Create Pacing modal has no campaign of its own - it passes undefined,
 * which widens the first invalidation to EVERY campaign's Pacing tab list: the new pacing's campaign
 * set is only derived server-side, so no single campaign key can be named up front.
 */
export function useCreatePacing(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PacingCreateV1) => createPacing(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: campaignId !== undefined ? ["pacing", "campaign", campaignId] : ["pacing", "campaign"],
      });
      void queryClient.invalidateQueries({ queryKey: ["pacing", "overview"] });
    },
  });
}

/**
 * The Layouts a new pacing may start from: the shared ones and the caller's own private ones, read
 * from the library the moment the create form opens (no staleTime, so a Layout shared a minute ago
 * is in the list). Two reads, the same two shelves the reference's create screen asks for.
 */
export function useCreationLayouts() {
  return useQuery({
    queryKey: ["pacing", "library", "creation-layouts"],
    queryFn: async () => {
      const [shared, mine] = await Promise.all([
        listPacingLibrary({ kind: "layout" }),
        listPacingLibrary({ kind: "layout", shelf: "mine" }),
      ]);
      return creationLayoutOptions(shared, mine);
    },
    retry: false,
  });
}
