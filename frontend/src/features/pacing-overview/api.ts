import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { AssignableOwnerListV1, PacingListResponseV1 } from "./types";

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function requireData<T>(result: ApiResult<T>): T {
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * The whole Overview list in one call (US-109) — the Hub resolves the caller's RBAC scope into a
 * Pacing assertion, signs it, and returns whatever Pacing answers. Never paginated and never
 * refetched per row: every column this screen shows comes from this one response.
 */
export async function listPacingOverview(): Promise<PacingListResponseV1> {
  return requireData(await apiClient.GET("/api/v1/pacing/pacings", {}));
}

/**
 * A campaign's Pacing tab (§5 of the migration plan, US-112): every pacing whose stored campaign set
 * contains this campaign, same row shape as the Overview list — a pacing here may itself list more
 * than one campaign, since coverage is "contains", not "belongs exclusively to".
 */
export async function listCampaignPacings(campaignId: number): Promise<PacingListResponseV1> {
  return requireData(
    await apiClient.GET("/api/v1/campaigns/{campaignId}/pacings", {
      params: { path: { campaignId } },
    })
  );
}

/**
 * Who the current user may hand a pacing to (§11, US-131).
 *
 * The same set their Pacing scope already filters this list by — what you can see, you can assign
 * to. Fetched once and reused across rows rather than per row: it does not vary by pacing.
 */
export async function listAssignableOwners(): Promise<AssignableOwnerListV1> {
  return requireData(await apiClient.GET("/api/v1/pacing/assignable-owners", {}));
}

/**
 * Reassigns a pacing (§11, US-131).
 *
 * Pacing is the one that decides whether the move is allowed and journals who made it; a refusal
 * (the recipient is outside the caller's scope) surfaces here as a thrown ApiError, never as a
 * silent no-op that leaves the row looking reassigned.
 */
export async function transferPacingOwner(pacingId: string, newOwnerId: string): Promise<void> {
  const result = await apiClient.PATCH("/api/v1/pacing/pacings/{pacingId}/owner", {
    params: { path: { pacingId } },
    body: { newOwnerId },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}
