package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Report view type codes for {@code hub_report_views.type}.
 *
 * <p>Values are persisted as TEXT columns; this enum centralizes the code without using PostgreSQL
 * enum types. Only "basic" is supported today - other types (Conversions, Geo, ...) are shown as
 * "Coming soon" in the UI and are not yet backed by a real report type.
 */
@Getter
@RequiredArgsConstructor
public enum ReportViewType {

	/**
	 * The only report type currently supported.
	 */
	BASIC("basic");

	private final String code;
}
