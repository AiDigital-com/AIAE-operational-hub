import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { components } from "../../shared/api/generated/schema";

export type CampaignShareV1 = components["schemas"]["CampaignShareV1"];
export type CampaignShareListV1 = components["schemas"]["CampaignShareListV1"];
export type CampaignShareCandidateV1 = components["schemas"]["CampaignShareCandidateV1"];
export type CampaignSharePacingV1 = components["schemas"]["CampaignSharePacingV1"];
export type CampaignAccessContactsV1 = components["schemas"]["CampaignAccessContactsV1"];

/**
 * Campaign sharing - "Add people" on a campaign (2026-10-20).
 *
 * A share gives a Hub user from any team the campaign and every pacing under it, until it is
 * removed. Every rule - who may share, who may be shared with - is the Hub backend's; this side
 * forwards, and shows a refusal in the words it came with.
 *
 * Removing someone who owns pacings on the campaign (2026-10-23) hands those pacings to the remover
 * first - whole, every campaign they span - so the UI lists them (`listShareOwnedPacings`) and asks
 * before sending the delete with `transferPacings`.
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

/** The pacings a person on the campaign owns that touch it - what removing them would hand to the caller. */
export async function listShareOwnedPacings(campaignId: number, hubUserId: number): Promise<CampaignSharePacingV1[]> {
  const result = await apiClient.GET("/api/v1/campaigns/{campaignId}/shares/{hubUserId}/pacings", {
    params: { path: { campaignId, hubUserId } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.pacings ?? [];
}

/**
 * Removes a user's share of the campaign. Immediate. With `transferPacings` the caller has confirmed
 * taking over the pacings this person owns here; without it the backend answers 409 for that case.
 */
export async function deleteCampaignShare(campaignId: number, hubUserId: number, transferPacings = false): Promise<void> {
  const result = await apiClient.DELETE("/api/v1/campaigns/{campaignId}/shares/{hubUserId}", {
    params: { path: { campaignId, hubUserId }, query: transferPacings ? { transferPacings: true } : {} },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/**
 * Who to ask for access to a campaign the user cannot open: the Team Lead(s) NetSuite records on it
 * and the Hub people who can add them. Not gated by the user's visibility - it is what the "no access"
 * screen reads.
 */
export async function listCampaignAccessContacts(campaignId: number): Promise<CampaignAccessContactsV1> {
  const result = await apiClient.GET("/api/v1/campaigns/{campaignId}/access-contacts", {
    params: { path: { campaignId } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}
