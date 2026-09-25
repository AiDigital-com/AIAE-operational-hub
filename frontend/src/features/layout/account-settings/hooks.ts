import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccount, updateAccount } from "./account-api";
import type { PacingNotifyDestinationV1 } from "./account-api";

/**
 * The current user's stored Daily Summary delivery preference and Slack group id - seeds the
 * Account Settings modal. Disabled until the modal is open: nothing else on the Hub reads this
 * today, so there is no reason to fetch it before someone actually opens the modal.
 */
export function useAccount(enabled: boolean) {
  return useQuery({
    queryKey: ["pacing", "account"],
    queryFn: getAccount,
    enabled,
  });
}

/**
 * Saves `notifyDestination` and/or `slackChannelId` (always both - see `updateAccount`'s own doc).
 * The modal drives its own optimistic selection and rollback (there is no separate save step to
 * invalidate around); this only keeps the cached value in step so a reopened modal seeds from what
 * was actually saved, not a stale read.
 *
 * Two independent instances of this hook back the two save actions in the modal (the segmented
 * control, and the Slack group field's own Save button) so one's `isPending`/`error` never bleeds
 * into the other's - see account-settings-modal.tsx.
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    // Wrapped rather than passed by reference: React Query calls a mutationFn with (variables,
    // context), so handing it the API function directly gives that function a second argument it
    // never asked for.
    mutationFn: (vars: { notifyDestination: PacingNotifyDestinationV1; slackChannelId: string }) =>
      updateAccount(vars.notifyDestination, vars.slackChannelId),
    onSuccess: (account) => {
      queryClient.setQueryData(["pacing", "account"], account);
    },
  });
}
