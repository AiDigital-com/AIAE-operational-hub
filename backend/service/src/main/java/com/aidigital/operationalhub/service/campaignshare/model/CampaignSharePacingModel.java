package com.aidigital.operationalhub.service.campaignshare.model;

import java.util.List;

/**
 * A pacing a person owns on a campaign, as the "Remove" confirmation lists them: each one is handed
 * whole to the person removing them, every campaign it spans included.
 *
 * @param pacingId   Pacing's own UUID primary key
 * @param dashSlug   the dashboard slug
 * @param pacingName the display name
 * @param campaigns  every campaign the pacing covers, in Pacing's stored order
 */
public record CampaignSharePacingModel(
		String pacingId, String dashSlug, String pacingName, List<CampaignSharePacingCampaignModel> campaigns) {

	public CampaignSharePacingModel {
		campaigns = campaigns == null ? List.of() : List.copyOf(campaigns);
	}
}
