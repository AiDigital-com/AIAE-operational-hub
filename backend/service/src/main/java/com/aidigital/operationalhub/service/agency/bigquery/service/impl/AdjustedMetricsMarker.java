package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.COMPLETES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DYNAMIC_COST;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.FIRST_QUARTILES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.IMPRESSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LINK_CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.MIDPOINTS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.SPEND;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.STARTS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.THIRD_QUARTILES;

/**
 * Derives the {@code adjusted_metrics} write-table marker server-side from which stored metrics an
 * {@link AdjustmentRowModel} actually carries a value for, instead of trusting a client-supplied marker
 * string (the inline-edit path used to take {@code adjusted_metrics} verbatim from the request, letting
 * any caller of the adjustments endpoint write arbitrary text into that BigQuery column).
 *
 * <p>Byte-identical to the value the client used to send: {@code stagedMetrics} on the frontend and
 * {@code diffLong}/{@code diffDouble} in the bulk-upload path each add a metric id to the "changed" set
 * if and only if they also set that metric non-null, so "the set of changed ids" and "the set of
 * non-null metric components" are the same set on every path. The one difference is an empty result -
 * this renders {@code ""} rather than {@code null} - which the read side already treats as equivalent
 * ({@code NULLIF(TRIM(x), '')} in {@code ReportRowConversionsSql}).
 *
 * <p>What this value is <em>not</em>: a report value. The adjustments view never reads the marker back
 * out of the write table - it recomputes it by diffing the adjustment against the base mart, and stamps
 * a manually added line with the literal {@code 'Non-existent data'} instead (see
 * {@link com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns#ADJUSTED_METRICS}
 * for the full mechanics). Nothing a report displays depends on what is derived here. It is written
 * because the write table is the Hub's own record of what it changed and is queried directly, so an
 * arbitrary or client-supplied string in that column is a data-quality defect even when no report shows it.
 */
@Component
class AdjustedMetricsMarker {

	/**
	 * Derives the comma-joined marker of which metric components an adjustment row carries a value for,
	 * in the canonical order {@link BigQueryReportRowService#adjustmentColumns()} writes the underlying
	 * metric columns in.
	 *
	 * @param adjustment the adjustment row being written
	 * @return the comma-joined column ids of the metric components that are non-null; empty (never
	 *         {@code null}) when none are set
	 */
	String derive(AdjustmentRowModel adjustment) {
		List<String> changed = new ArrayList<>();
		addIfPresent(changed, IMPRESSIONS, adjustment.impressions());
		addIfPresent(changed, CLICKS, adjustment.clicks());
		addIfPresent(changed, SPEND, adjustment.spend());
		addIfPresent(changed, STARTS, adjustment.starts());
		addIfPresent(changed, FIRST_QUARTILES, adjustment.firstQuartiles());
		addIfPresent(changed, MIDPOINTS, adjustment.midpoints());
		addIfPresent(changed, THIRD_QUARTILES, adjustment.thirdQuartiles());
		addIfPresent(changed, COMPLETES, adjustment.completes());
		addIfPresent(changed, DYNAMIC_COST, adjustment.dynamicCost());
		addIfPresent(changed, LINK_CLICKS, adjustment.linkClicks());
		return String.join(",", changed);
	}

	/**
	 * Appends {@code columnId} to {@code changed} when the given metric component actually carries a
	 * value, so a metric explicitly left {@code null} (unchanged) never appears in the derived marker.
	 *
	 * @param changed  the ordered list of column ids to append to
	 * @param columnId the metric's write-table column id
	 * @param value    the metric component's value, or {@code null} when not adjusted
	 */
	void addIfPresent(List<String> changed, String columnId, Object value) {
		if (value != null) {
			changed.add(columnId);
		}
	}
}
