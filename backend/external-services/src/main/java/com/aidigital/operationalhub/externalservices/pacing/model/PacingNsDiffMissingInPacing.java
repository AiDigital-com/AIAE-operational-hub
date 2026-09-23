package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One NetSuite line item not yet added to this pacing (§13 of the migration plan, US-136, the
 * {@code missing_in_pacing} class of {@link PacingNsDiffReport}) — the full NetSuite-side shape,
 * enough to review and add it, unlike {@link PacingNsDiffMissingInNetsuite} which only needs to
 * name what Pacing already has.
 *
 * @param lineItemId   serialized as {@code line_item_id}
 * @param campaignId   serialized as {@code campaign_id}; NetSuite campaign id
 * @param campaignName serialized as {@code campaign_name}; NetSuite campaign display name
 * @param orderNumber  serialized as {@code order_number}; NetSuite insertion order number
 * @param channel      delivery channel / media tactic
 * @param rateType     serialized as {@code rate_type}; billing rate type (CPM/CPC/CPV/Flat)
 * @param nativeBudget serialized as {@code native_budget}; the budget in its native currency
 * @param plannedUnits serialized as {@code planned_units}; the plan's target impressions/units
 * @param flightStart  serialized as {@code flight_start} (YYYY-MM-DD)
 * @param flightEnd    serialized as {@code flight_end} (YYYY-MM-DD)
 * @param description  line item description
 * @param coveredBy    serialized as {@code covered_by}; the OTHER Live pacing of the same
 *                     campaign that already carries this line item, or null when nobody does.
 *                     NOTHING IS FILTERED because of this - the entry stays in the list either
 *                     way (US-136: the reader decides what to correct, not this response). Only
 *                     the Overview badge counts covered entries out; the full list here always
 *                     shows both groups, per {@link PacingNsDiffCoveredBy}'s own doc comment.
 */
public record PacingNsDiffMissingInPacing(
		@JsonProperty("line_item_id") String lineItemId,
		@JsonProperty("campaign_id") String campaignId,
		@JsonProperty("campaign_name") String campaignName,
		@JsonProperty("order_number") String orderNumber,
		String channel,
		@JsonProperty("rate_type") String rateType,
		@JsonProperty("native_budget") Double nativeBudget,
		@JsonProperty("planned_units") Double plannedUnits,
		@JsonProperty("flight_start") String flightStart,
		@JsonProperty("flight_end") String flightEnd,
		String description,
		@JsonProperty("covered_by") PacingNsDiffCoveredBy coveredBy) {
}
