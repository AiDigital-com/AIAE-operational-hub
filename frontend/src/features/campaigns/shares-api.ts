import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { components } from "../../shared/api/generated/schema";

export type CampaignShareV1 = components["schemas"]["CampaignShareV1"];
export type CampaignShareListV1 = components["schemas"]["CampaignShareListV1"];
export type CampaignShareCandidateV1 = components["schemas"]["CampaignShareCandidateV1"];

/**
 * Campaign sharing - "Add people" on a campaign (2026-10-20).
 *
 * A share gives a Hub user from any team the campaign and every pacing under it, until it is
 * removed. Every rule - who may share, who may be shared with - is the Hub backend's; this side
 * forwards, and shows a refusal in the words it came with.
 */

/** Who the campaign is shared with, plus whether the current user may change that. */
export async function listCampaignShares(campaignId: number): Promise<CampaignShareListV1> {
  const result = await apiClient.GET("/api/v1/campaigns/{campaignId}/shares", {
    params: { path: { campaignId } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/** The people the campaign could be shared with, narrowed by a name or email fragment. */
export async function listShareCandidates(campaignId: number, q: string): Promise<CampaignShareCandidateV1[]> {
  const result = await apiClient.GET("/api/v1/campaigns/{campaignId}/shares/candidates", {
    params: { path: { campaignId }, query: q ? { q } : {} },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.candidates ?? [];
}

/** Shares the campaign with a Hub user. */
export async function createCampaignShare(campaignId: number, hubUserId: number): Promise<void> {
  const result = await apiClient.POST("/api/v1/campaigns/{campaignId}/shares", {
    params: { path: { campaignId } },
    body: { hubUserId },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/** Removes a user's share of the campaign. Immediate. */
export async function deleteCampaignShare(campaignId: number, hubUserId: number): Promise<void> {
  const result = await apiClient.DELETE("/api/v1/campaigns/{campaignId}/shares/{hubUserId}", {
    params: { path: { campaignId, hubUserId } },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}
