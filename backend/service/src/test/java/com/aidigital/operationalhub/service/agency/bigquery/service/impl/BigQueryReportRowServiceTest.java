package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.model.ReportRowMetricSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.bigquery.service.ReportQueryExecutor;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowKey;
import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryReportRowService}, which resolves a campaign through
 * {@link CampaignService} (enforcing its existing agency visibility) then runs two queries against
 * the op-hub adjustments view over a mocked client: a paged data query and a full-dataset aggregate
 * query (totals + date range + distinct line item count).
 */
@ExtendWith(MockitoExtension.class)
class BigQueryReportRowServiceTest {

	// The paged data query is the only one with LIMIT/OFFSET; the aggregate query is the only one
	// with COUNT(DISTINCT ...) - both otherwise share the same WHERE clause, so a plain
	// "CNB_campaign_name" matcher would match either.
	private static final String DATA_QUERY = " OFFSET ";
	private static final String AGGREGATE_QUERY = "COUNT(DISTINCT";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryWriteClient bigQueryWriteClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private CampaignService campaignService;

	@Mock
	private CampaignDeliveryScopeResolver scopeResolver;

	private BigQuerySearchGateway searchGateway;
	private BigQueryReportRowService service;
	private ReportQueryExecutor reportQueryExecutor;

	@BeforeEach
	void setUp() {
		reportQueryExecutor = new ReportQueryExecutor(new BigQueryOperationContext());
		searchGateway = spy(new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)));
		service = new BigQueryReportRowService(
				searchGateway,
				new BigQueryWriteGateway(bigQueryWriteClient, bigQueryProperties),
				bigQueryProperties,
				campaignService,
				scopeResolver,
				reportQueryExecutor);
		lenientAdjustmentsView();
	}

	@Test
	void shouldRunPageAndAggregateQueriesConcurrentlyTest() {
		// Given: each independent query waits until the other has entered the BigQuery client. Sequential
		// execution would time out here; concurrent execution lets both proceed.
		givenCampaign();
		CountDownLatch started = new CountDownLatch(2);
		when(bigQueryClient.query(anyString())).thenAnswer(invocation -> {
			String sql = invocation.getArgument(0);
			started.countDown();
			if (!started.await(2, TimeUnit.SECONDS)) {
				throw new AssertionError("report page and aggregate queries did not overlap");
			}
			return sql.contains(AGGREGATE_QUERY)
					? List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10"))
					: List.of(reportRow());
		});

		// When:
		ReportRowPageModel page = service.findReportRows(
				null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		assertThat(page.content()).hasSize(1);
		assertThat(page.totals().impressions()).isEqualTo(5000L);
	}

	@AfterEach
	void tearDown() {
		reportQueryExecutor.close();
	}

	private void lenientAdjustmentsView() {
		lenient().when(bigQueryProperties.getAdjustmentsView()).thenReturn("adjustments_view");
		lenient().when(bigQueryProperties.getWriteTable()).thenReturn("adjustments_table");
		lenient().when(bigQueryProperties.getConversionsView()).thenReturn("conversions_view");
		lenient().when(bigQueryProperties.getConversionsWriteTable()).thenReturn("conversions_table");
	}

	private void givenCampaign() {
		CampaignModel campaign = campaign(42L, "Ourisman Ford 2026", "Ourisman Ford");
		when(campaignService.getVisibleCampaignIdentity(any(), anyLong()))
				.thenReturn(campaign);
		givenScope(campaign);
	}

	private void givenScope(CampaignModel campaign) {
		lenient().when(scopeResolver.forCampaign(campaign)).thenReturn(scope(campaign));
	}

	private CampaignDeliveryScope scope(CampaignModel campaign) {
		return new CampaignDeliveryScope(
				campaign,
				new BqRequest("SELECT 42 AS `campaign_id`, 'uli-1' AS `line_item_id`"),
				new BqRequest("SELECT 'Retargeting' AS `constructed_name`"));
	}

	private CampaignModel campaign(long id, String name, String clientName) {
		return new CampaignModel(id, name, 10L, clientName, 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
	}

	private Map<String, Object> reportRow() {
		Map<String, Object> row = new HashMap<>();
		row.put("date", "2026-03-10");
		row.put("platform", "DV360");
		row.put("account", "Ourisman Main");
		row.put("account_id", "acct-1");
		row.put("constructed_name", "Retargeting");
		row.put("constructed_id", "LI-1");
		row.put("constructed_name_lvl2", "Display — Ourisman Ford 2026");
		row.put("constructed_id_lvl2", "IO-1");
		row.put("constructed_name_lvl3", "Ourisman Ford 2026");
		row.put("constructed_id_lvl3", "CAMP-1");
		row.put("CNB_agency_id", "20");
		row.put("CNB_client", "Ourisman Ford");
		row.put("CNB_industry_code", "AUTO");
		row.put("CNB_campaign_name", "Ourisman Ford 2026");
		row.put("CNB_channel", "Display");
		row.put("CNB_tactic", "Retargeting");
		row.put("CNB_buying_model", "CPM");
		row.put("CNB_audience", "In-market: Auto");
		row.put("CNB_unique_line_item_id", "uli-1");
		row.put("CNB_other", "—");
		row.put("CNB_geo", "New York, NY");
		row.put("CNB_creative_tag", "tag_1001");
		row.put("CNB_message", "Offer");
		row.put("CNB_keyword_group", "Brand");
		row.put("CNB_flight_identifier", "Flight 1");
		row.put("CNB_language", "English");
		row.put("impressions", 5000L);
		row.put("clicks", 12L);
		row.put("spend", 92.5);
		row.put("starts", 4800L);
		row.put("first_quartiles", 4700L);
		row.put("midpoints", 4600L);
		row.put("third_quartiles", 4500L);
		row.put("completes", 4400L);
		row.put("conversions", 2.0);
		row.put("post_click_conversions", 1.0);
		row.put("post_view_conversions", 1.0);
		row.put("dynamic_cost", 90.0);
		row.put("link_clicks", 8L);
		row.put("adjusted_metrics", "impressions");
		row.put("created_at", "2026-02-10T00:00:00");
		row.put("created_by", "Ilia Smetanin");
		row.put("last_modified_at", "2026-07-10T00:00:00");
		row.put("last_modified_by", "Allison Bukhun");
		row.put("rate_type", "CPM");
		row.put("dynamic_rate", 18.5);
		row.put("avg_dynamic_rate_by_date_tactic", 19.1);
		row.put("line_item_description", "Retargeting - Display");
		return row;
	}

	private Map<String, String> workbookCells(Map<String, Object> row) {
		Map<String, String> cells = new HashMap<>();
		putCell(cells, "date", row.get("date"));
		putCell(cells, "platform", row.get("platform"));
		putCell(cells, "account", row.get("account"));
		putCell(cells, "account_id", row.get("account_id"));
		putCell(cells, "line_item_name", row.get("constructed_name"));
		putCell(cells, "line_item_id", row.get("constructed_id"));
		putCell(cells, "insertion_order_name", row.get("constructed_name_lvl2"));
		putCell(cells, "insertion_order_id", row.get("constructed_id_lvl2"));
		putCell(cells, "campaign_constructed_name", row.get("constructed_name_lvl3"));
		putCell(cells, "campaign_constructed_id", row.get("constructed_id_lvl3"));
		putCell(cells, "agency_id", row.get("CNB_agency_id"));
		putCell(cells, "industry_code", row.get("CNB_industry_code"));
		putCell(cells, "channel", row.get("CNB_channel"));
		putCell(cells, "tactic", row.get("CNB_tactic"));
		putCell(cells, "buying_model", row.get("CNB_buying_model"));
		putCell(cells, "audience", row.get("CNB_audience"));
		putCell(cells, "unique_line_item_id", row.get("CNB_unique_line_item_id"));
		putCell(cells, "other", row.get("CNB_other"));
		putCell(cells, "geo", row.get("CNB_geo"));
		putCell(cells, "creative_tag", row.get("CNB_creative_tag"));
		putCell(cells, "message", row.get("CNB_message"));
		putCell(cells, "keyword_group", row.get("CNB_keyword_group"));
		putCell(cells, "flight_identifier", row.get("CNB_flight_identifier"));
		putCell(cells, "language", row.get("CNB_language"));
		cells.put(ReportRowKey.WORKBOOK_COLUMN, ReportRowKey.of(service.toReportRow(new BqRow(row))).encoded());
		putCell(cells, ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN, row.get("date"));
		putCell(cells, ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN, row.get("constructed_id"));
		putOriginalMetric(cells, "impressions", row.get("impressions"));
		putOriginalMetric(cells, "clicks", row.get("clicks"));
		putOriginalMetric(cells, "spend", row.get("spend"));
		putOriginalMetric(cells, "starts", row.get("starts"));
		putOriginalMetric(cells, "first_quartiles", row.get("first_quartiles"));
		putOriginalMetric(cells, "midpoints", row.get("midpoints"));
		putOriginalMetric(cells, "third_quartiles", row.get("third_quartiles"));
		putOriginalMetric(cells, "completes", row.get("completes"));
		putOriginalMetric(cells, "dynamic_cost", row.get("dynamic_cost"));
		putOriginalMetric(cells, "link_clicks", row.get("link_clicks"));
		return cells;
	}

	private void putCell(Map<String, String> cells, String column, Object value) {
		if (value != null) {
			cells.put(column, String.valueOf(value));
		}
	}

	private void putOriginalMetric(Map<String, String> cells, String column, Object value) {
		cells.put(
				ReportRowKey.originalMetricColumn(column),
				value == null ? ReportRowKey.ORIGINAL_NULL_VALUE : String.valueOf(value));
	}

	private Map<String, Object> aggregateRow(long impressions, long clicks, double spend,
	                                          long completes, long distinctLineItems, String minDate, String maxDate) {
		Map<String, Object> row = new HashMap<>();
		row.put("min_date", minDate);
		row.put("max_date", maxDate);
		row.put("distinct_line_items", distinctLineItems);
		row.put("impressions", impressions);
		row.put("clicks", clicks);
		row.put("spend", spend);
		row.put("starts", 0L);
		row.put("first_quartiles", 0L);
		row.put("midpoints", 0L);
		row.put("third_quartiles", 0L);
		row.put("completes", completes);
		row.put("conversions", 0.0);
		row.put("post_click_conversions", 0.0);
		row.put("post_view_conversions", 0.0);
		row.put("dynamic_cost", 0.0);
		row.put("link_clicks", 0L);
		row.put("dynamic_rate", 20.0);
		row.put("avg_dynamic_rate_by_date_tactic", 21.0);
		return row;
	}

	@Test
	void shouldFilterByConstructedNamesAndOrderByDateThenStableRawKeysTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		assertThat(page.content()).hasSize(1);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery)
				.contains("`constructed_name` IN (SELECT `constructed_name` FROM "
						+ "(SELECT 'Retargeting' AS `constructed_name`))")
				.doesNotContain("`CNB_campaign_name` = 'Ourisman Ford 2026'")
				.doesNotContain("`CNB_client` = 'Ourisman Ford'");
		assertThat(dataQuery)
				.contains("ORDER BY `date` ASC NULLS LAST, `constructed_id` ASC, `platform` ASC, `account` ASC");
	}

	@Test
	void shouldFilterRowsByTheCampaignDeliveryScopeTest() {
		// Given: NetSuite names can differ from mart names; the report uses the resolved mart constructed names.
		CampaignModel sourceCampaign = campaign(42452L, "TCL Mobile/Tablets 2026", "Wrong Client");
		when(campaignService.getVisibleCampaignIdentity(any(), anyLong()))
				.thenReturn(sourceCampaign);
		givenScope(sourceCampaign);
		when(bigQueryClient.query(argThat(sql ->
				sql != null && sql.contains(DATA_QUERY) && sql.contains("COUNT(*) OVER"))))
				.thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.contains(AGGREGATE_QUERY))))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42452L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream()
				.filter(query -> query.contains(DATA_QUERY) && query.contains("COUNT(*) OVER"))
				.findFirst()
				.orElseThrow();
		verify(scopeResolver).forCampaign(sourceCampaign);
		assertThat(dataQuery)
				.contains("`constructed_name` IN (SELECT `constructed_name` FROM "
						+ "(SELECT 'Retargeting' AS `constructed_name`))")
				.doesNotContain("`CNB_campaign_name` = 'TCL Mobile/Tablets 2026'")
				.doesNotContain("`CNB_client` = 'Wrong Client'");
	}

	@Test
	void shouldExcludeTodayFromEveryReadOfAReportTest() {
		// Given: a report read with a date window of its own
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-01", "2026-03-31")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(), null, List.of(),
				new ReportRowDateRangeModel("2026-03-01", "2026-03-31"));

		// Then: the rows and the totals beside them both stop at yesterday - a day still being delivered
		// would move the rates between one read and the next, and the requested window narrows it rather
		// than reopening today
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		for (String query : sql.getAllValues()) {
			assertThat(query).contains("`date` < CURRENT_DATE()");
			assertThat(query).contains("`date` >= '2026-03-01'");
		}
	}

	@Test
	void shouldExcludeTodayFromTheExportAndTheValuePickerTooTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));

		// When: the two reads that do not go through findReportRows
		service.exportReportRows(null, 42L, List.of(), null, List.of(), ReportRowDateRangeModel.none());
		service.findDistinctValues(null, 42L, ReportRowSortField.TACTIC);

		// Then: a downloaded file and a filter's value list agree with the table about where the data ends
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, atLeastOnce()).query(sql.capture());
		assertThat(sql.getAllValues()).isNotEmpty();
		assertThat(sql.getAllValues()).allSatisfy(query -> assertThat(query).contains("`date` < CURRENT_DATE()"));
	}

	@Test
	void shouldTakeConversionsFromTheConversionsMartNotTheDeliveryOneTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the delivery view's own conversions total is not selected - it would collide on the alias
		// with the joined value. Its attribution split has no such conflict and is read as its own metric,
		// which is what a user ticking Post-View Conversions asks for
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).doesNotContain("`conversions` AS conversions");
		assertThat(dataQuery).contains("`post_click_conversions` AS post_click_conversions");
		assertThat(dataQuery).contains("`post_view_conversions` AS post_view_conversions");
		// And the join brings it from the other mart, summed over its actions down to the shared grain,
		// every joined column renamed apart from the delivery column it would otherwise collide with
		assertThat(dataQuery).contains(
				"LEFT JOIN (SELECT `date` AS conv_date, `constructed_name` AS conv_constructed_name, "
						+ "`constructed_name_lvl3` AS conv_constructed_name_lvl3");
		assertThat(dataQuery).contains("FROM `conversions_view`");
		assertThat(dataQuery).contains("SUM(`conversions`) AS conv_conversions");
		assertThat(dataQuery).contains("GROUP BY `date`, `constructed_name`, `constructed_name_lvl3`) conv ON");
		assertThat(dataQuery).contains("ELSE conv.`conv_conversions` END AS conversions");
	}

	@Test
	void shouldTakeConversionAdjustmentMetadataFromTheConversionsMartTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: conversion adjustments are collapsed in the conversions mart subquery, then exposed under
		// the report row's existing audit columns. The campaign-level-channel guard is the same one used
		// for the conversion figure itself, so search/YouTube metadata does not appear on rows whose
		// conversions cell is blank.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains(
				"STRING_AGG(DISTINCT NULLIF(NULLIF(TRIM(`adjusted_metrics`), ''), 'Non-existent data'), ',') "
						+ "AS conv_adjusted_metrics");
		assertThat(dataQuery).contains(
				"ARRAY_AGG(`created_at` IGNORE NULLS ORDER BY `last_modified_at` DESC LIMIT 1)[SAFE_OFFSET(0)] "
						+ "AS conv_created_at");
		assertThat(dataQuery).contains("conv.`conv_adjusted_metrics`");
		assertThat(dataQuery).contains("AS adjusted_metrics");
		assertThat(dataQuery).contains("COALESCE(CASE WHEN (`CNB_channel` IN ('Google SEM', 'Google Search', 'YouTube')");
		assertThat(dataQuery).contains("ELSE conv.`conv_created_at` END, `created_at`) AS created_at");
		assertThat(dataQuery).contains("ELSE conv.`conv_last_modified_by` END, `last_modified_by`) AS last_modified_by");
		assertThat(dataQuery).doesNotContain("`adjusted_metrics` AS adjusted_metrics, `created_at` AS created_at");
	}

	@Test
	void shouldLeaveEveryUnqualifiedColumnOfTheJoinedQueryWithOneSourceTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the delivery side of the join is an unaliased table, and the query reads `date`,
		// `constructed_name` and `constructed_name_lvl3` unqualified in its select list, its window
		// partition and its filters. If the joined subquery exposed any of those names too, BigQuery would
		// have two candidate sources and reject the whole query - "Column name date is ambiguous".
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		String subquery = dataQuery.substring(dataQuery.indexOf("LEFT JOIN ("), dataQuery.indexOf(") conv ON"));
		assertThat(subquery).doesNotContain("AS date");
		assertThat(subquery).doesNotContain("AS constructed_name");
		assertThat(subquery).doesNotContain("AS constructed_name_lvl3");
	}

	@Test
	void shouldScopeTheJoinedConversionsToTheSameCampaignAndWindowTest() {
		// Given: a report narrowed to a window
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-01", "2026-03-31")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(), null,
				List.of(new ReportRowFilterModel(ReportRowSortField.TACTIC, List.of("Prospecting"))),
				new ReportRowDateRangeModel("2026-03-01", "2026-03-31"));

		// Then: the conversions side carries the campaign, the window and today's exclusion...
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		// The subquery alone: the join clause renders before the outer WHERE, so everything after it would
		// include the report's own predicates and prove nothing
		String conversionsSide = dataQuery.substring(
				dataQuery.indexOf("LEFT JOIN ("), dataQuery.indexOf(") conv ON"));
		assertThat(conversionsSide).contains("`constructed_name` IN (SELECT `constructed_name` FROM "
				+ "(SELECT 'Retargeting' AS `constructed_name`))");
		assertThat(conversionsSide).contains("`date` >= '2026-03-01'");
		assertThat(conversionsSide).contains("`date` < CURRENT_DATE()");
		// ...but not the report's dimension filters. The two marts are filled by different pipelines, so a
		// tactic filter meant for delivery rows could drop the conversions row belonging to a row it keeps.
		assertThat(conversionsSide).doesNotContain("Prospecting");
	}

	@Test
	void shouldAggregateTheJoinedRowsWhenGroupingRatherThanTheViewTest() {
		// Given: a grouped report
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL), null, List.of(),
				ReportRowDateRangeModel.none());

		// Then: grouped one level out from the join. The conversions expression carries a window function
		// and BigQuery will not have one inside SUM(), so the rows are joined first and aggregated after.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).startsWith("SELECT `CNB_channel` AS CNB_channel, SUM(`impressions`)");
		assertThat(dataQuery).contains("FROM (SELECT `date` AS date");
		assertThat(dataQuery).contains("SUM(`conversions`) AS conversions");
		assertThat(dataQuery).contains("GROUP BY `CNB_channel`");
	}

	@Test
	void shouldLeaveTheBulkUploadBaselineUnjoinedTest() {
		// Given: an upload to diff against the delivery metrics it can actually write
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));

		// When:
		Map<String, String> cells = workbookCells(reportRow());
		service.applyBulkAdjustments(
				null, 42L,
				List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then: no conversions mart scanned - the baseline compares nothing that comes from it
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, atLeastOnce()).query(sql.capture());
		assertThat(sql.getAllValues()).allSatisfy(query -> assertThat(query).doesNotContain("conversions_view"));
	}

	@Test
	void shouldGroupByEveryRequestedDimensionAndAggregateTheMetricsTest() {
		// Given: a report the user narrowed to date + channel
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.DATE, ReportRowSortField.CHANNEL), null, List.of(), ReportRowDateRangeModel.none());

		// Then: one row per (date, channel), with the metrics rolled up over it
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("GROUP BY `date`, `CNB_channel`");
		assertThat(dataQuery).contains("SUM(`impressions`) AS impressions");
		// The rate is a ratio, so it re-derives from summed cost over summed billable units rather than
		// averaging the group's rows - a one-impression row must not weigh as much as a million-impression one
		assertThat(dataQuery).contains(
				"SAFE_DIVIDE(SUM(`dynamic_cost`), SUM(CASE `rate_type`"
						+ " WHEN 'CPM' THEN SAFE_DIVIDE(`impressions`, 1000)"
						+ " WHEN 'CPC' THEN `clicks`"
						+ " WHEN 'CPV' THEN `starts` END)) AS dynamic_rate");
		assertThat(dataQuery).doesNotContain("AVG(`dynamic_rate`)");
		// Ungrouped dimensions are not selected at all - the client renders them blank. Asserted on the
		// statement's own projection rather than the whole string: the joined conversions subquery selects
		// level 3 to match on, which is not this query selecting it as a column.
		String projection = dataQuery.substring(0, dataQuery.indexOf(" FROM "));
		assertThat(projection).doesNotContain("`constructed_name_lvl3` AS");
	}

	@Test
	void shouldCarryTheRateBenchmarkAndAttributionSplitIntoAGroupedReadTest() {
		// Given: a report grouped by date and channel
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null,
				42L,
				1,
				25,
				List.of(ReportRowSortField.DATE, ReportRowSortField.CHANNEL),
				null,
				List.of(),
				ReportRowDateRangeModel.none());

		// Then: neither reads blank on a grouped view any more. The rate benchmark is averaged, since the
		// view already computed it per (date, tactic) and summing it would report a rate no card contains;
		// the attribution split sums like any other count
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains(
				"AVG(`avg_dynamic_rate_by_date_tactic`) AS avg_dynamic_rate_by_date_tactic");
		assertThat(dataQuery).contains("SUM(`post_click_conversions`) AS post_click_conversions");
		assertThat(dataQuery).contains("SUM(`post_view_conversions`) AS post_view_conversions");
		// And the aggregate reads the joined subquery, not the view: BigQuery refuses an aggregate over the
		// window function the view computes the benchmark with when both sit in one query block
		assertThat(dataQuery).doesNotContain("AVG(AVG(");
		assertThat(dataQuery).doesNotContain("SUM(AVG(");
	}

	@Test
	void shouldOrderAGroupedReadByTheMetricAggregateNotItsBareColumnTest() {
		// Given: a bare metric column is not valid under GROUP BY, and the aggregate cannot go in the
		// ORDER BY either - the metric's own alias would shadow the column inside it
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL),
				new SortCriterion<>(ReportRowSortField.IMPRESSIONS, SortDirection.DESC), List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("SUM(`impressions`) AS sort_value");
		assertThat(dataQuery).contains("ORDER BY `sort_value` DESC NULLS LAST");
		// The aggregate must not appear in the ORDER BY itself: `impressions` there resolves to the
		// SUM(...) aliased above it, and BigQuery rejects the aggregate of an aggregate that makes.
		assertThat(dataQuery).doesNotContain("ORDER BY SUM(");
	}

	@Test
	void shouldFallBackToTheFirstGroupedDimensionWhenTheSortColumnIsNotGroupedTest() {
		// Given: sorted by tactic, which the user has since dropped from the dimensions - ORDER BY may
		// only reference a grouped column or an aggregate, so that sort cannot be expressed at all
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL),
				new SortCriterion<>(ReportRowSortField.TACTIC, SortDirection.ASC), List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("ORDER BY `CNB_channel` ASC NULLS LAST");
		assertThat(dataQuery).doesNotContain("`CNB_tactic` ASC NULLS LAST");
	}

	@Test
	void shouldOrderGroupedRowsWithTheRemainingSelectedDimensionsAsTiebreakersTest() {
		// Given: grouped rows often have ties on the default/fallback sort dimension, and only selected
		// dimensions are legal in grouped ORDER BY clauses.
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25,
				List.of(ReportRowSortField.CHANNEL, ReportRowSortField.TACTIC, ReportRowSortField.LINE_ITEM_ID),
				null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery)
				.contains("ORDER BY `CNB_channel` ASC NULLS LAST, `CNB_tactic` ASC, `constructed_id` ASC");
	}

	@Test
	void shouldOrderByTheRequestedDimensionAscendingWithLineItemAsATiebreakerTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CHANNEL, SortDirection.ASC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("ORDER BY `CNB_channel` ASC NULLS LAST, `date` ASC, `constructed_id` ASC");
	}

	@Test
	void shouldOrderDescendingWhenRequestedTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CAMPAIGN_NAME, SortDirection.DESC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		// The DESC direction must bind to the requested column itself, not just to the tiebreaker
		// appended after it - a regression that once left every descending sort silently sorting
		// ascending except for its tiebreak order.
		assertThat(dataQuery).contains("ORDER BY `CNB_campaign_name` DESC NULLS LAST, `date` ASC");
		assertThat(dataQuery).contains("`constructed_id` ASC");
		assertThat(dataQuery).doesNotContain("`constructed_id` DESC");
	}

	@Test
	void shouldNotDuplicateTheTiebreakerWhenSortingByLineItemIdItselfTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.LINE_ITEM_ID, SortDirection.ASC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("ORDER BY `constructed_id` ASC NULLS LAST");
		assertThat(dataQuery).doesNotContain("`constructed_id`, `constructed_id`");
	}

	@Test
	void shouldOrderByARawMetricColumnTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.IMPRESSIONS, SortDirection.DESC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("ORDER BY `impressions` DESC NULLS LAST, `date` ASC, `constructed_id` ASC");
	}

	@Test
	void shouldOrderByADerivedMetricsOwnRatioExpressionRatherThanAColumnTest() {
		// Given: CPM is not a stored column - it must sort by the same derived ratio the response
		// computes it with, not a `cpm` column reference (which does not exist in the view)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CPM, SortDirection.ASC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		// The ratio's own expression, so NULLS LAST binds to it rather than to the tiebreaker. Built on the
		// rate-card cost, not spend - see ReportRowMetricSql.
		assertThat(dataQuery).contains("`dynamic_cost` END, `impressions`) * 1000) END ASC NULLS LAST, `date` ASC");
		assertThat(dataQuery).doesNotContain("SAFE_DIVIDE(`spend`, `impressions`)");
	}

	@Test
	void shouldOrderByADerivedMetricDescendingWithNullsStillLastTest() {
		// Given: rows with zero impressions make SAFE_DIVIDE return NULL for CPM - NULLS LAST must bind
		// to the CPM expression itself so those rows sink to the bottom in BOTH directions, rather than
		// clumping at the top regardless of which direction was requested
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CPM, SortDirection.DESC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("* 1000) END DESC NULLS LAST, `date` ASC");
	}

	@Test
	void shouldNotAddAnOrderByToTheAggregateQueryTest() {
		// Given: the aggregate query is a single-row, no-GROUP-BY aggregate - display sort must not
		// affect the totals it computes
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CHANNEL, SortDirection.DESC);

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), sort, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String aggregateQuery =
				sql.getAllValues().stream().filter(q -> q.contains(AGGREGATE_QUERY)).findFirst().orElseThrow();
		// "NULLS LAST" rather than "ORDER BY": every statement-level sort renders it, while the window
		// function that decides which row takes a campaign-level channel's conversions carries an ORDER BY
		// of its own that has nothing to do with how the result is sorted.
		assertThat(aggregateQuery).doesNotContain("NULLS LAST");
	}

	@Test
	void shouldFilterByADimensionsMultipleValuesOnBothTheDataAndAggregateQueryTest() {
		// Given: a single filter with multiple values - a row matches when it's any of them (IN)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		List<ReportRowFilterModel> filters = List.of(new ReportRowFilterModel(ReportRowSortField.CHANNEL, List.of("Display", "Video")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, filters, ReportRowDateRangeModel.none());

		// Then: the totals must reflect the SAME filtered subset the rows come from, not the whole
		// campaign - so the predicate must land on both queries
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		for (String query : sql.getAllValues()) {
			assertThat(query).contains("`CNB_channel` IN ('Display', 'Video')");
		}
	}

	@Test
	void shouldAndMultipleDimensionFiltersTogetherTest() {
		// Given: two filters on different dimensions - both must hold (AND), each matching any of its
		// own values (OR/IN)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		List<ReportRowFilterModel> filters = List.of(
				new ReportRowFilterModel(ReportRowSortField.CHANNEL, List.of("Display")),
				new ReportRowFilterModel(ReportRowSortField.TACTIC, List.of("Retargeting", "Prospecting")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, filters, ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("`CNB_channel` IN ('Display') AND `CNB_tactic` IN ('Retargeting', 'Prospecting')");
	}

	@Test
	void shouldIgnoreAFilterWithNoValuesTest() {
		// Given: an empty values list is a no-op, matching whereIn's own numeric-id precedent
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));
		List<ReportRowFilterModel> filters = List.of(new ReportRowFilterModel(ReportRowSortField.CHANNEL, List.of()));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, filters, ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		// Anchored to the WHERE clause: the modelled-IVT expression legitimately tests CNB_channel with
		// its own IN list, so a bare substring check would match that instead of a filter predicate.
		assertThat(dataQuery).doesNotContain("AND `CNB_channel` IN");
	}

	@Test
	void shouldNotApplyFiltersToTheDistinctValuesQueryTest() {
		// Given: the filter picker for one dimension must list its full value set regardless of the
		// other filters currently active - findDistinctValues never takes a filters argument at all
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of("CNB_tactic", "Retargeting")));

		// When:
		service.findDistinctValues(null, 42L, ReportRowSortField.TACTIC);

		// Then: only the base campaign-scoping predicates are present - no IN-clause filter on the
		// very dimension being distinct-valued (the base query's own campaign-name/client AND is fine)
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(1)).query(sql.capture());
		assertThat(sql.getValue()).doesNotContain("`CNB_tactic` IN (");
	}

	@Test
	void shouldReturnPage1WithLimitedRowsTest() {
		// Given: page 1 at size 25 (LIMIT 26 - one extra row past the page size to peek for hasNext -
		// OFFSET 0)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 3, "2026-03-01", "2026-03-30")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		assertThat(page.pageNumber()).isEqualTo(1);
		assertThat(page.pageSize()).isEqualTo(25);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("LIMIT 26 OFFSET 0");
	}

	@Test
	void shouldUseCorrectOffsetForPage2Test() {
		// Given: page 2 at size 25 (LIMIT 26 OFFSET 25 - the offset is still based on the true page
		// size, only the limit grows by one)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 3, "2026-03-01", "2026-03-30")));

		// When:
		service.findReportRows(null, 42L, 2, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("LIMIT 26 OFFSET 25");
	}

	@Test
	void shouldSetHasNextTrueAndTrimTheExtraRowWhenMoreRowsExistTest() {
		// Given: page size 2, but 3 rows come back (the peeked extra row past the page size)
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow(), reportRow(), reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(999_999, 999_999, 999_999.0, 999_999, 12, "2026-01-01", "2026-06-30")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 2, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the extra (3rd) row is trimmed off content, but hasNext reports it existed
		assertThat(page.hasNext()).isTrue();
		assertThat(page.content()).hasSize(2);
	}

	@Test
	void shouldSetHasNextFalseWhenNoMoreRowsExistTest() {
		// Given: page size 25, but only 1 row comes back - nothing left to peek
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(999_999, 999_999, 999_999.0, 999_999, 12, "2026-01-01", "2026-06-30")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		assertThat(page.hasNext()).isFalse();
		assertThat(page.content()).hasSize(1);
	}

	@Test
	void shouldComputeTotalsAndDateRangeFromTheAggregateQueryNotJustTheLoadedRowsTest() {
		// Given: the loaded page has only 1 row, but the aggregate query's full-dataset numbers differ
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(999_999, 999_999, 999_999.0, 999_999, 12, "2026-01-01", "2026-06-30")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: totals reflect the aggregate query's full-dataset numbers, not the single loaded row
		assertThat(page.totals().impressions()).isEqualTo(999_999L);
		assertThat(page.minDate()).isEqualTo("2026-01-01");
		assertThat(page.maxDate()).isEqualTo("2026-06-30");
		assertThat(page.distinctLineItemCount()).isEqualTo(12L);
	}

	@Test
	void shouldReadTheTotalsRatiosOffTheAggregateRatherThanDividingItsSumsTest() {
		// Given: an aggregate whose ratios do NOT equal its own summed counts divided out. That is the
		// normal case, not a contrived one: each ratio is summed over only the rows whose channel prices
		// that metric, so 25/1000*1000 = 25 is the wrong CPM whenever some of those impressions came from
		// a channel with no CPM at all.
		givenCampaign();
		Map<String, Object> aggregate = aggregateRow(1000, 20, 25.0, 900, 1, "2026-03-10", "2026-03-10");
		aggregate.put("cpm", 31.5);
		aggregate.put("ctr", 4.0);
		aggregate.put("avcr", 88.0);
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregate));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: what BigQuery computed, where the channel was still in scope to gate it
		assertThat(page.totals().cpm()).isEqualTo(31.5);
		assertThat(page.totals().ctr()).isEqualTo(4.0);
		assertThat(page.totals().avcr()).isEqualTo(88.0);
	}

	@Test
	void shouldGateEachTotalsRatioToTheRowsThatPriceThatMetricTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(1000, 20, 25.0, 900, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the gate sits inside both sums, so an ineligible row contributes to neither side. Summing
		// everything and dividing once would put a search line's cost into a CPM whose impressions were
		// never counted.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String aggregateSql = sql.getAllValues().stream().filter(q -> q.contains(AGGREGATE_QUERY)).findFirst().orElseThrow();
		assertThat(aggregateSql).contains("AS cpm").contains("AS cpc").contains("AS cpv");
		assertThat(aggregateSql).contains("AS ctr").contains("AS avcr");
		// Cost is the rate card with Added Value free, not spend
		assertThat(aggregateSql).contains("CASE WHEN `CNB_other` = 'Added Value' THEN 0 ELSE `dynamic_cost` END");
		assertThat(aggregateSql).doesNotContain("SAFE_DIVIDE(SUM(`spend`), SUM(`impressions`))");
	}

	@Test
	void shouldReturnNullDerivedMetricsWhenImpressionsIsZeroTest() {
		// Given: no impressions at all
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(0, 0, 0.0, 0, 0, null, null)));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: derived metrics are null, not a divide-by-zero artifact
		assertThat(page.totals().cpm()).isNull();
		assertThat(page.totals().ctr()).isNull();
		assertThat(page.totals().avcr()).isNull();
	}

	@Test
	void shouldPriceAViewByCompletionsRatherThanStartsTest() {
		// Given: the report's CPV divides by completions, unlike the rate card's own CPV which divides by
		// starts - two conventions that genuinely differ, and the client-facing one wins in a report
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(1000, 20, 25.0, 900, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String aggregateSql = sql.getAllValues().stream().filter(q -> q.contains(AGGREGATE_QUERY)).findFirst().orElseThrow();
		assertThat(aggregateSql).contains("THEN `completes` END)) AS cpv");
		assertThat(aggregateSql).doesNotContain("THEN `starts` END)) AS cpv");
		// The rate card's own CPV still counts starts - BILLABLE_UNITS is untouched by this
		assertThat(aggregateSql).contains("WHEN 'CPV' THEN `starts`");
	}

	@Test
	void shouldCountTheWholeResultOnTheDataQueryRatherThanInItsOwnJobTest() {
		// Given: a page of rows, each carrying the same window-function total
		givenCampaign();
		Map<String, Object> row = reportRow();
		row.put("total", 138L);
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(row));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(1000, 10, 25.0, 5, 1, "2026-03-10", "2026-03-10")));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: reported, and still only the two jobs that were already being run
		assertThat(page.totalRows()).isEqualTo(138L);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("COUNT(*) OVER () AS total");
	}

	@Test
	void shouldReportZeroTotalRowsWhenThePageIsEmptyTest() {
		// Given: no rows at all, so there is none to read the window total off
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(0, 0, 0.0, 0, 0, null, null)));

		// When:
		ReportRowPageModel page = service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		assertThat(page.totalRows()).isZero();
		assertThat(page.hasNext()).isFalse();
	}

	@Test
	void shouldNarrowBothThePageAndItsAggregatesToTheRequestedWindowTest() {
		// Given: totals covering a wider window than the rows beneath them would be worse than no totals,
		// so the window has to reach the aggregate query too - not just the page
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(1000, 10, 25.0, 5, 1, "2026-06-17", "2026-07-31")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(), null, List.of(),
				new ReportRowDateRangeModel("2026-06-17", "2026-07-31"));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		assertThat(sql.getAllValues()).allSatisfy(query -> assertThat(query)
				.contains("`date` >= '2026-06-17'")
				.contains("`date` <= '2026-07-31'"));
	}

	@Test
	void shouldLeaveTheReadUnboundedWhenOnlyOneEndOfTheWindowIsGivenTest() {
		// Given: an open-ended window - "everything from June onwards"
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY)))
				.thenReturn(List.of(aggregateRow(1000, 10, 25.0, 5, 1, "2026-06-17", "2026-07-31")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(), null, List.of(), new ReportRowDateRangeModel("2026-06-17", null));

		// Then: only the bound that was given is applied
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("`date` >= '2026-06-17'");
		assertThat(dataQuery).doesNotContain("`date` <=");
	}

	@Test
	void shouldReadTheBulkUploadBaselineUnwindowedTest() {
		// Given: the sheet's own dates bound that read, and a window carried over from the screen the
		// sheet was downloaded from would silently drop rows the sheet contains
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		Map<String, String> cells = workbookCells(reportRow());
		// Equal to the baseline, so the upload changes nothing and only the baseline read happens
		cells.put("spend", "92.5");

		// When:
		service.applyBulkAdjustments(null, 42L, List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(1)).query(sql.capture());
		assertThat(sql.getAllValues()).allSatisfy(query -> assertThat(query).doesNotContain("`date` >="));
	}

	@Test
	void shouldModelIvtDeterministicallyFromTheImpressionCountsLastDigitTest() {
		// Given: a plain read
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(1000, 10, 25.0, 5, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: keyed on the impression count itself, never on a random draw - re-reading a row has to
		// reproduce yesterday's figure - and capped below the 5% benchmark
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("CASE MOD(`impressions`, 10)");
		assertThat(dataQuery).contains("WHEN 6 THEN ((`impressions` * 4.95) / 100.00)");
		assertThat(dataQuery).doesNotContain("RAND(");
		// and blank where the channel publishes its own figure or has no click to reason from
		assertThat(dataQuery).contains("WHEN `CNB_channel` IN ('Amazon Display'");
		assertThat(dataQuery).contains("'CTV', 'Live Sports', 'CTV Live Sports', 'DOOH'");
	}

	@Test
	void shouldSumIvtOverAGroupRatherThanRemodelItFromTheTotalTest() {
		// Given: a grouped read - re-applying the coefficient to a summed impression count would pick a
		// coefficient by the total's last digit and disagree with every row it covers
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(1000, 10, 25.0, 5, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL), null, List.of(), ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("SUM(ROUND(CASE WHEN `CNB_channel` IN (");
		assertThat(dataQuery).doesNotContain("MOD(SUM(`impressions`)");
	}

	@Test
	void shouldOrderAGroupedReadByARatioOverSummedComponentsTest() {
		// Given: sorted by CPM, whose per-row form divides two bare columns - invalid under GROUP BY
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL),
				new SortCriterion<>(ReportRowSortField.CPM, SortDirection.DESC), List.of(), ReportRowDateRangeModel.none());

		// Then: it orders by the group's own CPM - each side summed over the rows that price impressions -
		// selected under the sort alias, where the columns inside it still mean the columns
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("* 1000) AS sort_value");
		assertThat(dataQuery).contains("ORDER BY `sort_value` DESC NULLS LAST");
		// Summed inside the gate, not divided outside it: SUM(CASE WHEN eligible THEN cost END)
		assertThat(dataQuery).contains("SAFE_DIVIDE(SUM(CASE WHEN ");
		assertThat(dataQuery).doesNotContain("SAFE_DIVIDE(SUM(`spend`), SUM(`impressions`))");
	}

	@Test
	void shouldOrderAGroupedReadByModelledIvtWithoutNestingAggregatesTest() {
		// Given: IVT's grouped form sums a per-row CASE over `impressions`, and `impressions` is also the
		// alias of SUM(`impressions`) in the same select list
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL),
				new SortCriterion<>(ReportRowSortField.IVT, SortDirection.DESC), List.of(), ReportRowDateRangeModel.none());

		// Then: the sum stays in the select list, where `impressions` is the column, and the ORDER BY only
		// names the alias - the shape that used to fail with "Aggregations of aggregations are not allowed"
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).contains("AS sort_value");
		assertThat(dataQuery).contains("ORDER BY `sort_value` DESC NULLS LAST");
		assertThat(dataQuery).doesNotContain("ORDER BY SUM(");
		assertThat(dataQuery).doesNotContain("ORDER BY ROUND(");
	}

	@Test
	void shouldNotSelectASortValueWhenAGroupedReadSortsByADimensionTest() {
		// Given: a dimension is a grouped column, valid in the ORDER BY as itself
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(
				null, 42L, 1, 25, List.of(ReportRowSortField.CHANNEL, ReportRowSortField.DATE),
				new SortCriterion<>(ReportRowSortField.CHANNEL, SortDirection.ASC), List.of(), ReportRowDateRangeModel.none());

		// Then: no extra column is read for a sort that needs none
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataQuery = sql.getAllValues().stream().filter(q -> q.contains(DATA_QUERY)).findFirst().orElseThrow();
		assertThat(dataQuery).doesNotContain("sort_value");
		assertThat(dataQuery).contains("ORDER BY `CNB_channel` ASC NULLS LAST");
	}

	@Test
	void shouldDelegateCampaignResolutionToCampaignServiceTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		service.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the campaign id itself is passed straight through to the shared resolution helper -
		// BigQueryCampaignServiceTest covers how that helper turns the id into a visibility-scoped search
		verify(campaignService).getVisibleCampaignIdentity(null, 42L);
	}

	@Test
	void shouldThrowWhenCampaignIsNotFoundOrNotVisibleTest() {
		// Given: an inaccessible campaign resolves the same as an unknown one (CampaignService's own
		// RBAC-scoped resolution throws OPH_025 for both cases)
		when(campaignService.getVisibleCampaignIdentity(any(), anyLong()))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_025, 99L));

		// When/Then:
		assertThatThrownBy(() -> service.findReportRows(
				null, 99L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none()))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025")
				.hasMessageContaining("99");
	}

	@Test
	void shouldMapEveryColumnOfARowTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregateRow(5000, 12, 92.5, 4400, 1, "2026-03-10", "2026-03-10")));

		// When:
		ReportRowModel row = service
				.findReportRows(null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none())
				.content().getFirst();

		// Then:
		assertThat(row.date()).isEqualTo("2026-03-10");
		assertThat(row.platform()).isEqualTo("DV360");
		assertThat(row.lineItemName()).isEqualTo("Retargeting");
		assertThat(row.lineItemId()).isEqualTo("LI-1");
		assertThat(row.insertionOrderName()).isEqualTo("Display — Ourisman Ford 2026");
		assertThat(row.insertionOrderId()).isEqualTo("IO-1");
		assertThat(row.campaignConstructedName()).isEqualTo("Ourisman Ford 2026");
		assertThat(row.campaignConstructedId()).isEqualTo("CAMP-1");
		assertThat(row.client()).isEqualTo("Ourisman Ford");
		assertThat(row.channel()).isEqualTo("Display");
		assertThat(row.tactic()).isEqualTo("Retargeting");
		assertThat(row.impressions()).isEqualTo(5000L);
		assertThat(row.clicks()).isEqualTo(12L);
		assertThat(row.spend()).isEqualTo(92.5);
		assertThat(row.completes()).isEqualTo(4400L);
		assertThat(row.conversions()).isEqualTo(2.0);
		assertThat(row.postClickConversions()).isEqualTo(1.0);
		assertThat(row.postViewConversions()).isEqualTo(1.0);
		assertThat(row.dynamicCost()).isEqualTo(90.0);
		assertThat(row.linkClicks()).isEqualTo(8L);
		assertThat(row.lastModifiedAt()).isEqualTo("2026-07-10T00:00:00");
		assertThat(row.rateType()).isEqualTo("CPM");
		assertThat(row.dynamicRate()).isEqualTo(18.5);
		assertThat(row.avgDynamicRateByDateTactic()).isEqualTo(19.1);
		assertThat(row.lineItemDescription()).isEqualTo("Retargeting - Display");
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(contains(DATA_QUERY))).thenThrow(new BigQueryExternalException("boom"));

		// When/Then:
		assertThatThrownBy(() -> service.findReportRows(
				null, 42L, 1, 25, List.of(), null, List.of(), ReportRowDateRangeModel.none()))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("BigQuery data query failed")
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldQueryDistinctNonNullValuesForTheRequestedFieldOrderedAndCappedTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(
				List.of(Map.of("CNB_channel", "Display"), Map.of("CNB_channel", "Video")));

		// When:
		List<String> values = service.findDistinctValues(null, 42L, ReportRowSortField.CHANNEL);

		// Then:
		assertThat(values).containsExactly("Display", "Video");
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(1)).query(sql.capture());
		assertThat(sql.getValue()).contains("SELECT DISTINCT `CNB_channel` AS CNB_channel");
		assertThat(sql.getValue()).contains("`constructed_name` IN (SELECT `constructed_name` FROM "
				+ "(SELECT 'Retargeting' AS `constructed_name`))");
		assertThat(sql.getValue()).contains("`CNB_channel` IS NOT NULL");
		assertThat(sql.getValue()).contains("ORDER BY `CNB_channel` ASC NULLS LAST");
		assertThat(sql.getValue()).contains("LIMIT 500 OFFSET 0");
	}

	@Test
	void shouldSelectTheRequestedFieldsOwnColumnNotAFixedOneTest() {
		// Given: a different field than the previous test - the column selected/filtered/ordered must
		// follow the requested field, not a copy-pasted constant
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of("CNB_tactic", "Prospecting")));

		// When:
		List<String> values = service.findDistinctValues(null, 42L, ReportRowSortField.TACTIC);

		// Then:
		assertThat(values).containsExactly("Prospecting");
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(1)).query(sql.capture());
		assertThat(sql.getValue()).contains("SELECT DISTINCT `CNB_tactic` AS CNB_tactic");
		assertThat(sql.getValue()).contains("`CNB_tactic` IS NOT NULL");
		assertThat(sql.getValue()).contains("ORDER BY `CNB_tactic` ASC NULLS LAST");
	}

	@Test
	void shouldExportAllMatchingRowsWithoutPagingTest() {
		// Given:
		givenCampaign();
		Map<String, Object> aggregate = aggregateRow(3_000_000, 900, 4_350.0, 4400, 6, "2026-03-01", "2026-03-10");
		aggregate.put("cpm", 1.45);
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(reportRow(), reportRow()));
		when(bigQueryClient.query(contains(AGGREGATE_QUERY))).thenReturn(List.of(aggregate));

		// When:
		ReportRowExportModel export = service.exportReportRows(null, 42L, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the rows, uncapped by paging, plus the report's own totals
		assertThat(export.rows()).hasSize(2);
		assertThat(export.truncated()).isFalse();
		assertThat(export.campaignName()).isEqualTo("Ourisman Ford 2026");
		// The screen's own figure, read off the same aggregate the page reads - not the mean of the rows'
		// own CPMs, which is the discrepancy that put the totals in the workbook to begin with.
		assertThat(export.totals().cpm()).isEqualTo(1.45);
		assertThat(export.totals().impressions()).isEqualTo(3_000_000L);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		assertThat(sql.getAllValues().get(0)).contains("LIMIT 100001 OFFSET 0");
	}

	@Test
	void shouldFlagTruncationPastTheCapTest() {
		// Given: one more row than the export cap (100_000) comes back from the peek
		givenCampaign();
		List<Map<String, Object>> rows = new ArrayList<>();
		for (int i = 0; i < 100_001; i++) {
			rows.add(reportRow());
		}
		when(bigQueryClient.query(anyString())).thenReturn(rows);

		// When:
		ReportRowExportModel export = service.exportReportRows(null, 42L, List.of(), null, List.of(), ReportRowDateRangeModel.none());

		// Then: trimmed to the cap, flagged truncated
		assertThat(export.truncated()).isTrue();
		assertThat(export.rows()).hasSize(100_000);
	}

	@Test
	void shouldExportTheGroupedViewAtTheSameGrainTheTableShowsTest() {
		// Given: a report the user narrowed to date + channel on screen
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));

		// When: that same view is exported
		service.exportReportRows(
				null, 42L, List.of(ReportRowSortField.DATE, ReportRowSortField.CHANNEL), null, List.of(), ReportRowDateRangeModel.none());

		// Then: the download is the view, not the raw rows the view had already collapsed
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		String dataSql = sql.getAllValues().get(0);
		assertThat(dataSql).contains("GROUP BY `date`, `CNB_channel`");
		assertThat(dataSql).contains("SUM(`impressions`) AS impressions");
		assertThat(dataSql).contains("LIMIT 100001 OFFSET 0");
		// The totals stay ungrouped whatever the rows are grouped by - they answer "across everything
		// this report matches", which is the same number the on-screen totals row states. Asserted against
		// the grouping under test rather than any GROUP BY at all: the joined conversions subquery groups
		// to reach its own grain, which is not the totals query grouping itself.
		assertThat(sql.getAllValues().get(1)).doesNotContain("GROUP BY `date`, `CNB_channel`");
	}

	@Test
	void shouldApplyTheRequestedFiltersAndSortToTheExportQueryTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CHANNEL, SortDirection.DESC);
		List<ReportRowFilterModel> filters = List.of(new ReportRowFilterModel(ReportRowSortField.TACTIC, List.of("Prospecting")));

		// When:
		service.exportReportRows(null, 42L, List.of(), sort, filters, ReportRowDateRangeModel.none());

		// Then: both the rows and the totals are narrowed by the same filters
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		assertThat(sql.getAllValues().get(0)).contains("`CNB_tactic` IN ('Prospecting')");
		assertThat(sql.getAllValues().get(0))
				.contains("ORDER BY `CNB_channel` DESC NULLS LAST, `date` ASC, `constructed_id` ASC");
		assertThat(sql.getAllValues().get(1)).contains("`CNB_tactic` IN ('Prospecting')");
	}

	private AdjustmentRowModel overrideAdjustment(Long impressions) {
		return new AdjustmentRowModel(
				false,
				"2026-03-10", null, null, null,
				null, "LI-1",
				null, null,
				null, null,
				null, "Ourisman Ford", null, "Ourisman Ford 2026", null, null,
				null, null, null, null,
				null, null, null, null,
				null, null,
				impressions, null, null, null, null,
				null, null, null, null,
				null,
				"impressions");
	}

	private AdjustmentRowModel addedAdjustment() {
		return new AdjustmentRowModel(
				true,
				"2026-03-15", null, null, null,
				"New Line", "LI-NEW",
				null, null,
				null, null,
				null, "Ourisman Ford", null, "Ourisman Ford 2026", "Display", null,
				null, null, null, null,
				null, null, null, null,
				null, null,
				1000L, null, null, null, null,
				null, null, null,
				null, null,
				null);
	}

	private AdjustmentRowModel adjustmentWithRequiredFields(
			boolean added, String date, String lineItemName, String lineItemId) {
		return new AdjustmentRowModel(
				added,
				date, null, null, null,
				lineItemName, lineItemId,
				null, null,
				null, null,
				null, null, null, null, null, null,
				null, null, null, null,
				null, null, null, null,
				null, null,
				null, null, null, null, null,
				null, null, null,
				null, null,
				null);
	}

	private AdjustmentRowModel overrideAdjustmentWithConstructedName(String constructedName) {
		return new AdjustmentRowModel(
				false,
				"2026-08-10", null, null, null,
				constructedName, "717852",
				null, null,
				null, null,
				"TrueM", null, "19", null, "CTV/OTT", null,
				null, null, "717852", null,
				null, null, null, null,
				null, null,
				100L, null, null, null, null,
				null, null, null, null,
				null,
				"impressions");
	}

	@Test
	void shouldAppendAnOverrideRowStampedWithCampaignIdentityAndUserTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);

		// When:
		long affected = service.saveAdjustments(user, 42L, List.of(overrideAdjustment(1234L)));

		// Then:
		assertThat(affected).isEqualTo(1L);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("INSERT INTO `adjustments_table`");
		assertThat(sql.getValue()).contains("`CNB_campaign_name`");
		assertThat(sql.getValue()).contains("'Ourisman Ford 2026'");
		assertThat(sql.getValue()).contains("'Ourisman Ford'");
		assertThat(sql.getValue()).contains("1234");
		assertThat(sql.getValue()).contains("'" + user.email() + "'");
			assertThat(sql.getValue()).contains("CURRENT_DATETIME()");
		}

		@Test
		void shouldDeriveAdjustmentCampaignIdentityFromMartConstructedNameTest() {
			// Given: the Hub campaign name differs from the naming-convention campaign stored in mart rows
			CurrentUserModel user = Instancio.create(CurrentUserModel.class);
			givenCampaign();
			when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
			String constructedName = "TrueM_Andy's Frozen Custard_19_"
					+ "2026-Andy's Frozen Custard-Bentonville AR_CTV/OTT_Prospecting_-*-717852-*-*-*-_-*TM274675#1*-";

			// When:
			service.saveAdjustments(user, 42L, List.of(overrideAdjustmentWithConstructedName(constructedName)));

			// Then:
			ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
			verify(bigQueryWriteClient).execute(sql.capture());
			assertThat(sql.getValue()).contains("'Andy\\'s Frozen Custard'");
			assertThat(sql.getValue()).contains("'2026-Andy\\'s Frozen Custard-Bentonville AR'");
			assertThat(sql.getValue()).doesNotContain("'Ourisman Ford 2026'");
		}

	@Test
	void shouldEvictTheSearchCacheAfterWritingAdjustmentsTest() {
		// Given: cached report reads for this campaign, since a write can change what they'd return
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);

		// When:
		service.saveAdjustments(user, 42L, List.of(overrideAdjustment(1234L)));

		// Then:
		verify(searchGateway).evictSearchCache();
	}

	@Test
	void shouldBatchMultipleAdjustmentsIntoOneInsertJobTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenReturn(3L);
		List<AdjustmentRowModel> adjustments =
				List.of(overrideAdjustment(100L), overrideAdjustment(200L), addedAdjustment());

		// When:
		service.saveAdjustments(user, 42L, adjustments);

		// Then: one job, three VALUES tuples
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("100").contains("200").contains("New Line");
	}

	@Test
	void shouldSplitALargeAdjustmentBatchAcrossMultipleInsertJobsTest() {
		// Given: enough rows that the rendered statement would exceed BigQuery's 1 MB statement limit
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		List<AdjustmentRowModel> adjustments = new ArrayList<>();
		for (long i = 0; i < 5000; i++) {
			adjustments.add(overrideAdjustment(i));
		}

		// When:
		long affected = service.saveAdjustments(user, 42L, adjustments);

		// Then: more than one INSERT job was needed, each within the statement-length safety margin, and
		// the reported total sums every job's own affected-row count
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, atLeast(2)).execute(sql.capture());
		assertThat(affected).isEqualTo(sql.getAllValues().size());
		assertThat(sql.getAllValues()).allSatisfy(
				statement -> assertThat(statement.length()).isLessThanOrEqualTo(BqInsert.MAX_STATEMENT_BYTES));
	}

	@Test
	void shouldRejectAnEmptyBatchTest() {
		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 42L, List.of()))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("at least one adjustment is required");
	}

	@Test
	void shouldRejectAnOverrideWithNoEditableMetricTest() {
		// Given: an override (added=false) that changes no metric at all
		AdjustmentRowModel noMetric = adjustmentWithRequiredFields(false, "2026-03-10", null, "LI-1");

		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 42L, List.of(noMetric)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("an override must change at least one metric");
	}

	@Test
	void shouldNotRequireAMetricOnAManuallyAddedRowTest() {
		// Given: a manually-added row - unlike an override, it is valid even before any metric is set
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		AdjustmentRowModel blankAdded = adjustmentWithRequiredFields(true, "2026-03-15", "New Line", "LI-NEW");

		// When/Then: does not throw
		long affected = service.saveAdjustments(user, 42L, List.of(blankAdded));
		assertThat(affected).isEqualTo(1L);
	}

	@Test
	void shouldRejectAnAddedRowMissingLineItemIdTest() {
		// Given: a manually-added row whose line item id was never filled in
		AdjustmentRowModel missingLineItemId = adjustmentWithRequiredFields(true, "2026-03-15", "New Line", null);

		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 42L, List.of(missingLineItemId)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("a manually-added row requires a line item id and a date");
	}

	@Test
	void shouldRejectAnAddedRowMissingDateTest() {
		// Given: a manually-added row whose date was never filled in
		AdjustmentRowModel missingDate = adjustmentWithRequiredFields(true, null, "New Line", "LI-NEW");

		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 42L, List.of(missingDate)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("a manually-added row requires a line item id and a date");
	}

	@Test
	void shouldWriteOnlyChangedCellsWhenDiffingAnUploadedRowAgainstBaselineTest() {
		// Given: baseline row date=2026-03-10, line_item_id=LI-1, spend=92.5, impressions=5000
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "500");
		cells.put("impressions", "5000");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		int applied = service.applyBulkAdjustments(user, 42L, List.of(uploaded));

		// Then: one override written, spend changed but impressions (equal to baseline) did not
		assertThat(applied).isEqualTo(1);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("500").contains("'spend'");
	}

	@Test
	void shouldNotCallTheLastBitsOfAFloatSumAnEditTest() {
		// Given: a sheet whose cost cell was never touched, carrying the figure it was handed - and a
		// baseline that comes back from the view differing in the last bits of the mantissa, which a
		// FLOAT64 sum does whenever BigQuery adds the same records in a different order
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		Map<String, Object> baseline = reportRow();
		baseline.put("spend", 66.77866568499999);
		when(bigQueryClient.query(anyString())).thenReturn(List.of(baseline));
		Map<String, String> cells = workbookCells(baseline);
		cells.put("spend", "66.778665685");

		// When:
		int applied = service.applyBulkAdjustments(user, 42L, List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then: nothing written. Exact equality recorded four such rows as manually adjusted on a real
		// upload, each written back with the value it already held
		assertThat(applied).isZero();
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldStillWriteACentSizedEditToALargeFigureTest() {
		// Given: the same large figure, edited by a cent - the smallest edit anyone makes to money
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		Map<String, Object> baseline = reportRow();
		baseline.put("spend", 66.77866568499999);
		when(bigQueryClient.query(anyString())).thenReturn(List.of(baseline));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(baseline);
		cells.put("spend", "66.788665685");

		// When:
		int applied = service.applyBulkAdjustments(user, 42L, List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then: the tolerance is nowhere near wide enough to swallow it
		assertThat(applied).isEqualTo(1);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("'spend'");
	}

	@Test
	void shouldDiffBulkUploadAgainstWorkbookOriginalMetricsInsteadOfCurrentBaselineTest() {
		// Given: the downloaded workbook said spend=92.5 and dynamic_cost=90. Later the mart view changed
		// spend to 120 before the user uploaded the file, while the user only edited Client Cost.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		Map<String, Object> currentBaseline = reportRow();
		currentBaseline.put("spend", 120.0);
		when(bigQueryClient.query(anyString())).thenReturn(List.of(currentBaseline));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "92.5");
		cells.put(ReportRowKey.originalMetricColumn("spend"), "92.5");
		cells.put("dynamic_cost", "300");
		cells.put(ReportRowKey.originalMetricColumn("dynamic_cost"), "90");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		int applied = service.applyBulkAdjustments(user, 42L, List.of(uploaded));

		// Then: only the edited Client Cost is written; untouched DSP Cost is not converted into a false
		// adjustment just because the current baseline no longer equals the downloaded workbook value.
		assertThat(applied).isEqualTo(1);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("'dynamic_cost'");
		assertThat(sql.getValue()).doesNotContain("'spend'");
	}

	@Test
	void shouldRecordWhichMetricsAnUploadActuallyChangedInAdjustedMetricsTest() {
		// Given: baseline impressions=5000, clicks=12, spend=92.5. The upload raises two of them and
		// restates the third at its existing value.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("impressions", "9000");
		cells.put("clicks", "12");
		cells.put("spend", "100");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		service.applyBulkAdjustments(user, 42L, List.of(uploaded));

		// Then: the written row says which metrics a human moved - the two that differ, in column order,
		// and not the one that was merely restated. This is the marker the source mart's own
		// adjusted_metrics column exists for, and it is the only record of what an adjustment touched
		// once the numbers themselves are indistinguishable from delivered data.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient).execute(sql.capture());
		assertThat(sql.getValue()).contains("'impressions,spend'");
		assertThat(sql.getValue()).doesNotContain("'impressions,clicks,spend'");
	}

	@Test
	void shouldNarrowTheBaselineLookupToTheUploadedRowsOwnDatesAndLineItemIdsTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "92.5");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		service.applyBulkAdjustments(null, 42L, List.of(uploaded));

		// Then: the baseline read is narrowed to the upload's own date/line-item-id values, not an
		// unconditional full-campaign scan
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("`date` IN ('2026-03-10')");
		assertThat(sql.getValue()).contains("`constructed_id` IN ('LI-1')");
	}

	@Test
	void shouldFindRowsFromAlreadyDownloadedTemplatesWhosePlatformLabelsSwappedL1AndL2Test() {
		// Given: Amazon displays canonical L1 as "Insertion order" and L2 as "Line item". The old template
		// parser therefore put L2 in line_item_id even though its hidden row key still identifies the row.
		// The user changed Client Cost and left DSP Cost untouched.
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.remove(ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN);
		cells.remove(ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN);
		cells.put("line_item_id", "IO-1");
		cells.put("insertion_order_id", "LI-1");
		cells.put("dynamic_cost", "120");

		// When: the already-downloaded template is uploaded after this fix.
		int applied = service.applyBulkAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then: every displayed constructed-level id bounds the compatibility read, and the exact hidden
		// row key performs the match. The correct L1 row is adjusted, and only Client Cost is written.
		assertThat(applied).isEqualTo(1);
		ArgumentCaptor<String> readSql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(readSql.capture());
		assertThat(readSql.getValue()).contains("`constructed_id` IN ('IO-1', 'LI-1', 'CAMP-1')");
		ArgumentCaptor<String> writeSql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient).execute(writeSql.capture());
		assertThat(writeSql.getValue()).contains("'dynamic_cost'").doesNotContain("'spend'");
	}

	@Test
	void shouldReturnZeroAndSkipTheWriteWhenNothingChangedTest() {
		// Given: uploaded cells equal the baseline exactly
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "92.5");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		int applied = service.applyBulkAdjustments(null, 42L, List.of(uploaded));

		// Then:
		assertThat(applied).isEqualTo(0);
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectAnUploadedRowMatchingNoBaselineRowTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("date", "2026-03-11");
		cells.put("line_item_id", "LI-999");
		cells.put(ReportRowKey.WORKBOOK_COLUMN, "missing");
		cells.put("spend", "500");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then:
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("no report row matches");
	}

	@Test
	void shouldAdjustOneOfSeveralCreativesUnderTheSameLineItemTest() {
		// Given: two report rows of the same line item on the same day - different level-3 creatives, which
		// is the ordinary shape of a report and used to make every such upload fail
		givenCampaign();
		Map<String, Object> otherCreative = reportRow();
		otherCreative.put("constructed_id_lvl3", "CAMP-2");
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow(), otherCreative));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "500");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		int written = service.applyBulkAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploaded));

		// Then: the level-3 id tells the two apart, so the row is adjusted rather than refused. A key of
		// date and line item alone matched both and the upload could only give up.
		assertThat(written).isEqualTo(1);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient).execute(sql.capture());
		assertThat(sql.getValue()).contains("CAMP-1");
	}

	@Test
	void shouldRejectSeveralBaselineRowsWithTheSameWorkbookIdentityTest() {
		// Given: exact same workbook identity twice. There is no safe row to pick here: a write can only name
		// the identity, so choosing the first baseline row would just hide an ambiguous source state.
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow(), reportRow()));
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "500");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then:
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("matches more than one report row");
	}

	@Test
	void shouldRejectANonNumericMetricCellTest() {
		// Given:
		givenCampaign();
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "abc");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then:
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("'spend'")
				.hasMessageContaining("abc");
	}

	@Test
	void shouldRejectAFractionalUploadedIntegerMetricCellTest() {
		// Given:
		givenCampaign();
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("impressions", "12.5");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then: the UI only accepts whole numbers for count metrics, so upload must not round them
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("'impressions'")
				.hasMessageContaining("whole number");
		verifyNoInteractions(bigQueryClient);
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectANegativeUploadedMetricCellTest() {
		// Given:
		givenCampaign();
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "-1");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then:
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("'spend'")
				.hasMessageContaining("negative");
		verifyNoInteractions(bigQueryClient);
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectAnUploadedInvalidDateBeforeMatchingBaselineTest() {
		// Given:
		givenCampaign();
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("date", "03/10/2026");
		cells.put("spend", "500");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then:
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("'date'")
				.hasMessageContaining("yyyy-MM-dd");
		verifyNoInteractions(bigQueryClient);
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectANegativeInlineMetricValueTest() {
		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 42L, List.of(overrideAdjustment(-1L))))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("impressions")
				.hasMessageContaining("negative");
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldNameTheKeyColumnsASheetDidNotCarryTest() {
		// Given: a sheet downloaded from a report grouped coarser than the raw grain, so the columns it did
		// not group by came back empty
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		Map<String, String> cells = new HashMap<>();
		cells.put("date", "2026-03-10");
		cells.put("spend", "500");
		putOriginalMetric(cells, "impressions", null);
		putOriginalMetric(cells, "clicks", null);
		putOriginalMetric(cells, "spend", 92.5);
		putOriginalMetric(cells, "starts", null);
		putOriginalMetric(cells, "first_quartiles", null);
		putOriginalMetric(cells, "midpoints", null);
		putOriginalMetric(cells, "third_quartiles", null);
		putOriginalMetric(cells, "completes", null);
		putOriginalMetric(cells, "dynamic_cost", null);
		putOriginalMetric(cells, "link_clicks", null);
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When/Then: naming the empty columns is the whole remedy - "no match" would send the user hunting
		// through a sheet whose rows are all fine
		assertThatThrownBy(() -> service.applyBulkAdjustments(null, 42L, List.of(uploaded)))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("row 2")
				.hasMessageContaining("platform")
				.hasMessageContaining("line_item_id")
				.hasMessageContaining("campaign_constructed_id");
	}

	@Test
	void shouldStampCampaignIdentityAndUserOnBulkOverridesTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(reportRow()));
		when(bigQueryWriteClient.execute(anyString())).thenReturn(1L);
		Map<String, String> cells = workbookCells(reportRow());
		cells.put("spend", "500");
		WorkbookAdjustmentRow uploaded = new WorkbookAdjustmentRow(2, cells);

		// When:
		service.applyBulkAdjustments(user, 42L, List.of(uploaded));

		// Then: reuses writeAdjustments - same campaign-identity/user stamping guarantee as saveAdjustments
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(1)).execute(sql.capture());
		assertThat(sql.getValue()).contains("Ourisman Ford 2026").contains("Ourisman Ford").contains(user.email());
	}

	@Test
	void shouldThrowWhenCampaignIsNotVisibleForAdjustmentsTest() {
		// Given:
		when(campaignService.getVisibleCampaignIdentity(any(), anyLong()))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_025, 99L));

		// When/Then:
		assertThatThrownBy(() -> service.saveAdjustments(null, 99L, List.of(overrideAdjustment(1L))))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("99");
	}

	@Test
	void shouldWrapWriteFailuresInBusinessExceptionTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		when(bigQueryWriteClient.execute(anyString())).thenThrow(new BigQueryExternalException("boom"));

		// When/Then: the wrapper's own message has no cause to defer to, so its own text surfaces
		assertThatThrownBy(() -> service.saveAdjustments(user, 42L, List.of(overrideAdjustment(1L))))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("BigQuery adjustment write failed")
				.hasMessageContaining("boom");
	}

	@Test
	void shouldSurfaceTheUnderlyingCauseMessageWhenWriteFailsTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		givenCampaign();
		RuntimeException cause = new RuntimeException("Access Denied: Permission bigquery.tables.updateData denied");
		when(bigQueryWriteClient.execute(anyString()))
				.thenThrow(new BigQueryExternalException("BigQuery write statement failed", cause));

		// When/Then: the SDK cause's own message reaches the caller, not just the generic wrapper text
		assertThatThrownBy(() -> service.saveAdjustments(user, 42L, List.of(overrideAdjustment(1L))))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Access Denied: Permission bigquery.tables.updateData denied");
	}

	@Test
	void shouldResolveCampaignUsingTheGivenUserTest() {
		// Given:
		givenCampaign();

		// When:
		CampaignModel resolved = service.resolveCampaign(null, 42L);

		// Then:
		assertThat(resolved.id()).isEqualTo(42L);
	}
}
