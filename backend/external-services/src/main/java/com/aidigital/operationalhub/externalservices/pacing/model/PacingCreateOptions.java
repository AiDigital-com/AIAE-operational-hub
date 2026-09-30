package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * The optional create-time extras of {@code POST /api/pacings}, beyond the pacing name and its line
 * items (the standalone create screen's settings block, plus the client/agency pair every create
 * path should send). Every field may be null: Pacing gates each of these keys on PRESENCE, so a null
 * here means "omit the key from the wire body", never "send null" - see {@code CreateRequest}'s
 * {@code @JsonInclude} note.
 *
 * @param campaigns     the pinned campaign ORDER (NetSuite campaign ids, first = primary - the
 *                      campaign the Hub navigates to when the pacing is opened). Pacing derives the
 *                      set itself from the line items; this only reorders it ({@code applyPinnedOrder}
 *                      ignores ids outside the derived set)
 * @param client        advertiser/client name as the draft reported it - without it a Hub-created
 *                      pacing has no {@code config_json.client} until a revalidate
 * @param agency        agency name as the draft reported it - {@code client}'s twin
 * @param data          the {@code config.data} namespace (BQ source + optional extras)
 * @param rate          create-time exchange-rate override (USD per one unit of the campaign's
 *                      currency); honoured by Pacing only for a non-USD campaign
 * @param rateLocked    true when the caller set {@code rate} by hand; read by Pacing only when
 *                      {@code rate} is sent
 * @param campaignLinks reference links to seed {@code config_json.campaign_links} with
 * @param campaignNotes free-text campaign notes ({@code config_json.campaign_notes})
 */
public record PacingCreateOptions(
		List<String> campaigns,
		String client,
		String agency,
		PacingCreateData data,
		Double rate,
		Boolean rateLocked,
		List<PacingCampaignLink> campaignLinks,
		String campaignNotes) {
}
