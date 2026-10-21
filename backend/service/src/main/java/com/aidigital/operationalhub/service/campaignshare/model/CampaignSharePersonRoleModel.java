package com.aidigital.operationalhub.service.campaignshare.model;

/**
 * A person's current Hub role, as the "Add people" lists describe them under the name - what tells
 * fourteen Darias apart.
 *
 * @param roleName the active role's display name ("MPO Manager", "Team Lead"), or {@code null} when
 *                 the person holds no role
 * @param teamName the team the role is scoped to, or {@code null} when the role is not team-scoped
 */
public record CampaignSharePersonRoleModel(String roleName, String teamName) {

	/**
	 * The description of someone with no active role.
	 *
	 * @return a role-less description
	 */
	public static CampaignSharePersonRoleModel none() {
		return new CampaignSharePersonRoleModel(null, null);
	}
}
