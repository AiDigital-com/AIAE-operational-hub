package com.aidigital.operationalhub.service.dashboard.model;

import java.util.List;

/**
 * The full (non-paged) result of a dashboard dataset export, capped at a fixed row limit rather than
 * omitted entirely - the same reasoning as the report-rows export: the expensive part of reading a
 * dashboard's dataset is running the query at all, not the pagination the preview endpoint otherwise
 * applies, so a bounded full read is the correct shape for a "Download" action.
 *
 * @param rows          the matching rows, up to the export cap
 * @param truncated     {@code true} when more rows matched than the cap allows, so the caller can warn the
 *                      user the download is incomplete
 * @param campaignName  the resolved campaign's name, for building a human-readable download filename
 * @param dashboardName the dashboard's own name, for the same filename, without a second lookup
 * @param columns       which optional columns (creative, CPA) the dashboard currently keeps, so the
 *                      workbook's column set matches the preview table it was downloaded from
 * @param columnOrder   the dashboard's saved on-screen column arrangement, or empty for the template's
 *                      default order
 */
public record DashboardDatasetExportModel(
		List<DashboardDatasetRow> rows,
		boolean truncated,
		String campaignName,
		String dashboardName,
		DashboardColumnChoice columns,
		List<String> columnOrder) {
}
