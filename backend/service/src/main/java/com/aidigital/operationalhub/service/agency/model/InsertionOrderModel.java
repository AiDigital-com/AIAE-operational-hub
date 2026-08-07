package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * Immutable view of one NetSuite insertion order (IO) and its real line items, sourced from BigQuery.
 *
 * <p>One model per distinct {@code order_id}. The order-level fields ({@code orderNumber},
 * {@code status}, dates, {@code budget}) are read once per order, never summed or repeated across its
 * line items - the source table stores them identically on every line-item row of that order.
 *
 * @param orderId       the BigQuery order id
 * @param orderNumber   the order's human-readable number, may be {@code null}
 * @param status        the order's real NetSuite status, may be {@code null}
 * @param startDate     the order's flight start date (ISO format), may be {@code null}
 * @param endDate       the order's flight end date (ISO format), may be {@code null}
 * @param budget        the order's own budget, read once - never a per-row sum, may be {@code null}
 * @param mediaTactics  the order's line items' distinct media tactics, in first-seen order, never
 *                      {@code null}
 * @param lineItems     the order's real line items, in {@code line_item_id} order, never {@code null}
 * @since 1.0
 */
public record InsertionOrderModel(
		Long orderId,
		String orderNumber,
		String status,
		String startDate,
		String endDate,
		Double budget,
		List<String> mediaTactics,
		List<LineItemModel> lineItems) {

}
