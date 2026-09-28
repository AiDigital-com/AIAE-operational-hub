package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * Shape of the {@code POST /api/pacings} request body (§8, US-123).
 *
 * <p>NON_NULL, for {@link DataNamespaceRequest}'s reason: the {@code RestClient}'s default Jackson
 * converter serializes nulls, and Pacing's create route gates the two order-number keys on
 * presence ({@code if (insertionOrderId) ...}) - a pacing whose line items carry no IO number must
 * send NEITHER key, not explicit nulls.
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
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record CreateRequest(
		String pacing_name,
		List<LineItemCreateRequest> line_items,
		String insertion_order_id,
		List<String> order_numbers) {
}
