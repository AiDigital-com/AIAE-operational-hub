package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * The full (non-paged) result of a report-rows export, capped at a fixed row limit rather than
 * omitted entirely - the expensive operation the report-rows endpoint's own pagination design avoids
 * is a full {@code COUNT(*)}, not reading rows, so a bounded full read is the correct behaviour for a
 * "download report" action.
 *
 * @param rows         the matching rows, up to the export cap
 * @param truncated    {@code true} when more rows matched than the cap allows, so the caller can warn
 *                     the user the download is incomplete
 * @param campaignName the resolved campaign's name, for building a human-readable download filename
 *                     without a second campaign lookup
 * @param totals       the same full-dataset totals the on-screen report shows, so the download states
 *                     the campaign's CPM rather than leaving the reader to average the column - and get
 *                     a different, unweighted answer. Over the whole filtered dataset, so it still holds
 *                     when {@code truncated} is {@code true}.
 */
public record ReportRowExportModel(
		List<ReportRowModel> rows, boolean truncated, String campaignName, ReportRowTotalsModel totals) {
}
