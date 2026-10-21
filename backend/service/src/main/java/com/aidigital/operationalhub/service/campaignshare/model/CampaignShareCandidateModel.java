package com.aidigital.operationalhub.service.campaignshare.model;

/**
 * A Hub user a campaign could be shared with, as the "Add people" picker lists them.
 *
 * @param hubUserId the user's {@code hub_users.id}
 * @param fullName  the user's display name
 * @param email     the user's email
 * @param role      the user's current Hub role and team
 */
public record CampaignShareCandidateModel(
		Long hubUserId, String fullName, String email, CampaignSharePersonRoleModel role) {

	public CampaignShareCandidateModel {
		role = role == null ? CampaignSharePersonRoleModel.none() : role;
	}
}
