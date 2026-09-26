package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;
import java.util.Map;

/**
 * Shape of one line item in the plan-only {@code POST /api/dashboards/:slug/settings} request body
 * (§9, US-125/126/127) - field names match dash-gate's own settings route exactly, same
 * snake_case-field convention as {@link LineItemCreateRequest}. {@code containers} rides through
 * as opaque JSON: Jackson serializes each entry's {@code Map<String, Object>} verbatim, so a
 * client-built {@code __action}/{@code __source_id}/{@code __scale} duplicate-container marker
 * (dash-gate's own existing duplicate mechanism) reaches Pacing unchanged.
 *
 * @param line_item_id        NetSuite line item id
 * @param channel             delivery channel / media tactic; required when adding a new id
 * @param description         line item description
 * @param campaign_id         NetSuite campaign id
 * @param campaign_name       NetSuite campaign name
 * @param order_number        NetSuite insertion order number
 * @param rate_type           billing rate type (CPM/CPC/CPV/Flat)
 * @param native_budget       the plan's target spend, in the line item's native currency
 * @param target_impressions  the plan's target impressions
 * @param margin_percent      the plan's target margin percentage
 * @param target_ctr          the plan's target CTR percentage
 * @param target_vcr          the plan's target VCR percentage
 * @param flight_start        flight start date (YYYY-MM-DD); required when adding a new id
 * @param flight_end          flight end date (YYYY-MM-DD); required when adding a new id
 * @param containers          date-based plan overrides (§9), opaque - forwarded byte-for-byte
 */
// NON_NULL (not the class-wide default of always-include): dash-gate's own merge checks
// `'channel' in newLi` / `'description' in newLi` / `'campaign_id' in newLi` /
// `'campaign_name' in newLi` to decide whether to PRESERVE the stored value for an id already on
// the pacing (db.mjs saveSettings) - a JSON key present with an explicit null answers that check
// true and would overwrite the stored value with null, the opposite of "the Hub never edits this
// field for an existing line item" (PacingLineItemPlanUpdateV1's own contract). The Hub leaves
// these four null for every id it did not just look up fresh (an existing line item's plan edit),
// so they must be OMITTED, not nulled, whenever that happens.
@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
record LineItemPlanUpdateRequest(
		String line_item_id,
		String channel,
		String description,
		String campaign_id,
		String campaign_name,
		String order_number,
		String rate_type,
		Double native_budget,
		Double target_impressions,
		Double margin_percent,
		Double target_ctr,
		Double target_vcr,
		String flight_start,
		String flight_end,
		List<Map<String, Object>> containers) {
}
