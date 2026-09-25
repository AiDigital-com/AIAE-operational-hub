import { ApiError } from "../../../shared/api/api-error";
import { apiClient } from "../../../shared/api/client";
import { formatError } from "../../../shared/format/error";
import type { components } from "../../../shared/api/generated/schema";

export type PacingAccountV1 = components["schemas"]["PacingAccountV1"];
export type PacingNotifyDestinationV1 = components["schemas"]["PacingNotifyDestinationV1"];

/**
 * The current user's own Pacing account preferences (Account Settings, "Daily Summary").
 *
 * Pacing owns and validates both fields. `notifyDestination` is `auto` | `dm` | `off`, unchecked
 * here. `slackChannelId` is the person's own private Slack group - `auto` delivers there, falling
 * back to a direct message when it is empty; Pacing checks a CHANGED value against Slack itself
 * before storing it (see `updateAccount`'s own doc for what a refusal or a warning looks like).
 */

/** The current user's stored Daily Summary delivery preference and Slack group id. */
export async function getAccount(): Promise<PacingAccountV1> {
  const result = await apiClient.GET("/api/v1/pacing/account", {});
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Saves the Daily Summary delivery preference and/or the Slack group id. Always send BOTH - the
 * one not being changed is round-tripped from the last `getAccount`/`updateAccount` result, taken
 * from the same object the modal already has - because Pacing only re-verifies `slackChannelId`
 * against Slack when the value actually changes, so a stale group cannot block an unrelated
 * `notifyDestination` change (or vice versa).
 *
 * A `slackChannelId` Pacing cannot verify (wrong id, not private, the bot or the person not a
 * member) rejects with a 400 whose message names which and why (surfaced via `ApiError.message`,
 * see `formatError`). A value Pacing could not check at all (Slack itself unreachable) still
 * saves - watch for `slackWarning` on the returned account, which explains why it was not
 * confirmed to work yet.
 *
 * @returns what Pacing now has stored.
 */
export async function updateAccount(
  notifyDestination: PacingNotifyDestinationV1,
  slackChannelId: string
): Promise<PacingAccountV1> {
  const result = await apiClient.PATCH("/api/v1/pacing/account", { body: { notifyDestination, slackChannelId } });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}
