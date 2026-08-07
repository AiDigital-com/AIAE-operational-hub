package com.aidigital.operationalhub.service.agency.search;

import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.ReportRowMetricSql;
import com.aidigital.operationalhub.service.common.search.SearchableField;
import lombok.RequiredArgsConstructor;

/**
 * Sortable dimensions and metrics of the report-rows table. Mirrors the Reporting tab's dimension and
 * metric pickers (see {@code frontend/src/features/pacing/mock/reports.ts}'s {@code DIM_DEFS}/
 * {@code METRIC_DEFS}) - every column offered there as sortable has a constant here, under the same
 * name. Dimensions and raw (summable) metrics sort by their own column; the three derived metrics
 * (CPM/CTR/AVCR) are not stored columns at all, so they sort by the same ratio expression
 * {@link com.aidigital.operationalhub.service.agency.bigquery.service.impl.BigQueryReportRowService} derives them
 * with per row - {@link #computed()} marks those so the service knows not to column-quote them.
 */
@RequiredArgsConstructor
public enum ReportRowSortField implements SearchableField {

	/**
	 * The delivery date.
	 */
	DATE(BigQueryAdjustmentsViewColumns.DATE, false, false),

	/**
	 * The DSP/ad-server platform.
	 */
	PLATFORM(BigQueryAdjustmentsViewColumns.PLATFORM, false, false),

	/**
	 * The platform account name.
	 */
	ACCOUNT(BigQueryAdjustmentsViewColumns.ACCOUNT, false, false),

	/**
	 * The platform account id.
	 */
	ACCOUNT_ID(BigQueryAdjustmentsViewColumns.ACCOUNT_ID, false, false),

	/**
	 * The line-item-level constructed name.
	 */
	LINE_ITEM_NAME(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME, false, false),

	/**
	 * The line-item-level constructed id.
	 */
	LINE_ITEM_ID(BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID, false, false),

	/**
	 * The insertion-order-level constructed name.
	 */
	INSERTION_ORDER_NAME(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL2, false, false),

	/**
	 * The insertion-order-level constructed id.
	 */
	INSERTION_ORDER_ID(BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL2, false, false),

	/**
	 * The campaign-level constructed name.
	 */
	CAMPAIGN_CONSTRUCTED_NAME(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3, false, false),

	/**
	 * The campaign-level constructed id.
	 */
	CAMPAIGN_CONSTRUCTED_ID(BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL3, false, false),

	/**
	 * The naming-convention agency id.
	 */
	AGENCY_ID(BigQueryAdjustmentsViewColumns.CNB_AGENCY_ID, false, false),

	/**
	 * The naming-convention client name.
	 */
	CLIENT(BigQueryAdjustmentsViewColumns.CNB_CLIENT, false, false),

	/**
	 * The naming-convention industry code.
	 */
	INDUSTRY_CODE(BigQueryAdjustmentsViewColumns.CNB_INDUSTRY_CODE, false, false),

	/**
	 * The naming-convention campaign name.
	 */
	CAMPAIGN_NAME(BigQueryAdjustmentsViewColumns.CNB_CAMPAIGN_NAME, false, false),

	/**
	 * The naming-convention channel.
	 */
	CHANNEL(BigQueryAdjustmentsViewColumns.CNB_CHANNEL, false, false),

	/**
	 * The naming-convention tactic.
	 */
	TACTIC(BigQueryAdjustmentsViewColumns.CNB_TACTIC, false, false),

	/**
	 * The naming-convention buying model.
	 */
	BUYING_MODEL(BigQueryAdjustmentsViewColumns.CNB_BUYING_MODEL, false, false),

	/**
	 * The naming-convention audience.
	 */
	AUDIENCE(BigQueryAdjustmentsViewColumns.CNB_AUDIENCE, false, false),

	/**
	 * The naming-convention unique line item id.
	 */
	UNIQUE_LINE_ITEM_ID(BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID, false, false),

	/**
	 * The naming-convention "other" free-form segment.
	 */
	OTHER(BigQueryAdjustmentsViewColumns.CNB_OTHER, false, false),

	/**
	 * The naming-convention geo.
	 */
	GEO(BigQueryAdjustmentsViewColumns.CNB_GEO, false, false),

	/**
	 * The naming-convention creative tag.
	 */
	CREATIVE_TAG(BigQueryAdjustmentsViewColumns.CNB_CREATIVE_TAG, false, false),

	/**
	 * The naming-convention message.
	 */
	MESSAGE(BigQueryAdjustmentsViewColumns.CNB_MESSAGE, false, false),

	/**
	 * The naming-convention keyword group.
	 */
	KEYWORD_GROUP(BigQueryAdjustmentsViewColumns.CNB_KEYWORD_GROUP, false, false),

	/**
	 * The naming-convention flight identifier.
	 */
	FLIGHT_IDENTIFIER(BigQueryAdjustmentsViewColumns.CNB_FLIGHT_IDENTIFIER, false, false),

	/**
	 * The naming-convention language.
	 */
	LANGUAGE(BigQueryAdjustmentsViewColumns.CNB_LANGUAGE, false, false),

	/**
	 * The marker of which metrics were manually adjusted.
	 */
	ADJUSTED_METRICS(BigQueryAdjustmentsViewColumns.ADJUSTED_METRICS, false, false),

	/**
	 * The rate type (e.g. CPM).
	 */
	RATE_TYPE(BigQueryAdjustmentsViewColumns.RATE_TYPE, false, false),

	/**
	 * The free-form line item description.
	 */
	LINE_ITEM_DESCRIPTION(BigQueryAdjustmentsViewColumns.LINE_ITEM_DESCRIPTION, false, false),

	/**
	 * The row's creation timestamp.
	 */
	CREATED_AT(BigQueryAdjustmentsViewColumns.CREATED_AT, false, false),

	/**
	 * The row's creator.
	 */
	CREATED_BY(BigQueryAdjustmentsViewColumns.CREATED_BY, false, false),

	/**
	 * The row's last-modified timestamp.
	 */
	LAST_MODIFIED_AT(BigQueryAdjustmentsViewColumns.LAST_MODIFIED_AT, false, false),

	/**
	 * The row's last modifier.
	 */
	LAST_MODIFIED_BY(BigQueryAdjustmentsViewColumns.LAST_MODIFIED_BY, false, false),

	/**
	 * Delivered impressions.
	 */
	IMPRESSIONS(BigQueryAdjustmentsViewColumns.IMPRESSIONS, true, false),

	/**
	 * Delivered clicks.
	 */
	CLICKS(BigQueryAdjustmentsViewColumns.CLICKS, true, false),

	/**
	 * Delivered spend.
	 */
	SPEND(BigQueryAdjustmentsViewColumns.SPEND, true, false),

	/**
	 * Video starts.
	 */
	STARTS(BigQueryAdjustmentsViewColumns.STARTS, true, false),

	/**
	 * Video first-quartile completions.
	 */
	FIRST_QUARTILES(BigQueryAdjustmentsViewColumns.FIRST_QUARTILES, true, false),

	/**
	 * Video midpoint completions.
	 */
	MIDPOINTS(BigQueryAdjustmentsViewColumns.MIDPOINTS, true, false),

	/**
	 * Video third-quartile completions.
	 */
	THIRD_QUARTILES(BigQueryAdjustmentsViewColumns.THIRD_QUARTILES, true, false),

	/**
	 * Video completions.
	 */
	COMPLETES(BigQueryAdjustmentsViewColumns.COMPLETES, true, false),

	/**
	 * Conversions.
	 */
	CONVERSIONS(BigQueryAdjustmentsViewColumns.CONVERSIONS, true, false),

	/**
	 * Post-click conversions.
	 */
	POST_CLICK_CONVERSIONS(BigQueryAdjustmentsViewColumns.POST_CLICK_CONVERSIONS, true, false),

	/**
	 * Post-view conversions.
	 */
	POST_VIEW_CONVERSIONS(BigQueryAdjustmentsViewColumns.POST_VIEW_CONVERSIONS, true, false),

	/**
	 * Rate-card (dynamic) cost.
	 */
	DYNAMIC_COST(BigQueryAdjustmentsViewColumns.DYNAMIC_COST, true, false),

	/**
	 * Link clicks.
	 */
	LINK_CLICKS(BigQueryAdjustmentsViewColumns.LINK_CLICKS, true, false),

	/**
	 * The rate-card (dynamic) rate. A stored column per row, but a ratio all the same, so a group
	 * re-derives it from summed cost over summed billable units instead of averaging the rows' rates.
	 */
	DYNAMIC_RATE(BigQueryAdjustmentsViewColumns.DYNAMIC_RATE, true, false, ReportRowMetricSql.GROUPED_DYNAMIC_RATE),

	/**
	 * The average dynamic rate by date and tactic.
	 *
	 * <p>Averaged over a group rather than summed, because the value already is an average - the view
	 * computes it per (agency, client, campaign, tactic, date). Summing it would report a figure no rate
	 * card contains. Legal only because the grouped query aggregates the joined subquery's column and not
	 * the view's window function, which BigQuery rejects as an aggregate of an aggregate.
	 */
	AVG_DYNAMIC_RATE_BY_DATE_TACTIC(
			BigQueryAdjustmentsViewColumns.AVG_DYNAMIC_RATE_BY_DATE_TACTIC,
			true,
			false,
			BqSql.avg(BigQueryAdjustmentsViewColumns.AVG_DYNAMIC_RATE_BY_DATE_TACTIC)),

	/**
	 * CPM, derived rather than stored - null-safe via {@code SAFE_DIVIDE}, matching
	 * {@code BigQueryReportRowService#toTotals}'s own null-when-zero rule.
	 */
	CPM(ReportRowMetricSql.CPM, true, true, ReportRowMetricSql.GROUPED_CPM),

	/**
	 * CPC, derived rather than stored: media cost per click.
	 */
	CPC(ReportRowMetricSql.CPC, true, true, ReportRowMetricSql.GROUPED_CPC),

	/**
	 * CPV, derived rather than stored: media cost per view, counting a view as a start.
	 */
	CPV(ReportRowMetricSql.CPV, true, true, ReportRowMetricSql.GROUPED_CPV),

	/**
	 * Modelled invalid traffic, derived rather than stored - a count of impressions, summed over a group.
	 */
	IVT(ReportRowMetricSql.IVT, true, true, ReportRowMetricSql.GROUPED_IVT),

	/**
	 * CTR, derived rather than stored.
	 */
	CTR(ReportRowMetricSql.CTR, true, true, ReportRowMetricSql.GROUPED_CTR),

	/**
	 * AVCR, derived rather than stored.
	 */
	AVCR(ReportRowMetricSql.AVCR, true, true, ReportRowMetricSql.GROUPED_AVCR);

	private final String expression;
	private final boolean numeric;
	private final boolean computed;
	private final String groupedExpression;

	/**
	 * A field whose grouped form is the service's default for its kind - {@code SUM} for a metric, the
	 * bare column for a dimension.
	 *
	 * @param expression the column name, or a ready-to-embed expression when {@code computed}
	 * @param numeric    whether the field is a metric
	 * @param computed   whether {@code expression} is already a complete SQL expression
	 */
	ReportRowSortField(String expression, boolean numeric, boolean computed) {
		this(expression, numeric, computed, null);
	}

	@Override
	public String expression() {
		return expression;
	}

	@Override
	public boolean numeric() {
		return numeric;
	}

	/**
	 * Whether {@link #expression()} is already a complete, ready-to-embed SQL expression (a derived
	 * metric's ratio) rather than a bare column name that still needs backtick-quoting.
	 *
	 * @return {@code true} for the derived metrics (CPM/CPC/CPV/CTR/AVCR), {@code false} for every
	 *         column-backed dimension or raw metric
	 */
	public boolean computed() {
		return computed;
	}

	/**
	 * The form this field takes under a {@code GROUP BY}, for the fields whose grouped value is not
	 * simply the sum of the rows beneath it: the ratios, which re-derive from summed components.
	 *
	 * @return the grouped SQL expression, or {@code null} to use the caller's default for this kind of
	 *         field
	 */
	public String groupedExpression() {
		return groupedExpression;
	}
}
