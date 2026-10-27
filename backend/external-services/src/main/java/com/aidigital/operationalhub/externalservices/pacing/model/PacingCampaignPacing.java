package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * One pacing as Pacing's campaign-access routes describe it ({@code GET /api/internal/campaign-pacings},
 * {@code GET /api/internal/pacings/:id}): identity, owner, and the campaigns it covers.
 *
 * @param pacingId    Pacing's own UUID primary key
 * @param dashSlug    the dashboard slug
 * @param pacingName  the display name
 * @param status      {@code Live}, {@code Paused}, {@code Complete} or {@code Archive}
 * @param ownerId     the owner's Pacing user id, or {@code null} for an ownerless pacing
 * @param campaigns   the campaigns the pacing covers, in Pacing's stored order; a campaign's name is
 *                    {@code null} when Pacing only knows its id
 */
public record PacingCampaignPacing(
		@JsonProperty("pacing_id") String pacingId,
		@JsonProperty("dash_slug") String dashSlug,
		@JsonProperty("pacing_name") String pacingName,
		String status,
		@JsonProperty("owner_id") String ownerId,
		List<PacingCampaignRef> campaigns) {

	public PacingCampaignPacing {
		campaigns = campaigns == null ? List.of() : List.copyOf(campaigns);
	}
}
