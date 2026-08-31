package com.aidigital.operationalhub.service.agency.model;

/**
 * How many Hub-owned adjustment overlay rows a "Roll back adjustments" call removed, or - for a preview -
 * would remove, from each of the two adjustment tables.
 *
 * @param deliveryRowsRemoved   the number of delivery ({@code platform_mart_operational_hub_adjustements})
 *                              overlay rows removed, or that would be removed
 * @param conversionRowsRemoved the number of conversions
 *                              ({@code conversions_mart_operational_hub_adjustments}) overlay rows
 *                              removed, or that would be removed
 */
public record AdjustmentRollbackResultModel(long deliveryRowsRemoved, long conversionRowsRemoved) {
}
