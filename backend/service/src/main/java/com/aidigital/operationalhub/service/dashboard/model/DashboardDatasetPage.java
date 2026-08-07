package com.aidigital.operationalhub.service.dashboard.model;

import java.util.List;

/**
 * One filtered page of dashboard data-source preview rows.
 *
 * @param pageNumber    one-based page number
 * @param pageSize      requested page size after server caps
 * @param totalElements total matching rows
 * @param totalPages    total matching pages
 * @param content       rows on this page
 */
public record DashboardDatasetPage(
		int pageNumber,
		int pageSize,
		long totalElements,
		int totalPages,
		List<DashboardDatasetRow> content) {
}
