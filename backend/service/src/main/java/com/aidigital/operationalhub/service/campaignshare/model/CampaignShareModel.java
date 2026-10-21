package com.aidigital.operationalhub.service.campaignshare.model;

import java.time.LocalDateTime;

/**
 * One person a campaign is shared with, as the campaign's "people" list shows them.
 *
 * @param hubUserId     the recipient's {@code hub_users.id}
 * @param fullName      the recipient's display name
 * @param email         the recipient's email
 * @param role          the recipient's current Hub role and team
 * @param grantedByName the display name of whoever shared it
 * @param createdAt     when it was shared (UTC)
 */
public record CampaignShareModel(
		Long hubUserId,
		String fullName,
		String email,
		CampaignSharePersonRoleModel role,
		String grantedByName,
		LocalDateTime createdAt) {

	public CampaignShareModel {
		role = role == null ? CampaignSharePersonRoleModel.none() : role;
	}
}
