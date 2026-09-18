package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One NetSuite insertion order as Pacing's {@code POST /api/pacings/validate} response returns it
 * under {@code insertionOrders} (§8 of the migration plan, US-122). One entry per distinct order
 * among the campaign's BigQuery master rows - every field here is Pacing's own row, verbatim. Never
 * a sum/min/max derived from the order's line items: that figure would disagree with NetSuite the
 * moment a line item is excluded from the review panel.
 *
 * @param orderId        serialized as {@code order_id}; NetSuite internal id for the order
 * @param orderNumber    serialized as {@code order_number}; the same value line items reference via
 *                       {@code order_number} - the review panel's grouping key
 * @param orderName      serialized as {@code order_name}; null when NetSuite has no name for this
 *                       order (the master query carries no such column today)
 * @param orderBudget    serialized as {@code order_budget}; the order's own budget, as NetSuite has it
 * @param orderStartDate serialized as {@code order_start_date}
 * @param orderEndDate   serialized as {@code order_end_date}
 * @param orderStatus    serialized as {@code order_status}
 */
public record PacingInsertionOrder(
		@JsonProperty("order_id") String orderId,
		@JsonProperty("order_number") String orderNumber,
		@JsonProperty("order_name") String orderName,
		@JsonProperty("order_budget") Double orderBudget,
		@JsonProperty("order_start_date") String orderStartDate,
		@JsonProperty("order_end_date") String orderEndDate,
		@JsonProperty("order_status") String orderStatus) {
}
