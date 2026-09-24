import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { components } from "../../shared/api/generated/schema";

export type PacingDelegationV1 = components["schemas"]["PacingDelegationV1"];
export type PacingDelegationCreateV1 = components["schemas"]["PacingDelegationCreateV1"];

/**
 * Delegations (§12 of the migration plan, US-133/134/135).
 *
 * Every rule a delegation is subject to - at most 30 days, no delegating to yourself, no duplicate
 * live grants - is enforced by Pacing, as database constraints. Nothing here re-checks them: the
 * refusals come back as messages and are shown as they are written. The one thing this side does is
 * bound the date picker at 30 days, so the common case never needs a refusal at all.
 */

/** The delegations in force for the current user - granted and received. Pacing filters out revoked
 *  and expired rows, so anything in this list is live right now. */
export async function listDelegations(): Promise<PacingDelegationV1[]> {
  const result = await apiClient.GET("/api/v1/pacing/delegations", {});
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.delegations ?? [];
}

/** Grants a delegation. An empty `pacingIds` means everything the delegator owns. */
export async function createDelegation(body: PacingDelegationCreateV1): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/delegations", { body });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/** Extends a live delegation's end date. */
export async function extendDelegation(delegationId: string, expiresAt: string): Promise<void> {
  const result = await apiClient.PATCH("/api/v1/pacing/delegations/{delegationId}", {
    params: { path: { delegationId } },
    body: { expiresAt },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/** Revokes a delegation. Immediate; Pacing keeps the record. */
export async function revokeDelegation(delegationId: string): Promise<void> {
  const result = await apiClient.DELETE("/api/v1/pacing/delegations/{delegationId}", {
    params: { path: { delegationId } },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}
