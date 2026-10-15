package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * What Pacing's last build measured of a pacing's Delivery tab, as {@code deliveryStats} on
 * {@code GET /api/dashboards/:slug/data}. The Data tab reads it to refuse switching the tab on when
 * it would pass Pacing's cell cap (3,000,000 cells), which is the cap the build itself enforces.
 *
 * @param rows       rows the last built Delivery tab held
 * @param cells      rows × columns of the last built Delivery tab
 * @param measuredAt when the measurement was taken (ISO timestamp)
 * @param autoOffAt  when the cap last switched the tab off; null once a person switches it back on
 */
public record PacingDeliveryStats(
		Long rows,
		Long cells,
		String measuredAt,
		String autoOffAt) {
}
