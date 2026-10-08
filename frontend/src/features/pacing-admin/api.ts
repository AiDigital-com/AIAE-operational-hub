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
import type {
  PacingOrderNumberBackfillResultV1,
  PacingReferenceSyncResultV1,
  PacingRetryAfterV1,
  PacingRevalidateResultV1,
  RefreshAllOutcome,
} from "./types";

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

/**
 * Fills the missing campaign-level IO number on every pacing that lacks one, from the order
 * numbers already stored on its own line items - purely local to Pacing's database, no NetSuite
 * or BigQuery behind it. Synchronous, unlike `refreshAllDashboards`: the 200 carries the run's
 * final summary. Fill-only and idempotent on the Pacing side, so pressing it twice is safe - the
 * second run just reports zero filled.
 */
export async function backfillOrderNumbers(): Promise<PacingOrderNumberBackfillResultV1> {
  const result = await apiClient.POST("/api/v1/pacing/admin/backfill-order-numbers", {});
  if (result.error || !result.response.ok || !result.data) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Pulls the reference workbook into Pacing's lookup tables now - the per-tactic target margin and
 * CTR/VCR a new pacing is pre-filled from, plus Namebuilder's agency/industry/dropdown lists.
 *
 * Exists for the window a deploy opens: Pacing re-reads NSMapping when it boots but waits for a
 * daily hour to re-read Margin+KPI, and a pacing created in between is born with the create
 * screen's fallback margin baked into its stored plan - which no later sync repairs.
 *
 * Note the contract: a 200 can carry `ok: false`. One half may fail while the other writes, so the
 * caller must read the body rather than treat "no error thrown" as success.
 */
export async function syncReferenceData(): Promise<PacingReferenceSyncResultV1> {
  const result = await apiClient.POST("/api/v1/pacing/admin/sync-reference-data", {});
  if (result.error || !result.response.ok || !result.data) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Re-pulls a pacing's configuration (margin, targets, flight dates, channel, and - only where the
 * pacing has none - client/agency, campaigns, currency) from the NetSuite master. Delivery data is
 * untouched. A run that finds nothing to change comes back as a normal result with `changed: false`,
 * not an error; the calling screen decides how to say so.
 */
export async function revalidatePacing(pacingId: string): Promise<PacingRevalidateResultV1> {
  const result = await apiClient.POST("/api/v1/pacing/admin/pacings/{pacingId}/revalidate", {
    params: { path: { pacingId } },
  });
  if (result.error || !result.response.ok || !result.data) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}
