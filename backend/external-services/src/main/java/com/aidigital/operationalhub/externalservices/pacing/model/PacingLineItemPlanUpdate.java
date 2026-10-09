package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;
import java.util.Map;

/**
 * One line item's plan to save on {@code POST /api/dashboards/:slug/settings} (§9 of the migration
 * plan, US-125/126/127) - the editable counterpart of {@link PacingLineItemPlan}. Carried from the
 * generated {@code PacingLineItemPlanUpdateV1} request DTO into the external-services layer unchanged,
 * same reason {@link PacingCreateLineItem} exists: so {@link com.aidigital.operationalhub
 * .externalservices.pacing.PacingClient}'s interface does not depend on the generated API model.
 *
 * <p>Every field here is forwarded to Pacing exactly as received; none is computed, summed or
 * validated beyond what Pacing itself enforces. A field left {@code null} on an id already on the
 * pacing is preserved from Pacing's own stored value (its {@code channel}/{@code description}/
 * {@code campaignId}/{@code campaignName} in particular, which this screen never edits) - a field left
 * null on a NEW id (one not currently on the pacing) simply has nothing to submit, which is why
 * {@code channel}/{@code flightStart}/{@code flightEnd} are the caller's responsibility to supply for
 * that case (see the OpenAPI schema's own description).
 *
 * @param lineItemId        NetSuite line item id
 * @param channel           delivery channel / media tactic; required when adding a new id
 * @param description       line item description
 * @param campaignId        NetSuite campaign id
 * @param campaignName      NetSuite campaign name
 * @param orderNumber       NetSuite insertion order number
 * @param rateType          billing rate type (CPM/CPC/CPV/Flat)
 * @param nativeBudget      the plan's target spend, in the line item's native currency
 * @param targetImpressions the plan's target impressions
 * @param marginPercent     the plan's target margin percentage
 * @param targetCtr         the plan's target CTR percentage
 * @param targetVcr         the plan's target VCR percentage
 * @param flightStart       flight start date (YYYY-MM-DD); required when adding a new id
 * @param flightEnd         flight end date (YYYY-MM-DD); required when adding a new id
 * @param costCoef          coefficient margin mode for this line item (Pacing's per-LI {@code
 *                          cost_coef}): client cost becomes spend / (1 - margin), resolved per fact
 *                          row. {@code true} sets it, {@code false} clears it, null leaves the
 *                          stored flag alone - {@code cost_coef} is outside Pacing's
 *                          {@code PLAN_OWNED} set, so its merge keeps any key the wire omits. Sent
 *                          only while the pacing's coefficient switch is on
 * @param netRatio          net cost mode (Pacing spec 2026-09-07): a real ratio in (0,1) to set,
 *                          exactly 1 to clear a stored ratio, null to leave it alone (the key is
 *                          omitted from the wire)
 * @param netRatioLocked    whether the ratio is locked against NetSuite refreshes; carried together
 *                          with {@code netRatio} (both or neither)
 * @param primaryConversions primary conversions (Pacing spec 2026-09-13 §2): the conversion actions
 *                            this line item counts as ITS conversions. Sent only when the list
 *                            actually changed as a set against what Pacing reported; an untouched
 *                            line item omits it and Pacing's key-presence back-fill preserves the
 *                            stored choice. An explicit empty list is the deliberate clear
 * @param containers        date-based plan overrides (§9), opaque - forwarded byte-for-byte; Pacing is
 *                          the only party that parses or validates their shape (container existence,
 *                          the target-impressions bound against this line item's own plan)
 */
public record PacingLineItemPlanUpdate(
		String lineItemId,
		String channel,
		String description,
		String campaignId,
		String campaignName,
		String orderNumber,
		String rateType,
		Double nativeBudget,
		Double targetImpressions,
		Double marginPercent,
		Double targetCtr,
		Double targetVcr,
		String flightStart,
		String flightEnd,
		Boolean costCoef,
		Double netRatio,
		Boolean netRatioLocked,
		List<String> primaryConversions,
		List<Map<String, Object>> containers) {
}
