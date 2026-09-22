package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One line item whose NetSuite campaign does not match the campaign(s) this pacing is stored under
 * (§13 of the migration plan, US-136, the {@code foreign_campaign} class of {@link PacingNsDiffReport}).
 *
 * @param lineItemId              serialized as {@code line_item_id}
 * @param pacingCampaignId        serialized as {@code pacing_campaign_id}; the campaign id stored on
 *                                the Pacing side for this line item
 * @param netsuiteCampaignId      serialized as {@code netsuite_campaign_id}; the campaign id NetSuite
 *                                reports for this line item
 * @param netsuiteCampaignName    serialized as {@code netsuite_campaign_name}; that campaign's display
 *                                name, for showing what the line item actually belongs to
 * @param inPacingCampaignSet     serialized as {@code in_pacing_campaign_set}; whether the NetSuite
 *                                campaign is at least one of this pacing's own campaigns (§3's ordered
 *                                campaign set), even if not the one this line item itself is stored
 *                                under
 */
public record PacingNsDiffForeignCampaign(
		@JsonProperty("line_item_id") String lineItemId,
		@JsonProperty("pacing_campaign_id") String pacingCampaignId,
		@JsonProperty("netsuite_campaign_id") String netsuiteCampaignId,
		@JsonProperty("netsuite_campaign_name") String netsuiteCampaignName,
		@JsonProperty("in_pacing_campaign_set") boolean inPacingCampaignSet) {
}
