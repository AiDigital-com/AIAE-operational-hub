package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.AdjustmentRoundTripLimits;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.ReportRowService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.ReportRowMetricSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ACCOUNT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ACCOUNT_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ADJUSTED_METRICS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.AVG_DYNAMIC_RATE_BY_DATE_TACTIC;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_AGENCY_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_AUDIENCE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_BUYING_MODEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CAMPAIGN_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CHANNEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CLIENT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CREATIVE_TAG;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_FLIGHT_IDENTIFIER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_GEO;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_INDUSTRY_CODE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_KEYWORD_GROUP;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_LANGUAGE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_MESSAGE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_OTHER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_TACTIC;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.COMPLETES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL2;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL3;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL2;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CREATED_AT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CREATED_BY;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DYNAMIC_COST;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DYNAMIC_RATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.FIRST_QUARTILES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.IMPRESSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LAST_MODIFIED_AT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LAST_MODIFIED_BY;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LINE_ITEM_DESCRIPTION;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LINK_CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.MIDPOINTS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.PLATFORM;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.POST_CLICK_CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.POST_VIEW_CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.RATE_TYPE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.SPEND;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.STARTS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.THIRD_QUARTILES;

/**
 * BigQuery-backed implementation of {@link ReportRowService}.
 *
 * <p>The campaign is first resolved (and its visibility to the current user enforced) through the
 * existing {@link CampaignService}; its name and client name are then matched against
 * {@code CNB_campaign_name}/{@code CNB_client} in {@code platform_mart_adjustments_view_op_hub} — the
 * view has no numeric id shared with the Hub's own campaign id, so this name match is the join key
 * (see 01-MIGRATION-PLAN.md §0b).
 */
@Service
@RequiredArgsConstructor
public class BigQueryReportRowService implements ReportRowService {

	/** Alias for the modelled-IVT expression - it has no column of its own in the view. */
	private static final String ALIAS_IVT = "ivt";
	// The five derived ratios are selected, not computed by the caller. Each is gated to the channels it
	// means anything on (see ReportRowMetricSql), and that gate cannot be reproduced downstream without
	// copying the channel lists into a second language - which is how three implementations of CPM came
	// to disagree in the first place.
	private static final String ALIAS_CPM = "cpm";
	private static final String ALIAS_CPC = "cpc";
	private static final String ALIAS_CPV = "cpv";
	private static final String ALIAS_CTR = "ctr";
	private static final String ALIAS_AVCR = "avcr";
	private static final String ALIAS_MIN_DATE = "min_date";
	private static final String ALIAS_MAX_DATE = "max_date";
	private static final String ALIAS_DISTINCT_LINE_ITEMS = "distinct_line_items";
	// Not a metric name on purpose: a grouped read sorts by this alias, and a name that collided with a
	// selected metric would be shadowed by it (see groupedOrderBy).
	private static final String ALIAS_SORT_VALUE = "sort_value";
	private static final int DISTINCT_VALUES_LIMIT = 500;
	// The expensive thing the report-rows pagination design avoids is a full COUNT(*) - not reading
	// rows - so a bounded full read is the correct behaviour for a "download report" export.
	//
	// Bounded rather than open-ended because the whole result is materialized before a byte is written:
	// BigQuery hands back a row map per row, this maps each into a model, and only then does the
	// workbook writer start. The writer itself is streamed (SXSSF, a 100-row window), so the ceiling is
	// this list, not the file. The number is a judgement call about how large a single download may get,
	// not a hard limit of anything.
	//
	// The shared round-trip ceiling, not a local choice: the bulk-adjustment template IS this export - the
	// user downloads it, edits it, uploads it back - so the export and the parser have to agree, and now
	// they read the same constant instead of two literals kept in step by comment.
	private static final int EXPORT_ROW_CAP = AdjustmentRoundTripLimits.MAX_ROWS;
	// An aggregate query with no GROUP BY always returns exactly one row from BigQuery (zero matches
	// just means every SUM/MIN/MAX is null and COUNT(DISTINCT ...) is 0) - this is only a defensive
	// fallback.
	private static final BqRow EMPTY_AGGREGATE_ROW = new BqRow(Map.of());
	// Pagination must be stable even when the visible sort column has many ties. Raw rows can use the
	// report row identity directly, while grouped rows build their tie-breaker from selected dimensions.
	private static final List<ReportRowSortField> RAW_ORDER_TIEBREAKERS = List.of(
			ReportRowSortField.DATE,
			ReportRowSortField.LINE_ITEM_ID,
			ReportRowSortField.PLATFORM,
			ReportRowSortField.ACCOUNT,
			ReportRowSortField.ACCOUNT_ID,
			ReportRowSortField.LINE_ITEM_NAME,
			ReportRowSortField.INSERTION_ORDER_NAME,
			ReportRowSortField.INSERTION_ORDER_ID,
			ReportRowSortField.CAMPAIGN_CONSTRUCTED_NAME,
			ReportRowSortField.CAMPAIGN_CONSTRUCTED_ID,
			ReportRowSortField.CHANNEL,
			ReportRowSortField.TACTIC,
			ReportRowSortField.BUYING_MODEL,
			ReportRowSortField.AUDIENCE,
			ReportRowSortField.UNIQUE_LINE_ITEM_ID,
			ReportRowSortField.OTHER,
			ReportRowSortField.GEO,
			ReportRowSortField.CREATIVE_TAG,
			ReportRowSortField.MESSAGE,
			ReportRowSortField.KEYWORD_GROUP,
			ReportRowSortField.FLIGHT_IDENTIFIER,
			ReportRowSortField.LANGUAGE,
			ReportRowSortField.LINE_ITEM_DESCRIPTION);

	private final BigQuerySearchGateway gateway;
	private final BigQueryWriteGateway writeGateway;
	private final BigQueryProperties bigQueryProperties;
	private final CampaignService campaignService;
	private final CampaignMartClientResolver clientResolver;

	@Override
	public ReportRowPageModel findReportRows(
			CurrentUserModel user, long campaignId, int pageNumber, int pageSize,
			List<ReportRowSortField> dimensions, SortCriterion<ReportRowSortField> sort,
			List<ReportRowFilterModel> filters, ReportRowDateRangeModel dateRange) {
		CampaignModel campaign = reportMartCampaign(resolveCampaign(user, campaignId));
		ReportRowSortField field = resolveSortField(sort);

		int offset = Math.max((pageNumber - 1) * pageSize, 0);
		// The row count rides along on the data query as a window function rather than costing a job of
		// its own: it is evaluated after GROUP BY and before LIMIT, so it counts the groups a grouped
		// read returns and the rows a raw one does, over the same scan the page is already paying for.
		BqRequest.Builder dataQuery = dataQuery(campaign, dimensions, field, sort, filters, dateRange)
				.withTotalRowCount()
				.limitOffset(pageSize + 1, offset);
		List<BqRow> fetched = gateway.fetchCached(dataQuery.build(), row -> row);
		boolean hasNext = fetched.size() > pageSize;
		List<ReportRowModel> content =
				(hasNext ? fetched.subList(0, pageSize) : fetched).stream().map(this::toReportRow).toList();
		// Every row carries the same total; an empty page has none to read it from.
		long totalRows = fetched.isEmpty() ? 0L : orZero(fetched.get(0).getLong(BqRequest.TOTAL_ALIAS));

		BqRow aggregateRow = fetchAggregate(campaign, filters, dateRange);

		return new ReportRowPageModel(
				content, pageNumber, pageSize, hasNext, totalRows,
				toTotals(aggregateRow), aggregateRow.getString(ALIAS_MIN_DATE), aggregateRow.getString(ALIAS_MAX_DATE),
				orZero(aggregateRow.getLong(ALIAS_DISTINCT_LINE_ITEMS)));
	}

	@Override
	public ReportRowExportModel exportReportRows(
			CurrentUserModel user, long campaignId, List<ReportRowSortField> dimensions,
			SortCriterion<ReportRowSortField> sort, List<ReportRowFilterModel> filters,
			ReportRowDateRangeModel dateRange) {
		CampaignModel campaign = reportMartCampaign(resolveCampaign(user, campaignId));
		ReportRowSortField field = resolveSortField(sort);
		BqRequest dataQuery = dataQuery(campaign, dimensions, field, sort, filters, dateRange)
				.limitOffset(EXPORT_ROW_CAP + 1, 0)
				.build();
		List<ReportRowModel> fetched = gateway.fetch(dataQuery, this::toReportRow);
		boolean truncated = fetched.size() > EXPORT_ROW_CAP;
		List<ReportRowModel> rows = truncated ? fetched.subList(0, EXPORT_ROW_CAP) : fetched;
		return new ReportRowExportModel(
				rows, truncated, campaign.name(), toTotals(fetchAggregate(campaign, filters, dateRange)));
	}

	/**
	 * The one full-dataset aggregate row behind a report: every metric's total, plus the delivery window
	 * and the distinct level-1 count the totals row states beside them. Always over the filtered dataset
	 * as a whole, never the page or the export's capped slice, and never grouped - the totals answer
	 * "across everything this report matches", whatever grain the rows below are shown at.
	 *
	 * <p>The page and the export read it through this one method, select list included, and that is the
	 * point rather than a convenience: the rendered SQL is the cache key, so a download taken while
	 * looking at a report reuses the aggregate the page already ran instead of paying for a second
	 * BigQuery job - and, more importantly, cannot come back with a different number than the screen.
	 *
	 * @param campaign  the resolved campaign
	 * @param filters   the requested filters; never {@code null}, may be empty
	 * @param dateRange the delivery-date window; never {@code null}, may be empty
	 * @return the aggregate row, or an all-null row when BigQuery returned none
	 */
	BqRow fetchAggregate(
			CampaignModel campaign, List<ReportRowFilterModel> filters, ReportRowDateRangeModel dateRange) {
		// Over the joined rows, not the view: the totals row states the same conversions the rows beneath
		// it add up to, and those come from the conversions mart. Aggregating the view directly would
		// total the delivery mart's own conversion columns, which the report does not show.
		BqRequest request = selectAggregatedMetrics(
				new BqRequest.Builder().from(joinedRows(campaign, filters, dateRange).build()))
				.selectMin(DATE, ALIAS_MIN_DATE)
				.selectMax(DATE, ALIAS_MAX_DATE)
				.selectCountDistinct(CONSTRUCTED_ID, ALIAS_DISTINCT_LINE_ITEMS)
				.build();
		return gateway.fetchCached(request, row -> row).stream().findFirst().orElse(EMPTY_AGGREGATE_ROW);
	}

	/**
	 * This campaign's conversions, summed over their actions down to the grain the delivery mart shares
	 * with them: a day, a level-1 name and a level-3 name.
	 *
	 * <p>Scoped by campaign and date only. The report's own dimension filters are deliberately not
	 * applied: the two marts describe the same campaign but are filled by different pipelines, so a
	 * channel or audience filter meant for delivery rows could exclude the conversions row that belongs
	 * to a delivery row the filter keeps. The join already restricts the result to the rows in view.
	 *
	 * @param campaign  the resolved campaign
	 * @param dateRange the delivery-date window; never {@code null}, may be empty
	 * @return the conversions subquery, ready to join
	 */
	BqRequest conversionsQuery(CampaignModel campaign, ReportRowDateRangeModel dateRange) {
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getConversionsView()))
				.whereEquals(BigQueryConversionsViewColumns.CNB_CAMPAIGN_NAME, campaign.name())
				.whereEquals(BigQueryConversionsViewColumns.CNB_CLIENT, campaign.clientName())
				.whereBeforeCurrentDate(BigQueryConversionsViewColumns.DATE)
				// Renamed on the way out, not selected under their own names: the delivery side of the join is
				// an unaliased table, so a name exposed by both sides has two candidate sources and BigQuery
				// rejects the whole query rather than choosing one.
				.selectExpression(
						BqSql.col(BigQueryConversionsViewColumns.DATE), ReportRowConversionsSql.DATE_ALIAS)
				.selectExpression(
						BqSql.col(BigQueryConversionsViewColumns.CONSTRUCTED_NAME),
						ReportRowConversionsSql.LEVEL_ONE_NAME_ALIAS)
				.selectExpression(
						BqSql.col(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3),
						ReportRowConversionsSql.LEVEL_THREE_NAME_ALIAS)
				.groupBy(BigQueryConversionsViewColumns.DATE)
				.groupBy(BigQueryConversionsViewColumns.CONSTRUCTED_NAME)
				.groupBy(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3)
				.selectExpression(
						BqSql.sumOf(ReportRowConversionsSql.conversionValue(false)),
						ReportRowConversionsSql.CONVERSIONS_ALIAS)
				.selectExpression(
						ReportRowConversionsSql.adjustedMetricsAggregate(),
						ReportRowConversionsSql.ADJUSTED_METRICS_ALIAS)
				.selectExpression(
						ReportRowConversionsSql.latestAuditValue(BigQueryConversionsViewColumns.CREATED_AT),
						ReportRowConversionsSql.CREATED_AT_ALIAS)
				.selectExpression(
						ReportRowConversionsSql.latestAuditValue(BigQueryConversionsViewColumns.CREATED_BY),
						ReportRowConversionsSql.CREATED_BY_ALIAS)
				.selectExpression(
						ReportRowConversionsSql.latestAuditValue(BigQueryConversionsViewColumns.LAST_MODIFIED_AT),
						ReportRowConversionsSql.LAST_MODIFIED_AT_ALIAS)
				.selectExpression(
						ReportRowConversionsSql.latestAuditValue(BigQueryConversionsViewColumns.LAST_MODIFIED_BY),
						ReportRowConversionsSql.LAST_MODIFIED_BY_ALIAS);
		if (dateRange.isPresent()) {
			query.whereDateBetween(BigQueryConversionsViewColumns.DATE, dateRange.from(), dateRange.to());
		}
		return query.build();
	}

	/**
	 * The campaign's raw delivery rows with their conversions attached - what every read of a report
	 * starts from, whether it pages them, groups them, totals them or exports them.
	 *
	 * <p>One shape for all four, because a report whose rows and totals disagreed about where conversions
	 * come from would be worse than one without conversions at all. Conversions replace the delivery
	 * mart's own conversion columns rather than sitting beside them - see
	 * {@link #selectReportRowColumns}.
	 *
	 * @param campaign  the resolved campaign
	 * @param filters   the requested filters; never {@code null}, may be empty
	 * @param dateRange the delivery-date window; never {@code null}, may be empty
	 * @return the joined-rows builder
	 */
	BqRequest.Builder joinedRows(
			CampaignModel campaign, List<ReportRowFilterModel> filters, ReportRowDateRangeModel dateRange) {
		String conversionAdjustedMetrics = ReportRowConversionsSql.reportedJoinedValue(
				ReportRowConversionsSql.ADJUSTED_METRICS_ALIAS, CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS);
		String conversionCreatedAt = ReportRowConversionsSql.reportedJoinedValue(
				ReportRowConversionsSql.CREATED_AT_ALIAS, CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS);
		String conversionCreatedBy = ReportRowConversionsSql.reportedJoinedValue(
				ReportRowConversionsSql.CREATED_BY_ALIAS, CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS);
		String conversionLastModifiedAt = ReportRowConversionsSql.reportedJoinedValue(
				ReportRowConversionsSql.LAST_MODIFIED_AT_ALIAS, CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS);
		String conversionLastModifiedBy = ReportRowConversionsSql.reportedJoinedValue(
				ReportRowConversionsSql.LAST_MODIFIED_BY_ALIAS, CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS);
		return narrow(selectReportRowColumns(baseQuery(campaign), false), filters, dateRange)
				.leftJoin(
						conversionsQuery(campaign, dateRange),
						ReportRowConversionsSql.ALIAS,
						ReportRowConversionsSql.joinCondition(
								DATE, CONSTRUCTED_NAME, CONSTRUCTED_NAME_LVL3, CNB_CHANNEL))
				.selectExpression(
						ReportRowConversionsSql.reportedConversions(CNB_CHANNEL, DATE, CONSTRUCTED_NAME, IMPRESSIONS),
						CONVERSIONS)
				.selectExpression(
						ReportRowConversionsSql.mergedAdjustedMetrics(
								BqSql.col(ADJUSTED_METRICS), conversionAdjustedMetrics),
						ADJUSTED_METRICS)
				.selectExpression(
						ReportRowConversionsSql.preferredAuditValue(BqSql.col(CREATED_AT), conversionCreatedAt),
						CREATED_AT)
				.selectExpression(
						ReportRowConversionsSql.preferredAuditValue(BqSql.col(CREATED_BY), conversionCreatedBy),
						CREATED_BY)
				.selectExpression(
						ReportRowConversionsSql.preferredAuditValue(
								BqSql.col(LAST_MODIFIED_AT), conversionLastModifiedAt),
						LAST_MODIFIED_AT)
				.selectExpression(
						ReportRowConversionsSql.preferredAuditValue(
								BqSql.col(LAST_MODIFIED_BY), conversionLastModifiedBy),
						LAST_MODIFIED_BY);
	}

	@Override
	public List<String> findDistinctValues(CurrentUserModel user, long campaignId, ReportRowSortField field) {
		CampaignModel campaign = reportMartCampaign(resolveCampaign(user, campaignId));
		BqRequest request = baseQuery(campaign)
				.distinct()
				.select(field.expression())
				.whereNotNull(field.expression())
				.orderBy(BqSql.col(field.expression()))
				.limitOffset(DISTINCT_VALUES_LIMIT, 0)
				.build();
		return gateway.fetch(request, row -> row.getString(field.expression()));
	}

	/**
	 * Adds each requested dimension filter as a {@code column IN (...)} predicate to the given query -
	 * multiple filters AND together, while a single filter's own values OR together (IN). Not applied to
	 * {@link #findDistinctValues}, whose picker lists a dimension's full value set regardless of the
	 * other filters currently active on it.
	 *
	 * <p>Filters and the date window go through one method, not two, so no read can pick up the filters
	 * and forget the window: the page, its full-dataset aggregates and the export all come through here,
	 * and totals covering a wider window than the rows beneath them would be worse than no totals.
	 *
	 * @param query     the query builder
	 * @param filters   the requested filters; never {@code null}, may be empty
	 * @param dateRange the delivery-date window; never {@code null}, may be empty
	 * @return the same builder, for chaining
	 */
	BqRequest.Builder narrow(
			BqRequest.Builder query, List<ReportRowFilterModel> filters, ReportRowDateRangeModel dateRange) {
		for (ReportRowFilterModel filter : filters) {
			query.whereInStrings(filter.field().expression(), filter.values());
		}
		if (dateRange.isPresent()) {
			query.whereDateBetween(DATE, dateRange.from(), dateRange.to());
		}
		return query;
	}

	/**
	 * Builds the shared report-rows data query - selected columns, filters, sort, and tiebreaker -
	 * without a {@code LIMIT}/{@code OFFSET} applied yet. Shared by {@link #findReportRows} (which pages
	 * it) and {@link #exportReportRows} (which caps it at the export row limit instead); the two differ
	 * only in what they do with the resulting builder afterward.
	 *
	 * <p>With {@code dimensions} given, the read is grouped by exactly those columns and every metric
	 * comes back aggregated ({@link #selectAggregatedMetrics}), so one row per distinct combination is
	 * returned rather than one row per source row. Ungrouped columns are simply not selected, and
	 * {@link #toReportRow} leaves them {@code null} - the client renders them blank. With no dimensions
	 * the raw, ungrouped rows are returned as before.
	 *
	 * @param campaign   the resolved campaign
	 * @param dimensions the dimensions to group by, in display order; never {@code null}, may be empty
	 * @param field      the resolved sort field (see {@link #resolveSortField})
	 * @param sort       the requested sort, for direction (may be {@code null})
	 * @param filters    the requested filters; never {@code null}, may be empty
	 * @param dateRange  the delivery-date window; never {@code null}, may be empty
	 * @return the query builder, with no {@code LIMIT}/{@code OFFSET} applied
	 */
	BqRequest.Builder dataQuery(
			CampaignModel campaign, List<ReportRowSortField> dimensions, ReportRowSortField field,
			SortCriterion<ReportRowSortField> sort, List<ReportRowFilterModel> filters,
			ReportRowDateRangeModel dateRange) {
		if (dimensions.isEmpty()) {
			return joinedRows(campaign, filters, dateRange)
					.orderBy(orderByExpression(field))
					.sortBy(sort)
					.tiebreakers(rawTiebreakers(field));
		}
		// Grouped reads aggregate the joined rows rather than the view: the conversions expression carries
		// a window function, and BigQuery will not have one nested inside SUM(). One subquery deeper is the
		// price of the rows and their totals agreeing about where conversions come from.
		BqRequest.Builder query = new BqRequest.Builder().from(joinedRows(campaign, filters, dateRange).build());
		for (ReportRowSortField dimension : dimensions) {
			query.select(dimension.expression());
			query.groupBy(dimension.expression());
		}
		selectAggregatedMetrics(query);
		ReportRowSortField groupedSort = groupedSortField(dimensions, field);
		query.orderBy(groupedOrderBy(query, groupedSort))
				.sortBy(sort)
				.tiebreakers(groupedTiebreakers(dimensions, groupedSort));
		return query;
	}

	/**
	 * Returns the deterministic raw-row tie-breaker chain after removing the primary sort expression.
	 *
	 * @param primary the primary sort field
	 * @return the raw tie-breaker columns
	 */
	List<String> rawTiebreakers(ReportRowSortField primary) {
		String primaryExpression = primary.computed() ? null : primary.expression();
		return RAW_ORDER_TIEBREAKERS.stream()
				.map(ReportRowSortField::expression)
				.filter(expression -> !expression.equals(primaryExpression))
				.toList();
	}

	/**
	 * Returns grouped tie-breakers from the selected dimensions only, because BigQuery cannot order a
	 * grouped query by a dimension that is not in {@code GROUP BY}.
	 *
	 * @param dimensions the selected grouped dimensions
	 * @param primary    the grouped primary sort field
	 * @return the grouped tie-breaker columns
	 */
	List<String> groupedTiebreakers(List<ReportRowSortField> dimensions, ReportRowSortField primary) {
		String primaryExpression = primary.numeric() ? null : primary.expression();
		return dimensions.stream()
				.map(ReportRowSortField::expression)
				.filter(expression -> !expression.equals(primaryExpression))
				.toList();
	}

	/**
	 * The sort field to actually use when grouping: a sort on a dimension that is no longer selected
	 * cannot be expressed at all ({@code ORDER BY} may only reference grouped columns or aggregates), so
	 * it falls back to the first grouped dimension. Metrics always survive, since they are aggregated.
	 *
	 * @param dimensions the grouped dimensions
	 * @param field      the resolved sort field
	 * @return the sort field to order by
	 */
	ReportRowSortField groupedSortField(List<ReportRowSortField> dimensions, ReportRowSortField field) {
		// The window-function column has no legal aggregate at all, so it falls back like an ungrouped
		// dimension rather than producing SUM() over an aggregate BigQuery will refuse.
		if (field == ReportRowSortField.AVG_DYNAMIC_RATE_BY_DATE_TACTIC) {
			return dimensions.get(0);
		}
		if (field.numeric() || field.computed() || dimensions.contains(field)) {
			return field;
		}
		return dimensions.get(0);
	}

	/**
	 * The {@code ORDER BY} for a grouped read, adding a select-list entry to sort by when the sort is on a
	 * metric.
	 *
	 * <p>A grouped dimension orders by its own column and needs nothing. A metric cannot: its bare column
	 * is not valid under {@code GROUP BY}, and putting the aggregate in the {@code ORDER BY} directly -
	 * {@code ORDER BY SUM(`impressions`)} - is worse than invalid, it is silently wrong. Every metric is
	 * selected aliased to its own column name ({@code SUM(`impressions`) AS impressions}), and BigQuery
	 * resolves a name in {@code ORDER BY} against the select-list aliases before the table's columns. So
	 * that {@code SUM} is taken over the alias, which is already a {@code SUM}, and the whole read fails
	 * with "Aggregations of aggregations are not allowed" - for every metric, not just the ratios.
	 *
	 * <p>So the metric's grouped form goes into the select list under an alias of its own and the sort
	 * names that alias. A select-list expression is resolved against the {@code FROM} clause only, never
	 * against its sibling aliases, so the aggregate inside it reads the raw column as intended - the same
	 * reason {@code SUM(`impressions`) AS impressions} does not recurse. The alias is deliberately not one
	 * of the metric names, so nothing can shadow it either.
	 *
	 * @param query the grouped query being built, to add the sort's own select entry to
	 * @param field the sort field, already resolved by {@link #groupedSortField}
	 * @return the order-by expression
	 */
	String groupedOrderBy(BqRequest.Builder query, ReportRowSortField field) {
		if (!field.numeric()) {
			return BqSql.col(field.expression());
		}
		query.selectExpression(groupedMetricExpression(field), ALIAS_SORT_VALUE);
		return BqSql.col(ALIAS_SORT_VALUE);
	}

	/**
	 * A metric's value over a group: the ratios re-derive from summed components, everything else sums.
	 *
	 * @param field the metric field
	 * @return the grouped SQL expression
	 */
	String groupedMetricExpression(ReportRowSortField field) {
		return field.groupedExpression() != null ? field.groupedExpression() : BqSql.sum(field.expression());
	}

	/**
	 * The shared {@code FROM ... WHERE campaign name/client} base every report-rows query starts from —
	 * the paged data query and the full-dataset aggregate query both filter to the exact same rows.
	 *
	 * <p>Today is excluded, as the reporting tool excludes it ({@code AND date < CURRENT_DATE()}). A
	 * day still in progress has only the impressions the platforms have reported so far against a cost
	 * that lands on its own schedule, so its rates are noise: a report read at noon and the same report
	 * read at six would disagree, and neither would match the dashboard. The window a user picks is
	 * narrowed by this, never widened by it - asking for today matches nothing rather than half a day.
	 *
	 * @param campaign the resolved campaign
	 * @return a fresh builder scoped to the campaign's completed days
	 */
	BqRequest.Builder baseQuery(CampaignModel campaign) {
		return new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				.whereEquals(CNB_CAMPAIGN_NAME, campaign.name())
				.whereEquals(CNB_CLIENT, campaign.clientName())
				.whereBeforeCurrentDate(DATE);
	}

	/**
	 * Adds every metric as its aggregate, aliased to its own column name so a grouped row maps through
	 * {@link #toReportRow(BqRow)} unchanged. Shared by the full-dataset totals query and the grouped
	 * data query so the two can never disagree about how a metric aggregates.
	 *
	 * <p>Counts and money SUM; the two stored rate columns AVG, since averaging a rate is the only
	 * meaningful roll-up. CPM/CTR/AVCR are absent on purpose - they are ratios derived from these
	 * aggregates (see {@link #toTotals(BqRow)} and the frontend's own per-row derivation), never
	 * aggregated directly.
	 *
	 * @param query the query to add the aggregates to
	 * @return the same builder
	 */
	BqRequest.Builder selectAggregatedMetrics(BqRequest.Builder query) {
		return query
				.selectSum(IMPRESSIONS, IMPRESSIONS)
				.selectSum(CLICKS, CLICKS)
				.selectSum(SPEND, SPEND)
				.selectSum(STARTS, STARTS)
				.selectSum(FIRST_QUARTILES, FIRST_QUARTILES)
				.selectSum(MIDPOINTS, MIDPOINTS)
				.selectSum(THIRD_QUARTILES, THIRD_QUARTILES)
				.selectSum(COMPLETES, COMPLETES)
				// Sums the conversions the join already attached (see joinedRows), which is why this reads
				// from those rows and not from the view. post_click_conversions and post_view_conversions
				// have no sum here because the report does not carry them - see selectReportRowColumns.
				.selectSum(CONVERSIONS, CONVERSIONS)
				.selectSum(DYNAMIC_COST, DYNAMIC_COST)
				.selectSum(LINK_CLICKS, LINK_CLICKS)
				// A ratio re-derives from summed components rather than averaging the rows' own ratios -
				// see ReportRowMetricSql.
				//
				// avg_dynamic_rate_by_date_tactic is deliberately absent from this list: the view computes
				// it with a window function, so any aggregate over it becomes SUM(SUM(...) OVER (...))
				// once BigQuery inlines the view, and BigQuery refuses that as "Aggregations of
				// aggregations are not allowed". It has no meaning at an arbitrary group anyway, being a
				// per-(agency, client, campaign, tactic, date) benchmark, so a grouped read leaves it
				// blank - the same as any dimension it does not group by.
				.selectExpression(ReportRowMetricSql.GROUPED_IVT, ALIAS_IVT)
				.selectExpression(ReportRowMetricSql.GROUPED_DYNAMIC_RATE, DYNAMIC_RATE)
				// Each ratio re-derived from its own eligible rows' summed components. Dividing the plain
				// summed metrics above would let a row that has no CPM contribute cost to the group's CPM.
				.selectExpression(ReportRowMetricSql.GROUPED_CPM, ALIAS_CPM)
				.selectExpression(ReportRowMetricSql.GROUPED_CPC, ALIAS_CPC)
				.selectExpression(ReportRowMetricSql.GROUPED_CPV, ALIAS_CPV)
				.selectExpression(ReportRowMetricSql.GROUPED_CTR, ALIAS_CTR)
				.selectExpression(ReportRowMetricSql.GROUPED_AVCR, ALIAS_AVCR);
	}

	/**
	 * Adds every {@link ReportRowModel} column to the select list, in the exact order
	 * {@link #toReportRow} reads them back.
	 *
	 * @param query the query builder
	 * @return the same builder, for chaining
	 */
	BqRequest.Builder selectReportRowColumns(BqRequest.Builder query) {
		return selectReportRowColumns(query, true);
	}

	/**
	 * Adds every {@link ReportRowModel} delivery-column value to the select list. Adjustment metadata can
	 * be skipped when the caller will merge delivery metadata with conversion-side metadata under the same
	 * result aliases.
	 *
	 * @param query                     the query builder
	 * @param includeAdjustmentMetadata whether delivery adjustment metadata should be selected directly
	 * @return the same builder, for chaining
	 */
	BqRequest.Builder selectReportRowColumns(BqRequest.Builder query, boolean includeAdjustmentMetadata) {
		query
				.select(DATE)
				.select(PLATFORM)
				.select(ACCOUNT)
				.select(ACCOUNT_ID)
				.select(CONSTRUCTED_NAME)
				.select(CONSTRUCTED_ID)
				.select(CONSTRUCTED_NAME_LVL2)
				.select(CONSTRUCTED_ID_LVL2)
				.select(CONSTRUCTED_NAME_LVL3)
				.select(CONSTRUCTED_ID_LVL3)
				.select(CNB_AGENCY_ID)
				.select(CNB_CLIENT)
				.select(CNB_INDUSTRY_CODE)
				.select(CNB_CAMPAIGN_NAME)
				.select(CNB_CHANNEL)
				.select(CNB_TACTIC)
				.select(CNB_BUYING_MODEL)
				.select(CNB_AUDIENCE)
				.select(CNB_UNIQUE_LINE_ITEM_ID)
				.select(CNB_OTHER)
				.select(CNB_GEO)
				.select(CNB_CREATIVE_TAG)
				.select(CNB_MESSAGE)
				.select(CNB_KEYWORD_GROUP)
				.select(CNB_FLIGHT_IDENTIFIER)
				.select(CNB_LANGUAGE)
				.select(IMPRESSIONS)
				.select(CLICKS)
				.select(SPEND)
				.select(STARTS)
				.select(FIRST_QUARTILES)
				.select(MIDPOINTS)
				.select(THIRD_QUARTILES)
				.select(COMPLETES)
				// conversions is deliberately absent: it arrives from the conversions mart through the join
				// (see joinedRows), and selecting the delivery mart's own column too would collide on the
				// alias. post_click_conversions and post_view_conversions are absent for the reporting
				// tool's reason - it selects them as NULL, because the delivery mart's attribution split is
				// not the one the report is about. Both stay null on the model, and read blank.
				.select(DYNAMIC_COST)
				.select(LINK_CLICKS);
		if (includeAdjustmentMetadata) {
			query
					.select(ADJUSTED_METRICS)
					.select(CREATED_AT)
					.select(CREATED_BY)
					.select(LAST_MODIFIED_AT)
					.select(LAST_MODIFIED_BY);
		}
		return query
				.select(RATE_TYPE)
				.select(DYNAMIC_RATE)
				.select(AVG_DYNAMIC_RATE_BY_DATE_TACTIC)
				.select(LINE_ITEM_DESCRIPTION)
				.selectExpression(ReportRowMetricSql.IVT, ALIAS_IVT)
				.selectExpression(ReportRowMetricSql.CPM, ALIAS_CPM)
				.selectExpression(ReportRowMetricSql.CPC, ALIAS_CPC)
				.selectExpression(ReportRowMetricSql.CPV, ALIAS_CPV)
				.selectExpression(ReportRowMetricSql.CTR, ALIAS_CTR)
				.selectExpression(ReportRowMetricSql.AVCR, ALIAS_AVCR);
	}

	/**
	 * Resolves the requested sort to a field, defaulting to {@link ReportRowSortField#DATE} - the
	 * original fixed order - when no sort (or no field) is requested.
	 *
	 * @param sort the requested sort, may be {@code null}
	 * @return the resolved sort field, never {@code null}
	 */
	ReportRowSortField resolveSortField(SortCriterion<ReportRowSortField> sort) {
		return sort == null || sort.field() == null ? ReportRowSortField.DATE : sort.field();
	}

	/**
	 * Renders the data query's primary {@code ORDER BY} expression for the resolved sort field. A
	 * stable {@code constructed_id} (line-item id) tiebreaker is appended separately by
	 * {@link #findReportRows} via {@link BqRequest.Builder#tiebreaker} - kept out of this expression so
	 * the caller's requested direction binds only to this primary column, never to the tiebreaker.
	 *
	 * @param field the resolved sort field (see {@link #resolveSortField})
	 * @return the whitelisted primary {@code ORDER BY} expression
	 */
	String orderByExpression(ReportRowSortField field) {
		return field.computed() ? field.expression() : BqSql.col(field.expression());
	}

	/**
	 * Maps the aggregate row into a {@link ReportRowTotalsModel}.
	 *
	 * <p>Every ratio is read straight off the row rather than divided out of the summed counts beside it.
	 * The ratios are gated to the channels they mean anything on, so their numerators and denominators
	 * are summed over a subset of the rows the plain totals cover - dividing {@code SUM(spend)} by
	 * {@code SUM(impressions)} here would put a search line's cost into a CPM that never counted its
	 * impressions. {@link #selectAggregatedMetrics} does the gating in SQL, where the channel is still
	 * in scope.
	 *
	 * @param row the single-row aggregate result
	 * @return the metric totals
	 */
	ReportRowTotalsModel toTotals(BqRow row) {
		Long impressions = row.getLong(IMPRESSIONS);
		Double spend = row.getDouble(SPEND);
		Long clicks = row.getLong(CLICKS);
		Long completes = row.getLong(COMPLETES);
		Long starts = row.getLong(STARTS);
		return new ReportRowTotalsModel(
				impressions,
				clicks,
				spend,
				starts,
				row.getLong(FIRST_QUARTILES),
				row.getLong(MIDPOINTS),
				row.getLong(THIRD_QUARTILES),
				completes,
				row.getDouble(CONVERSIONS),
				row.getDouble(POST_CLICK_CONVERSIONS),
				row.getDouble(POST_VIEW_CONVERSIONS),
				row.getDouble(DYNAMIC_COST),
				row.getLong(LINK_CLICKS),
				row.getDouble(DYNAMIC_RATE),
				// No total for avg_dynamic_rate_by_date_tactic: the aggregate query cannot select one at
				// all (see selectAggregatedMetrics), so the totals row states nothing rather than a zero.
				null,
				row.getDouble(ALIAS_IVT),
				// Read, not derived from the sums above. Each ratio is gated to the channels it means
				// anything on, so a row with no CPM must contribute neither cost nor impressions to the
				// group's CPM - which dividing SUM(cost) by SUM(impressions) here would not respect.
				row.getDouble(ALIAS_CPM),
				row.getDouble(ALIAS_CPC),
				row.getDouble(ALIAS_CPV),
				row.getDouble(ALIAS_CTR),
				row.getDouble(ALIAS_AVCR));
	}

	/**
	 * Returns {@code 0L} for a {@code null} BigQuery long, so a metric with no matching rows sums to
	 * zero instead of null-propagating into every derived total.
	 *
	 * @param value the nullable value
	 * @return the value, or {@code 0L}
	 */
	static long orZero(Long value) {
		return value == null ? 0L : value;
	}

	/**
	 * Returns {@code 0.0} for a {@code null} BigQuery double, so a metric with no matching rows sums to
	 * zero instead of null-propagating into every derived total.
	 *
	 * @param value the nullable value
	 * @return the value, or {@code 0.0}
	 */
	static double orZero(Double value) {
		return value == null ? 0.0 : value;
	}

	/**
	 * Resolves the campaign by id through {@link CampaignService}, which already enforces the current
	 * user's agency visibility — a campaign outside the user's visibility resolves the same as an
	 * unknown one.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @return the resolved campaign
	 * @throws BusinessException when no visible campaign matches the id
	 */
	CampaignModel resolveCampaign(CurrentUserModel user, long campaignId) {
		return campaignService.getVisibleCampaign(user, campaignId);
	}

	/**
	 * Returns a campaign identity suitable for filtering the reporting mart.
	 *
	 * <p>The campaign itself comes from the NetSuite IO-lines source, where advertiser may be missing.
	 * The reporting mart is the source of truth for {@code CNB_client}; if it exposes one unambiguous
	 * client for the campaign name, that value is used instead of the campaign source.
	 *
	 * @param campaign the campaign resolved from the campaign source
	 * @return the campaign with an effective report-mart client, falling back to a cleaned campaign client
	 */
	CampaignModel reportMartCampaign(CampaignModel campaign) {
		return clientResolver.forAdjustmentsMart(campaign);
	}

	/**
	 * Maps a result row into a {@link ReportRowModel}.
	 *
	 * @param row the result row
	 * @return the report row model
	 */
	ReportRowModel toReportRow(BqRow row) {
		return new ReportRowModel(
				row.getString(DATE),
				row.getString(PLATFORM),
				row.getString(ACCOUNT),
				row.getString(ACCOUNT_ID),
				row.getString(CONSTRUCTED_NAME),
				row.getString(CONSTRUCTED_ID),
				row.getString(CONSTRUCTED_NAME_LVL2),
				row.getString(CONSTRUCTED_ID_LVL2),
				row.getString(CONSTRUCTED_NAME_LVL3),
				row.getString(CONSTRUCTED_ID_LVL3),
				row.getString(CNB_AGENCY_ID),
				row.getString(CNB_CLIENT),
				row.getString(CNB_INDUSTRY_CODE),
				row.getString(CNB_CAMPAIGN_NAME),
				row.getString(CNB_CHANNEL),
				row.getString(CNB_TACTIC),
				row.getString(CNB_BUYING_MODEL),
				row.getString(CNB_AUDIENCE),
				row.getString(CNB_UNIQUE_LINE_ITEM_ID),
				row.getString(CNB_OTHER),
				row.getString(CNB_GEO),
				row.getString(CNB_CREATIVE_TAG),
				row.getString(CNB_MESSAGE),
				row.getString(CNB_KEYWORD_GROUP),
				row.getString(CNB_FLIGHT_IDENTIFIER),
				row.getString(CNB_LANGUAGE),
				row.getLong(IMPRESSIONS),
				row.getLong(CLICKS),
				row.getDouble(SPEND),
				row.getLong(STARTS),
				row.getLong(FIRST_QUARTILES),
				row.getLong(MIDPOINTS),
				row.getLong(THIRD_QUARTILES),
				row.getLong(COMPLETES),
				row.getDouble(CONVERSIONS),
				row.getDouble(POST_CLICK_CONVERSIONS),
				row.getDouble(POST_VIEW_CONVERSIONS),
				row.getDouble(DYNAMIC_COST),
				row.getLong(LINK_CLICKS),
				row.getString(ADJUSTED_METRICS),
				row.getString(CREATED_AT),
				row.getString(CREATED_BY),
				row.getString(LAST_MODIFIED_AT),
				row.getString(LAST_MODIFIED_BY),
				row.getString(RATE_TYPE),
				row.getDouble(DYNAMIC_RATE),
				row.getDouble(AVG_DYNAMIC_RATE_BY_DATE_TACTIC),
				row.getString(LINE_ITEM_DESCRIPTION),
				row.getDouble(ALIAS_IVT),
				row.getDouble(ALIAS_CPM),
				row.getDouble(ALIAS_CPC),
				row.getDouble(ALIAS_CPV),
				row.getDouble(ALIAS_CTR),
				row.getDouble(ALIAS_AVCR));
	}

	@Override
	public long saveAdjustments(CurrentUserModel user, long campaignId, List<AdjustmentRowModel> adjustments) {
		validateAdjustments(adjustments);
		CampaignModel campaign = reportMartCampaign(resolveCampaign(user, campaignId));
		return writeAdjustments(campaign, user, adjustments);
	}

	@Override
	public int applyBulkAdjustments(CurrentUserModel user, long campaignId, List<WorkbookAdjustmentRow> uploadedRows) {
		CampaignModel campaign = reportMartCampaign(resolveCampaign(user, campaignId));
		Map<String, List<ReportRowModel>> baseline = baselineByKey(campaign, uploadedRows);
		List<AdjustmentRowModel> models = new ArrayList<>();
		for (WorkbookAdjustmentRow row : uploadedRows) {
			ReportRowModel base = matchBaseline(row, baseline);
			AdjustmentRowModel adjustment = diffRow(row, base);
			if (adjustment != null) {
				models.add(adjustment);
			}
		}
		return models.isEmpty() ? 0 : (int) writeAdjustments(campaign, user, models);
	}

	/**
	 * Appends the given already-built adjustment models for a resolved campaign, split across as many
	 * INSERT jobs as {@link BqInsert.Builder#buildBatches(int)} decides are needed to stay under
	 * BigQuery's statement-length limit - shared by {@link #saveAdjustments} (inline edits) and
	 * {@link #applyBulkAdjustments} (spreadsheet diffs), which differ only in how they build the model
	 * list. Evicts the cached report-row reads ({@link #findReportRows}) afterward, since a write can
	 * change what a cached page/aggregate would return.
	 *
	 * @param campaign the resolved campaign the adjustments belong to
	 * @param user     the current user, stamped into created_by/last_modified_by
	 * @param models   the adjustment rows to append; must be non-empty
	 * @return the total number of rows written across every batch
	 */
	long writeAdjustments(CampaignModel campaign, CurrentUserModel user, List<AdjustmentRowModel> models) {
		BqInsert.Builder insert = new BqInsert.Builder()
				.into(writeGateway.writeTable())
				.columns(adjustmentColumns());
		for (AdjustmentRowModel model : models) {
			insert.addRow(toAdjustmentColumns(campaign, user, model));
		}
		long totalWritten = 0;
		for (BqInsert batch : insert.buildBatches(BqInsert.MAX_STATEMENT_BYTES)) {
			totalWritten += writeGateway.insert(batch);
		}
		gateway.evictSearchCache();
		return totalWritten;
	}

	/**
	 * Reads the campaign's report rows matching the uploaded sheet's own (date, line_item_id) values -
	 * not the whole campaign - and indexes them by {@link #key(String, String)} for the bulk-adjustment
	 * upload to match against. A key mapping to more than one row means the upload cannot uniquely
	 * resolve which row a spreadsheet entry for that key refers to (see {@link #matchBaseline}).
	 *
	 * <p>Narrows the read to rows whose date is one of the upload's dates <em>and</em> whose line item id
	 * is one of the upload's line item ids - a superset of the exact (date, line_item_id) pairs actually
	 * needed (a row can share a date with one uploaded row and a line item id with another without being
	 * a match for either), never a subset, so every pair {@link #matchBaseline} needs is still present.
	 *
	 * @param campaign     the resolved campaign
	 * @param uploadedRows the uploaded sheet's rows, whose distinct dates/line item ids bound the read
	 * @return the matching report rows, keyed by (date, line_item_id)
	 */
	Map<String, List<ReportRowModel>> baselineByKey(CampaignModel campaign, List<WorkbookAdjustmentRow> uploadedRows) {
		List<String> dates = distinctCellValues(uploadedRows, "date");
		List<String> lineItemIds = distinctCellValues(uploadedRows, "line_item_id");
		// Ungrouped on purpose: a bulk upload is matched against raw rows, the only grain that can be edited.
		// Unwindowed as well as ungrouped: the sheet's own dates bound this read below, and a window
		// carried over from the screen the sheet was downloaded from would silently drop rows it contains.
		// Unjoined as well: an upload is diffed against the delivery metrics it can actually write, so
		// scanning the conversions mart to attach a column no comparison reads would be paid for nothing.
		BqRequest.Builder query = selectReportRowColumns(baseQuery(campaign));
		if (!dates.isEmpty()) {
			query.whereInStrings(DATE, dates);
		}
		if (!lineItemIds.isEmpty()) {
			query.whereInStrings(CONSTRUCTED_ID, lineItemIds);
		}
		BqRequest request = query.limitOffset(EXPORT_ROW_CAP + 1, 0).build();
		Map<String, List<ReportRowModel>> byKey = new HashMap<>();
		for (ReportRowModel row : gateway.fetch(request, this::toReportRow)) {
			byKey.computeIfAbsent(key(row.date(), row.lineItemId()), k -> new ArrayList<>()).add(row);
		}
		return byKey;
	}

	/**
	 * Collects one cell column's distinct, non-blank values across every uploaded row.
	 *
	 * @param uploadedRows the uploaded sheet's rows
	 * @param column       the cell column id to collect
	 * @return the distinct non-blank values, in no particular order
	 */
	List<String> distinctCellValues(List<WorkbookAdjustmentRow> uploadedRows, String column) {
		return uploadedRows.stream()
				.map(row -> row.cells().get(column))
				.filter(value -> !isBlank(value))
				.distinct()
				.toList();
	}

	/**
	 * Builds the natural key a bulk-adjustment spreadsheet row is matched to a baseline report row by -
	 * mirrors the frontend's own row identity key for the "Adjust individual lines" edit mode.
	 *
	 * @param date       the row's delivery date
	 * @param lineItemId the row's line-item id
	 * @return the composite key
	 */
	String key(String date, String lineItemId) {
		return date + "::" + lineItemId;
	}

	/**
	 * Matches one uploaded spreadsheet row to exactly one baseline report row by (date, line_item_id).
	 *
	 * @param row      the uploaded row
	 * @param baseline the campaign's report rows, keyed by {@link #key(String, String)}
	 * @return the matched baseline row
	 * @throws BusinessException OPH_027 when the row is missing its key cells, matches no baseline row,
	 *                           or matches more than one (an ambiguous key this upload cannot resolve)
	 */
	ReportRowModel matchBaseline(WorkbookAdjustmentRow row, Map<String, List<ReportRowModel>> baseline) {
		String date = row.cells().get("date");
		String lineItemId = row.cells().get("line_item_id");
		if (isBlank(date) || isBlank(lineItemId)) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + row.sourceRowNumber() + " is missing date or line_item_id");
		}
		List<ReportRowModel> matches = baseline.get(key(date, lineItemId));
		if (matches == null || matches.isEmpty()) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + row.sourceRowNumber() + ": no report row matches date=" + date
							+ ", line_item_id=" + lineItemId);
		}
		if (matches.size() > 1) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + row.sourceRowNumber() + ": date=" + date + ", line_item_id=" + lineItemId
							+ " matches more than one report row - cannot uniquely determine which to adjust");
		}
		return matches.get(0);
	}

	/**
	 * Diffs one uploaded row's editable metric cells against its matched baseline row, returning an
	 * override {@link AdjustmentRowModel} carrying only the cells that actually changed (identity fields
	 * copied from {@code base}, never the upload - see natural-key matching above). A cell equal to the
	 * baseline value, or left blank, is treated as unchanged, not as a zero.
	 *
	 * @param row  the uploaded row
	 * @param base the matched baseline row
	 * @return the override model, or {@code null} when no metric actually changed (a valid no-op)
	 * @throws BusinessException OPH_027 when a metric cell is present but not a valid number
	 */
	AdjustmentRowModel diffRow(WorkbookAdjustmentRow row, ReportRowModel base) {
		Map<String, String> cells = row.cells();
		int n = row.sourceRowNumber();
		Set<String> changed = new LinkedHashSet<>();
		Long impressions = diffLong(cells.get("impressions"), base.impressions(), "impressions", n, changed);
		Long clicks = diffLong(cells.get("clicks"), base.clicks(), "clicks", n, changed);
		Double spend = diffDouble(cells.get("spend"), base.spend(), "spend", n, changed);
		Long starts = diffLong(cells.get("starts"), base.starts(), "starts", n, changed);
		Long firstQuartiles = diffLong(
				cells.get("first_quartiles"), base.firstQuartiles(), "first_quartiles", n, changed);
		Long midpoints = diffLong(cells.get("midpoints"), base.midpoints(), "midpoints", n, changed);
		Long thirdQuartiles = diffLong(
				cells.get("third_quartiles"), base.thirdQuartiles(), "third_quartiles", n, changed);
		Long completes = diffLong(cells.get("completes"), base.completes(), "completes", n, changed);
		Double dynamicCost = diffDouble(cells.get("dynamic_cost"), base.dynamicCost(), "dynamic_cost", n, changed);
		Long linkClicks = diffLong(cells.get("link_clicks"), base.linkClicks(), "link_clicks", n, changed);
		if (changed.isEmpty()) {
			return null;
		}
		return new AdjustmentRowModel(
				false,
				base.date(), base.platform(), base.account(), base.accountId(),
				base.lineItemName(), base.lineItemId(),
				base.insertionOrderName(), base.insertionOrderId(),
				base.campaignConstructedName(), base.campaignConstructedId(),
				base.agencyId(), base.industryCode(), base.channel(), base.tactic(),
				base.buyingModel(), base.audience(), base.uniqueLineItemId(), base.other(),
				base.geo(), base.creativeTag(), base.message(), base.keywordGroup(),
				base.flightIdentifier(), base.language(),
				impressions, clicks, spend, starts, firstQuartiles,
				midpoints, thirdQuartiles, completes, dynamicCost, linkClicks,
				String.join(",", changed));
	}

	/**
	 * Diffs one integer-valued metric cell against its baseline value.
	 *
	 * @param raw      the cell's raw text, or {@code null} when absent
	 * @param baseline the metric's current value on the matched baseline row
	 * @param column   the metric's column id, for error messages and the changed-set
	 * @param rowNum   the uploaded row's 1-based source row number, for error messages
	 * @param changed  the changed-column set to add {@code column} to when the value actually differs
	 * @return the new value, or {@code null} when the cell is blank or equal to the baseline
	 * @throws BusinessException OPH_027 when the cell is present but not a valid number
	 */
	Long diffLong(String raw, Long baseline, String column, int rowNum, Set<String> changed) {
		Double parsed = parseCell(raw, column, rowNum);
		if (parsed == null) {
			return null;
		}
		long value = Math.round(parsed);
		if (baseline != null && baseline == value) {
			return null;
		}
		changed.add(column);
		return value;
	}

	/**
	 * Diffs one decimal-valued metric cell against its baseline value.
	 *
	 * @param raw      the cell's raw text, or {@code null} when absent
	 * @param baseline the metric's current value on the matched baseline row
	 * @param column   the metric's column id, for error messages and the changed-set
	 * @param rowNum   the uploaded row's 1-based source row number, for error messages
	 * @param changed  the changed-column set to add {@code column} to when the value actually differs
	 * @return the new value, or {@code null} when the cell is blank or equal to the baseline
	 * @throws BusinessException OPH_027 when the cell is present but not a valid number
	 */
	Double diffDouble(String raw, Double baseline, String column, int rowNum, Set<String> changed) {
		Double parsed = parseCell(raw, column, rowNum);
		if (parsed == null) {
			return null;
		}
		if (baseline != null && baseline.doubleValue() == parsed.doubleValue()) {
			return null;
		}
		changed.add(column);
		return parsed;
	}

	/**
	 * Parses one metric cell's raw text as a number.
	 *
	 * @param raw    the cell's raw text, or {@code null}/blank when absent
	 * @param column the metric's column id, for the error message
	 * @param rowNum the uploaded row's 1-based source row number, for the error message
	 * @return the parsed value, or {@code null} when the cell is absent/blank
	 * @throws BusinessException OPH_027 when the cell is present but not a valid number
	 */
	Double parseCell(String raw, String column, int rowNum) {
		if (isBlank(raw)) {
			return null;
		}
		try {
			return Double.parseDouble(raw.trim());
		} catch (NumberFormatException e) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + rowNum + ": '" + column + "' is not a number: '" + raw + "'");
		}
	}

	/**
	 * Validates an adjustment batch before any BigQuery write is attempted.
	 *
	 * @param adjustments the requested adjustments
	 * @throws BusinessException OPH_027 when the batch is empty, an override carries no editable metric
	 *                           change, or a manually-added row is missing a line item id or a date
	 */
	void validateAdjustments(List<AdjustmentRowModel> adjustments) {
		if (adjustments == null || adjustments.isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, "at least one adjustment is required");
		}
		for (AdjustmentRowModel adjustment : adjustments) {
			if (adjustment.added()) {
				if (isBlank(adjustment.lineItemId()) || isBlank(adjustment.date())) {
					throw new BusinessException(
							OperationalHubErrorReason.OPH_027,
							"a manually-added row requires a line item id and a date");
				}
			} else if (!hasAnyEditableMetric(adjustment)) {
				throw new BusinessException(
						OperationalHubErrorReason.OPH_027, "an override must change at least one metric");
			}
		}
	}

	/**
	 * Indicates whether a string field is missing or blank.
	 *
	 * @param value the value to check
	 * @return {@code true} when {@code null} or all-whitespace
	 */
	boolean isBlank(String value) {
		return value == null || value.isBlank();
	}

	/**
	 * Indicates whether an adjustment sets at least one of the editable stored metrics — a derived
	 * ratio (cpm/ctr/avcr) is never among them, since {@link AdjustmentRowModel} has no field for one.
	 *
	 * @param adjustment the adjustment to inspect
	 * @return {@code true} when at least one editable metric is non-null
	 */
	boolean hasAnyEditableMetric(AdjustmentRowModel adjustment) {
		return adjustment.impressions() != null || adjustment.clicks() != null || adjustment.spend() != null
				|| adjustment.starts() != null || adjustment.firstQuartiles() != null
				|| adjustment.midpoints() != null || adjustment.thirdQuartiles() != null
				|| adjustment.completes() != null
				|| adjustment.dynamicCost() != null || adjustment.linkClicks() != null;
	}

	/**
	 * The whitelisted, fixed-order column list every adjustment row's rendered values (see
	 * {@link #toAdjustmentColumns}) are positionally aligned to — 44 of the 48 columns
	 * {@link #selectReportRowColumns} reads, in the same order. {@code rate_type}, {@code dynamic_rate},
	 * {@code avg_dynamic_rate_by_date_tactic} and {@code line_item_description} are deliberately excluded:
	 * they exist only on the read view, not on the write table itself, so including them fails every write
	 * with a BigQuery "column not present in table" error.
	 *
	 * @return the adjustments write table's writable columns, in order
	 */
	List<String> adjustmentColumns() {
		return List.of(
				DATE, PLATFORM, ACCOUNT, ACCOUNT_ID, CONSTRUCTED_NAME, CONSTRUCTED_ID,
				CONSTRUCTED_NAME_LVL2, CONSTRUCTED_ID_LVL2, CONSTRUCTED_NAME_LVL3, CONSTRUCTED_ID_LVL3,
				CNB_AGENCY_ID, CNB_CLIENT, CNB_INDUSTRY_CODE, CNB_CAMPAIGN_NAME, CNB_CHANNEL, CNB_TACTIC,
				CNB_BUYING_MODEL, CNB_AUDIENCE, CNB_UNIQUE_LINE_ITEM_ID, CNB_OTHER, CNB_GEO, CNB_CREATIVE_TAG,
				CNB_MESSAGE, CNB_KEYWORD_GROUP, CNB_FLIGHT_IDENTIFIER, CNB_LANGUAGE,
				IMPRESSIONS, CLICKS, SPEND, STARTS, FIRST_QUARTILES, MIDPOINTS, THIRD_QUARTILES, COMPLETES,
				DYNAMIC_COST, LINK_CLICKS,
				ADJUSTED_METRICS, CREATED_AT, CREATED_BY, LAST_MODIFIED_AT, LAST_MODIFIED_BY);
	}

	/**
	 * Renders one adjustment's values, positionally aligned to {@link #adjustmentColumns()}. The
	 * campaign-identity columns ({@code CNB_campaign_name}/{@code CNB_client}) come from the resolved
	 * campaign, never {@code adjustment} — a caller cannot inject a row into another campaign. The
	 * created/last-modified stamps are the current user's email and a server-evaluated
	 * {@code CURRENT_DATETIME()} (DATETIME, matching the write table's audit columns - see
	 * {@link BqInsert#currentTimestamp()}), never a client-supplied timestamp.
	 *
	 * @param campaign   the resolved campaign the adjustment belongs to
	 * @param user       the current user
	 * @param adjustment the adjustment to render
	 * @return the rendered row values, in {@link #adjustmentColumns()} order
	 */
	List<String> toAdjustmentColumns(CampaignModel campaign, CurrentUserModel user, AdjustmentRowModel adjustment) {
		String userEmail = BqInsert.stringValue(user.email());
		String now = BqInsert.currentTimestamp();
		return List.of(
				BqInsert.stringValue(adjustment.date()),
				BqInsert.stringValue(adjustment.platform()),
				BqInsert.stringValue(adjustment.account()),
				BqInsert.stringValue(adjustment.accountId()),
				BqInsert.stringValue(adjustment.lineItemName()),
				BqInsert.stringValue(adjustment.lineItemId()),
				BqInsert.stringValue(adjustment.insertionOrderName()),
				BqInsert.stringValue(adjustment.insertionOrderId()),
				BqInsert.stringValue(adjustment.campaignConstructedName()),
				BqInsert.stringValue(adjustment.campaignConstructedId()),
				BqInsert.stringValue(adjustment.agencyId()),
				BqInsert.stringValue(campaign.clientName()),
				BqInsert.stringValue(adjustment.industryCode()),
				BqInsert.stringValue(campaign.name()),
				BqInsert.stringValue(adjustment.channel()),
				BqInsert.stringValue(adjustment.tactic()),
				BqInsert.stringValue(adjustment.buyingModel()),
				BqInsert.stringValue(adjustment.audience()),
				BqInsert.stringValue(adjustment.uniqueLineItemId()),
				BqInsert.stringValue(adjustment.other()),
				BqInsert.stringValue(adjustment.geo()),
				BqInsert.stringValue(adjustment.creativeTag()),
				BqInsert.stringValue(adjustment.message()),
				BqInsert.stringValue(adjustment.keywordGroup()),
				BqInsert.stringValue(adjustment.flightIdentifier()),
				BqInsert.stringValue(adjustment.language()),
				BqInsert.numberValue(adjustment.impressions()),
				BqInsert.numberValue(adjustment.clicks()),
				BqInsert.numberValue(adjustment.spend()),
				BqInsert.numberValue(adjustment.starts()),
				BqInsert.numberValue(adjustment.firstQuartiles()),
				BqInsert.numberValue(adjustment.midpoints()),
				BqInsert.numberValue(adjustment.thirdQuartiles()),
				BqInsert.numberValue(adjustment.completes()),
				BqInsert.numberValue(adjustment.dynamicCost()),
				BqInsert.numberValue(adjustment.linkClicks()),
				BqInsert.stringValue(adjustment.adjustedMetrics()),
				now,
				userEmail,
				now,
				userEmail);
	}
}
