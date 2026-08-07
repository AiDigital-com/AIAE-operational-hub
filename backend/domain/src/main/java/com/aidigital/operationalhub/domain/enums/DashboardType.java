package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Dashboard type codes for {@code hub_dashboards.type}.
 *
 * <p>The type is the schema: it decides which dimensions and metrics the data source carries. Every other
 * type the product plans - Conversions, Geo, Keywords, Business outcomes, Live Sports, Device, Genre,
 * Demographics - is listed in the UI as coming soon (US-016) and deliberately absent here: an enum value
 * with no schema behind it would let a dashboard be created that nothing can write.
 */
@Getter
@RequiredArgsConstructor
public enum DashboardType {

	/**
	 * The standard template's Basic report: 18 dimensions and 12 metrics, as the ClicData template expects.
	 */
	BASIC("basic");

	private final String code;
}
