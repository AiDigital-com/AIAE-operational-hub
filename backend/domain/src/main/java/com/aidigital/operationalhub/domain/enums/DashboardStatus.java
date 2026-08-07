package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Dashboard status codes for {@code hub_dashboards.status}.
 *
 * <p>Values are persisted as TEXT columns; this enum centralizes the code without using PostgreSQL
 * enum types.
 *
 * <p>The status follows the data source and nothing else: a dashboard is Draft until its BigQuery table has
 * been written and Live once it has. It is stored rather than derived only so a list of dashboards can be
 * rendered without reading every row's table reference.
 */
@Getter
@RequiredArgsConstructor
public enum DashboardStatus {

	/**
	 * Configured but with no data source written yet - nothing for ClicData to point at.
	 */
	DRAFT("draft"),

	/**
	 * A data source exists in BigQuery and its table name can be copied into ClicData.
	 */
	LIVE("live");

	private final String code;
}
