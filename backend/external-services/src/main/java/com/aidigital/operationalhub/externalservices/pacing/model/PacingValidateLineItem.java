package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One NetSuite line item as Pacing's {@code POST /api/pacings/validate} returns it (§8 of the
 * migration plan, US-121/122/123/124). Pacing's real row also carries a duplicate {@code id} field
 * (kept for the retired SPA's own compatibility) - not read here since {@code lineItemId} is the same
 * value.
 *
 * @param lineItemId    serialized as {@code line_item_id}
 * @param channel       serialized as {@code channel}; delivery channel / media tactic
 * @param flightStart   serialized as {@code flight_start}
 * @param flightEnd     serialized as {@code flight_end}
 * @param rateType      serialized as {@code rate_type}; billing rate type (CPM/CPC/CPV/Flat)
 * @param description   line item description, as NetSuite has it
 * @param budgetTotal   serialized as {@code budget_total}; the line item's budget converted to USD
 * @param nativeBudget  serialized as {@code native_budget}; the budget in its native currency - the
 *                      money figure the create screen edits and submits (US-124)
 * @param plannedUnits  serialized as {@code planned_units}; NetSuite's own reference unit count
 *                      (labelled "MP Units" on the retired create screen) - deliberately a different
 *                      field from the stored plan's target impressions (US-124's whole point)
 * @param currency      the line item's native currency (e.g. USD, CAD)
 * @param exchangeRate  serialized as {@code exchange_rate}
 * @param converted     whether this line item's native currency differs from USD
 * @param campaignId    serialized as {@code campaign_id}
 * @param campaignName  serialized as {@code campaign_name}
 * @param orderNumber   serialized as {@code order_number}; the NetSuite insertion order this line item
 *                      belongs to - the grouping key for the review panel (US-122)
 * @param mrgSource     serialized as {@code mrg_source}; the target margin reference hint (may carry a
 *                      null value - see {@link PacingMrgSource})
 * @param kpiSource     serialized as {@code kpi_source}; the target CTR/VCR reference hint (may carry
 *                      null values - see {@link PacingKpiSource})
 */
public record PacingValidateLineItem(
		@JsonProperty("line_item_id") String lineItemId,
		String channel,
		@JsonProperty("flight_start") String flightStart,
		@JsonProperty("flight_end") String flightEnd,
		@JsonProperty("rate_type") String rateType,
		String description,
		@JsonProperty("budget_total") Double budgetTotal,
		@JsonProperty("native_budget") Double nativeBudget,
		@JsonProperty("planned_units") Double plannedUnits,
		String currency,
		@JsonProperty("exchange_rate") Double exchangeRate,
		boolean converted,
		@JsonProperty("campaign_id") String campaignId,
		@JsonProperty("campaign_name") String campaignName,
		@JsonProperty("order_number") String orderNumber,
		@JsonProperty("mrg_source") PacingMrgSource mrgSource,
		@JsonProperty("kpi_source") PacingKpiSource kpiSource) {
}
