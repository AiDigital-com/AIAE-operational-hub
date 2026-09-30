package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * Shape of the {@code POST /api/pacings} request body (§8, US-123).
 *
 * <p>NON_NULL, for {@link DataNamespaceRequest}'s reason: the {@code RestClient}'s default Jackson
 * converter serializes nulls, and Pacing's create route gates every optional key here on presence
 * ({@code if (insertionOrderId) ...}, {@code if (body.client) ...}, {@code if (Array.isArray(
 * body.campaign_links)) ...}, and {@code body.rate != null} for the rate override) - an untouched
 * setting must send NO key, not an explicit null.
 *
 * <p>The order-number pair mirrors the retired SPA's create form exactly (its
 * {@code CreatePacing.jsx} submit): {@code insertion_order_id} travels whenever any line item
 * carries a number - for a multi-IO campaign it holds the FIRST one, which is what Pacing's legacy
 * display path ({@code buildCampaign}'s {@code orderNumber}) reads - and {@code order_numbers}
 * travels only when there is more than one, carrying them all.
 *
 * @param pacing_name        display name for the new pacing
 * @param line_items         the selected line items
 * @param insertion_order_id the first distinct order number across the line items, verbatim; null
 *                           (omitted) when no line item carries one
 * @param order_numbers      every distinct order number in first-appearance order; null (omitted)
 *                           unless there is more than one
 * @param client             advertiser/client name from the draft; null (omitted) when unknown -
 *                           Pacing stores it as {@code config_json.client}
 * @param agency             agency name from the draft, {@code client}'s twin
 * @param campaigns          the pinned campaign order (ids; first = primary). Pacing's
 *                           {@code applyPinnedOrder} reorders its own derived set by this and
 *                           ignores unknown ids - it can never add or drop a campaign
 * @param data               the {@code config.data} namespace; null (omitted) leaves Pacing's
 *                           defaults to apply
 * @param rate               create-time exchange-rate override, honoured only for a non-USD campaign
 * @param rate_locked        whether the caller set {@code rate} by hand; read by Pacing only when
 *                           {@code rate} travels
 * @param campaign_links     reference links to seed {@code config_json.campaign_links}; stored
 *                           verbatim by Pacing, so the Hub validates them before this is built
 * @param campaign_notes     free-text campaign notes ({@code config_json.campaign_notes})
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record CreateRequest(
		String pacing_name,
		List<LineItemCreateRequest> line_items,
		String insertion_order_id,
		List<String> order_numbers,
		String client,
		String agency,
		List<String> campaigns,
		DataCreateRequest data,
		Double rate,
		Boolean rate_locked,
		List<PacingCampaignLink> campaign_links,
		String campaign_notes) {
}
