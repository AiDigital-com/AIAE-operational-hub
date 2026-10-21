package com.aidigital.operationalhub.service.campaignshare.model;

import java.util.List;

/**
 * A campaign's shares together with whether the current user may change them.
 *
 * @param canShare whether the current user may add or remove people on this campaign
 * @param shares   the people the campaign is shared with, oldest first
 */
public record CampaignSharesModel(boolean canShare, List<CampaignShareModel> shares) {

	public CampaignSharesModel {
		shares = shares == null ? List.of() : List.copyOf(shares);
	}
}
