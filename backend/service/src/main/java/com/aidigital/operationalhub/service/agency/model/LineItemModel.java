package com.aidigital.operationalhub.service.agency.model;

/**
 * Immutable view of one NetSuite line item within an insertion order, sourced from BigQuery.
 *
 * <p>There is no per-line-item status column in the source table - a line item's status is its
 * parent {@link InsertionOrderModel}'s {@code status}.
 *
 * @param lineItemId  the BigQuery line item id
 * @param description the line item's free-form description, may be {@code null}
 * @param mediaTactic the line item's media tactic / channel, may be {@code null}
 * @param rateType    the line item's rate type, may be {@code null}
 * @param budget      the line item's own tactic budget, may be {@code null}
 * @param startDate   the line item's flight start date (ISO format), may be {@code null}
 * @param endDate     the line item's flight end date (ISO format), may be {@code null}
 * @since 1.0
 */
public record LineItemModel(
		Long lineItemId,
		String description,
		String mediaTactic,
		String rateType,
		Double budget,
		String startDate,
		String endDate) {

}
