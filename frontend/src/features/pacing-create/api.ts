import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { PacingCreateResultV1, PacingCreateV1, PacingDraftV1 } from "./types";

/**
 * A campaign's insertion orders and line items for the Create Pacing review panel (§8 of the
 * migration plan, US-121/122/123) - fetched live, no search step. Every plan figure on the returned
 * line items (target impressions, margin, CTR/VCR, budget, rate type) is exactly what Pacing/NetSuite
 * supplied; this call computes nothing.
 */
export async function getPacingDraft(campaignId: number): Promise<PacingDraftV1> {
  const result = await apiClient.GET("/api/v1/campaigns/{campaignId}/pacing-draft", {
    params: { path: { campaignId } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Creates a pacing from the selected, reviewed line items (§8, US-123/124). `body.lineItems` carries
 * exactly what the caller confirmed on screen, edits included - nothing here is recomputed.
 */
export async function createPacing(body: PacingCreateV1): Promise<PacingCreateResultV1> {
  const result = await apiClient.POST("/api/v1/pacing/pacings", { body });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}
