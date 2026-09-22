package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One campaign whose pacing owner does not match who NetSuite records as its team lead (§13 of the
 * migration plan, US-136, the {@code owner_diff} class of {@link PacingNsDiffReport}) — the live-report
 * counterpart of {@code PacingCampaignRef#mpoTeamLead}, matched by name the same way that field is: the
 * two systems share no key.
 *
 * @param campaignId   serialized as {@code campaign_id}; NetSuite campaign id
 * @param campaignName serialized as {@code campaign_name}; NetSuite campaign display name
 * @param ownerName    serialized as {@code owner_name}; the pacing's current owner display name
 * @param mpoTeamLead  serialized as {@code mpo_team_lead}; who NetSuite records as running this
 *                     campaign
 */
public record PacingNsDiffOwnerMismatch(
		@JsonProperty("campaign_id") String campaignId,
		@JsonProperty("campaign_name") String campaignName,
		@JsonProperty("owner_name") String ownerName,
		@JsonProperty("mpo_team_lead") String mpoTeamLead) {
}
