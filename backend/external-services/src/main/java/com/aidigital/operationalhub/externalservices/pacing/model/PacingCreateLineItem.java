package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One line item to submit on {@code POST /api/pacings} (§8 of the migration plan, US-123/124): its
 * NetSuite facts plus whatever plan edits the caller made before confirming. Carried from the
 * generated {@code PacingCreateLineItemV1} request DTO into the external-services layer unchanged -
 * this record exists so {@link com.aidigital.operationalhub.externalservices.pacing.PacingClient}'s
 * interface does not depend on the generated API model.
 *
 * <p>Every field here is forwarded to Pacing exactly as received; none is computed, defaulted or
 * validated beyond what Pacing itself enforces (required {@code flightStart}/{@code flightEnd} per
 * line item, a non-empty line item list, at most one non-USD currency across them).
 *
 * @param lineItemId        NetSuite line item id
 * @param channel           delivery channel / media tactic
 * @param flightStart       flight start date (YYYY-MM-DD)
 * @param flightEnd         flight end date (YYYY-MM-DD)
 * @param rateType          billing rate type (CPM/CPC/CPV/Flat)
 * @param description       line item description
 * @param nativeBudget      the budget in its native currency - Pacing re-derives the USD cache from
 *                          this and the campaign's detected rate; the Hub never computes that itself
 * @param currency          the line item's native currency (e.g. USD, CAD)
 * @param exchangeRate      the exchange rate for {@code currency}
 * @param campaignId        NetSuite campaign id
 * @param campaignName      NetSuite campaign name
 * @param orderNumber       NetSuite insertion order number
 * @param mpoTeamLead        who NetSuite records as running this campaign (§11, US-132). Carried
 *                           through create so the new pacing can show the owner-vs-NetSuite
 *                           comparison from its first minute, rather than blank until the
 *                           nightly refresh or a manual revalidate fills it in.
 * @param targetImpressions the plan's target impressions, as confirmed by the caller
 * @param marginPercent     the plan's target margin percentage, as confirmed by the caller
 * @param targetCtr         the plan's target CTR percentage, as confirmed by the caller
 * @param targetVcr         the plan's target VCR percentage, as confirmed by the caller
 */
public record PacingCreateLineItem(
		String lineItemId,
		String channel,
		String flightStart,
		String flightEnd,
		String rateType,
		String description,
		Double nativeBudget,
		String currency,
		Double exchangeRate,
		String campaignId,
		String campaignName,
		String orderNumber,
		String mpoTeamLead,
		Double targetImpressions,
		Double marginPercent,
		Double targetCtr,
		Double targetVcr) {
}
