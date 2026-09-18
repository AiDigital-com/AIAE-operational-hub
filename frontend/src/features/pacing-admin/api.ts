/**
 * BFF passthrough for the pacing administration screen (not in the migration plan - the plan's
 * seventeen sections skip it entirely - but carried over from the retired Pacing front end's own
 * Admin screen: deleting a mistakenly created pacing, and re-running the nightly Daily Build
 * off-schedule). Both actions are admin-only on the Hub side too (`PacingAdminController`
 * enforces `requireAdmin` before ever calling Pacing) - this module adds no confirmation or
 * permission logic of its own, only the request/response shape.
 */
import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { PacingRetryAfterV1, RefreshAllOutcome } from "./types";

/**
 * Permanently deletes a pacing. Irreversible: Pacing removes the row (cascading to its journal) and
 * the dashboard data file + slug directory from disk - there is no soft delete and no undo. No
 * confirmation happens here; that lives entirely in the calling screen.
 */
export async function deletePacing(pacingId: string): Promise<void> {
  const result = await apiClient.DELETE("/api/v1/pacing/admin/pacings/{pacingId}", {
    params: { path: { pacingId } },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/**
 * Triggers the full nightly Daily Build off-schedule. Fire-and-forget on the Pacing side: a 200 here
 * means "started", never "finished" - the same shape as pacing-dashboard's single-pacing refresh
 * (US-119). A 429 inside Pacing's own cooldown is not thrown - it is returned as a countdown outcome
 * so the caller can show the remaining seconds instead of a bare error.
 */
export async function refreshAllDashboards(): Promise<RefreshAllOutcome> {
  const result = await apiClient.POST("/api/v1/pacing/admin/refresh-all-dashboards", {});
  if (result.response.status === 429) {
    const retryAfterSeconds = (result.error as PacingRetryAfterV1 | undefined)?.retryAfterSeconds ?? 300;
    return { status: "cooldown", retryAfterSeconds };
  }
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "started" };
}
