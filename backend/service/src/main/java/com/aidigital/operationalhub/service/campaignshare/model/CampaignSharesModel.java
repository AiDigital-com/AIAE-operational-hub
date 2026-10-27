package com.aidigital.operationalhub.service.campaignshare.model;

import java.util.List;

/**
 * A campaign's shares together with whether the current user may change them.
 *
 * @param canShare   whether the current user may add or remove people on this campaign
 * @param shares     the people the campaign is shared with, oldest first
 * @param teamAccess the people who see it through a team that owns its agency, by name; nobody in
 *                   {@code shares} is repeated here
 */
public record CampaignSharesModel(
		boolean canShare, List<CampaignShareModel> shares, List<CampaignShareCandidateModel> teamAccess) {

	public CampaignSharesModel {
		shares = shares == null ? List.of() : List.copyOf(shares);
		teamAccess = teamAccess == null ? List.of() : List.copyOf(teamAccess);
	}
}
