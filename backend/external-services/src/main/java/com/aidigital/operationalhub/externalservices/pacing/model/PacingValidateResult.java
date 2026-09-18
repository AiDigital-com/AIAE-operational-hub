package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Pacing's {@code POST /api/pacings/validate} response body for a {@code campaign_id} selector (§8 of
 * the migration plan, US-121/122/123). Restricted to the fields the Create Pacing review screen needs;
 * Pacing's real response also carries a snake_case {@code line_items} alias of {@link #lineItems()}
 * kept only for the retired SPA - not read here.
 *
 * <p>{@code ok: false} is a normal 200 response, not an HTTP error (Pacing rejects pacing the campaign
 * as it stands today - currently only for spanning more than one non-USD currency - but this is not a
 * request failure): {@link #error()} names why.
 *
 * <p>Field-name note: Pacing's own response mixes camelCase ({@code orderNumber}, singular) with
 * snake_case ({@code order_numbers}, plural) for what are otherwise sibling fields - kept exactly as
 * Pacing sends it rather than normalized, so this record stays a faithful mirror of the wire shape.
 *
 * @param ok              false when Pacing will not let this campaign be paced as-is
 * @param error           why {@code ok} is false; null when {@code ok} is true
 * @param lineItems       serialized as {@code lineItems}; every line item NetSuite has for this campaign
 * @param insertionOrders serialized as {@code insertionOrders}; every distinct insertion order linked
 *                        to the campaign, its own fields verbatim (§8, US-122) - never a sum/min/max
 *                        derived from `lineItems`
 * @param client          advertiser/client name, as NetSuite reports it on these line items
 * @param agency          agency name, as NetSuite reports it on these line items
 * @param campaign        campaign name, as NetSuite reports it
 * @param orderNumber     the first/primary NetSuite order number found among the line items
 * @param orderNumbers    serialized as {@code order_numbers}; every distinct NetSuite order number found
 * @param notFoundIds     line item ids with no NetSuite row, or not yet delivered (excluded by default)
 * @param warnings        human-readable data-quality notes
 * @param inUse           serialized as {@code inUse}; which line items a live pacing already covers
 *                        (US-123), keyed by line item id - null when the in-use lookup was skipped or
 *                        failed (degrades to "no marks", never fails the whole validate)
 */
public record PacingValidateResult(
		boolean ok,
		String error,
		List<PacingValidateLineItem> lineItems,
		List<PacingInsertionOrder> insertionOrders,
		String client,
		String agency,
		String campaign,
		String orderNumber,
		@JsonProperty("order_numbers") List<String> orderNumbers,
		List<String> notFoundIds,
		List<String> warnings,
		Map<String, PacingInUseEntry> inUse) {
}
