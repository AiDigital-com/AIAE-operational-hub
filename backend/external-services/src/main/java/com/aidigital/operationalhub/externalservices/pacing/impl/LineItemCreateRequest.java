package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of one line item in the {@code POST /api/pacings} request body (§8, US-123/124) - field
 * names match dash-gate's own create route exactly, same snake_case-field convention as the other
 * outbound request records in this package (e.g. {@link DisplaySettingsRequest}).
 *
 * @param line_item_id        NetSuite line item id
 * @param channel             delivery channel / media tactic
 * @param flight_start        flight start date (YYYY-MM-DD)
 * @param flight_end          flight end date (YYYY-MM-DD)
 * @param rate_type           billing rate type (CPM/CPC/CPV/Flat)
 * @param native_budget       the budget in its native currency
 * @param description         line item description
 * @param currency            the line item's native currency
 * @param exchange_rate       the exchange rate for {@code currency}
 * @param campaign_id         NetSuite campaign id
 * @param campaign_name       NetSuite campaign name
 * @param order_number        NetSuite insertion order number
 * @param mpo_team_lead       who NetSuite records as running the campaign (§11, US-132), stored so
 *                            the new pacing can show the owner-vs-NetSuite comparison at once
 * @param target_impressions  the plan's target impressions, as confirmed by the caller
 * @param margin_percent      the plan's target margin percentage, as confirmed by the caller
 * @param target_ctr          the plan's target CTR percentage, as confirmed by the caller
 * @param target_vcr          the plan's target VCR percentage, as confirmed by the caller
 */
record LineItemCreateRequest(
		String line_item_id,
		String channel,
		String flight_start,
		String flight_end,
		String rate_type,
		Double native_budget,
		String description,
		String currency,
		Double exchange_rate,
		String campaign_id,
		String campaign_name,
		String order_number,
		String mpo_team_lead,
		Double target_impressions,
		Double margin_percent,
		Double target_ctr,
		Double target_vcr) {
}
