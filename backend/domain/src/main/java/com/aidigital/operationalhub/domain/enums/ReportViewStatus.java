package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Report view status codes for {@code hub_report_views.status}.
 *
 * <p>Values are persisted as TEXT columns; this enum centralizes the code without using PostgreSQL
 * enum types.
 */
@Getter
@RequiredArgsConstructor
public enum ReportViewStatus {

	/**
	 * An unsaved, in-progress report configuration.
	 */
	DRAFT("draft"),

	/**
	 * A report configuration the user has explicitly saved.
	 */
	SAVED("saved");

	private final String code;
}
