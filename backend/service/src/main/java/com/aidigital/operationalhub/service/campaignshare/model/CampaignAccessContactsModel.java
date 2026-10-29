package com.aidigital.operationalhub.service.campaignshare.model;

import java.util.List;

/**
 * Who to ask for access to a campaign.
 *
 * @param campaignName      the campaign name, for the request the person sends; may be {@code null}
 * @param netSuiteTeamLeads the Team Lead names NetSuite records on the campaign, as NetSuite spells them
 * @param runningTeamFound  whether NetSuite's lead resolved to a Hub team: {@code contacts} is then that
 *                          team's people; otherwise it is the leads of every team owning the agency
 * @param contacts          the Hub people who can add the caller, Team Lead(s) first; empty when no team
 *                          owns the campaign's agency
 */
public record CampaignAccessContactsModel(
		String campaignName,
		List<String> netSuiteTeamLeads,
		boolean runningTeamFound,
		List<CampaignShareCandidateModel> contacts) {

	public CampaignAccessContactsModel {
		netSuiteTeamLeads = netSuiteTeamLeads == null ? List.of() : List.copyOf(netSuiteTeamLeads);
		contacts = contacts == null ? List.of() : List.copyOf(contacts);
	}
}
