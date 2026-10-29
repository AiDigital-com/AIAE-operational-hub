package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * Who NetSuite says runs a campaign: its name, its agency and the {@code mpo_team_lead} names on its
 * line items.
 *
 * @param campaignId    the BigQuery campaign id
 * @param campaignName  the campaign name, may be {@code null}
 * @param agencyId      the agency id, may be {@code null}
 * @param mpoTeamLeads  the distinct Team Lead names, as NetSuite spells them; never {@code null}
 * @since 1.0
 */
public record CampaignTeamLeadsModel(
		Long campaignId, String campaignName, Long agencyId, List<String> mpoTeamLeads) {

	public CampaignTeamLeadsModel {
		mpoTeamLeads = mpoTeamLeads == null ? List.of() : List.copyOf(mpoTeamLeads);
	}
}
