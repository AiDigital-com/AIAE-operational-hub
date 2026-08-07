package com.aidigital.operationalhub.service.dashboard.model;

import java.util.List;

/**
 * Dashboard dataset narrowing applied to preview reads and BigQuery source writes.
 *
 * <p>Date bounds are separate from value-list filters for the same reason as reporting rows: a date range is
 * an interval, not a checklist of every date in a campaign.
 *
 * @param filters  additive output-column filters
 * @param dateFrom inclusive first dataset date as {@code yyyy-MM-dd}, or {@code null}
 * @param dateTo   inclusive last dataset date as {@code yyyy-MM-dd}, or {@code null}
 */
public record DashboardDatasetCriteria(
		List<DashboardDatasetFilter> filters, String dateFrom, String dateTo) {

	public DashboardDatasetCriteria {
		filters = filters == null ? List.of() : List.copyOf(filters);
		dateFrom = blankToNull(dateFrom);
		dateTo = blankToNull(dateTo);
	}

	/**
	 * The empty criteria - no narrowing at all.
	 *
	 * @return criteria with no filters and no date bounds
	 */
	public static DashboardDatasetCriteria none() {
		return new DashboardDatasetCriteria(List.of(), null, null);
	}

	/**
	 * Whether a date bound is present.
	 *
	 * @return {@code true} when at least one bound is set
	 */
	public boolean hasDateRange() {
		return dateFrom != null || dateTo != null;
	}

	private static String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value.trim();
	}
}
