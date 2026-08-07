package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.ReportQueryExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetCriteria;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetFilter;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetPage;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetRow;
import com.aidigital.operationalhub.service.dashboard.model.DashboardPreview;
import com.aidigital.operationalhub.service.dashboard.model.DashboardSource;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.instancio.Instancio;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Pure Mockito unit tests for {@link BigQueryDashboardDataSourceService}.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryDashboardDataSourceServiceTest {

	private static final long CAMPAIGN_ID = 42L;
	private static final long DASHBOARD_ID = 7L;
	private static final String DATASET = "silken-quasar-376417.gs_templates";

	@Mock
	private CampaignService campaignService;

	@Mock
	private HubDashboardService dashboardService;

	@Mock
	private BigQuerySearchGateway searchGateway;

	@Mock
	private BigQueryWriteGateway writeGateway;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private ObjectMapper objectMapper;

	@Mock
	private CampaignDeliveryScopeResolver scopeResolver;

	private BigQueryDashboardDataSourceService service;
	private ReportQueryExecutor reportQueryExecutor;

	@BeforeEach
	void setUp() {
		reportQueryExecutor = new ReportQueryExecutor(new BigQueryOperationContext());
		service = new BigQueryDashboardDataSourceService(
				campaignService,
				dashboardService,
				searchGateway,
				writeGateway,
				bigQueryProperties,
				objectMapper,
				scopeResolver,
				reportQueryExecutor);
	}

	@AfterEach
	void tearDown() {
		reportQueryExecutor.close();
	}

	@Test
	void shouldCountWhatTheDataSourceWouldContainTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme - Summer")
				.set(field(CampaignModel::clientName), "Acme")
				.create();
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Untitled Basic dashboard")
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getFilters), null)
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(dashboard).when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(DATASET).when(bigQueryProperties).getDashboardDataset();
		doReturn(1234L).when(searchGateway).countOfCachedUntilWrite(anyString());

		// When:
		DashboardPreview preview = service.preview(user, CAMPAIGN_ID, DASHBOARD_ID);

		// Then: the count wraps the very query the write would run, so the two cannot describe different tables
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(searchGateway).countOfCachedUntilWrite(sql.capture());
		assertThat(sql.getValue()).startsWith("SELECT COUNT(*) AS total FROM (");
		assertThat(sql.getValue()).contains("SELECT 'Acme - Summer' AS `constructed_name`");
		assertThat(preview.rowCount()).isEqualTo(1234L);
		assertThat(preview.optionalColumns()).isEqualTo(new DashboardColumnChoice(true, true));
		assertThat(preview.sourceTable())
				.isEqualTo(DATASET + ".acme_summer_report_basic_dash_untitled_basic_dashboard");
	}

	@Test
	void shouldWriteTheTableThenRecordItTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme - Summer 2026")
				.set(field(CampaignModel::clientName), "Acme")
				.create();
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Untitled Basic dashboard")
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getFilters), "[{\"field\":\"Channel\",\"values\":[\"Display\"]}]")
				.set(field(HubDashboard::getDateFrom), LocalDate.of(2026, 8, 1))
				.set(field(HubDashboard::getDateTo), LocalDate.of(2026, 8, 10))
				.create();
		HubDashboard live = Instancio.create(HubDashboard.class);
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(dashboard).when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(DATASET).when(bigQueryProperties).getDashboardDataset();
		doReturn(4321L).when(searchGateway).countOf(anyString());
		doReturn(List.of(new DashboardDatasetFilter("Channel", List.of("Display"))))
				.when(objectMapper)
				.readValue(eq("[{\"field\":\"Channel\",\"values\":[\"Display\"]}]"), any(TypeReference.class));
		doReturn(live).when(dashboardService).attachSource(
				eq(CAMPAIGN_ID),
				eq(DASHBOARD_ID),
				any(DashboardSource.class),
				eq("Acme Summer"));

		// When:
		HubDashboard result = service.createDataSource(user, CAMPAIGN_ID, DASHBOARD_ID, "Acme Summer");

		// Then: the campaign and dashboard names become a legal ClicData source table name.
		String expectedTable = DATASET + ".acme_summer_2026_report_basic_dash_untitled_basic_dashboard";
		ArgumentCaptor<String> table = ArgumentCaptor.forClass(String.class);
		ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
		verify(writeGateway).replaceTable(table.capture(), query.capture());
		assertThat(table.getValue()).isEqualTo(expectedTable);
		assertThat(query.getValue())
				.contains("SELECT 'Acme - Summer 2026' AS `constructed_name`")
				.contains("WHERE CAST(`Channel` AS STRING) IN ('Display')")
				.contains("CAST(`Date` AS DATE) >= DATE '2026-08-01'")
				.contains("CAST(`Date` AS DATE) <= DATE '2026-08-10'");
		// And the same window inside the source reads, where it can prune date partitions rather than
		// discarding rows the marts have already been scanned for.
		assertThat(countOf(query.getValue(), "`date` >= DATE '2026-08-01'")).isEqualTo(3);
		assertThat(countOf(query.getValue(), "`date` <= DATE '2026-08-10'")).isEqualTo(3);
		ArgumentCaptor<DashboardSource> source = ArgumentCaptor.forClass(DashboardSource.class);
		verify(dashboardService).attachSource(
				eq(CAMPAIGN_ID), eq(DASHBOARD_ID), source.capture(), eq("Acme Summer"));
		assertThat(source.getValue().table()).isEqualTo(expectedTable);
		assertThat(source.getValue().rowCount()).isEqualTo(4321L);
		assertThat(source.getValue().writtenAt()).isNotNull();
		assertThat(result).isEqualTo(live);
	}

	@Test
	void shouldReturnAFilteredDashboardDatasetPreviewPageTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme - Summer")
				.set(field(CampaignModel::clientName), "Acme")
				.create();
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getFilters), null)
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create();
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of("Date", "2026-08-01"));
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(dashboard).when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(26L).when(searchGateway).countOfCachedUntilWrite(anyString());
		doReturn(List.of(row)).when(searchGateway).fetchSqlCachedUntilWrite(anyString(), any());

		// When:
		DashboardDatasetPage page = service.previewRows(
				user,
				CAMPAIGN_ID,
				DASHBOARD_ID,
				2,
				25,
				new DashboardDatasetCriteria(
						List.of(new DashboardDatasetFilter("Channel", List.of("Google Search", "O'Brien"))),
						"2026-08-01",
						"2026-08-10"));

		// Then: filtering and paging happen in BigQuery, not on the current browser page
		ArgumentCaptor<String> countSql = ArgumentCaptor.forClass(String.class);
		ArgumentCaptor<String> pageSql = ArgumentCaptor.forClass(String.class);
		verify(searchGateway).countOfCachedUntilWrite(countSql.capture());
		verify(searchGateway).fetchSqlCachedUntilWrite(pageSql.capture(), any());
		assertThat(countSql.getValue())
				.contains("WHERE CAST(`Channel` AS STRING) IN ('Google Search', 'O\\'Brien')")
				.contains("CAST(`Date` AS DATE) >= DATE '2026-08-01'")
				.contains("CAST(`Date` AS DATE) <= DATE '2026-08-10'");
		assertThat(pageSql.getValue())
				.contains("WHERE CAST(`Channel` AS STRING) IN ('Google Search', 'O\\'Brien')")
				.contains("CAST(`Date` AS DATE) >= DATE '2026-08-01'")
				.contains("ORDER BY `Date` ASC, `lvl1` ASC, `lvl3` ASC, `Impressions` DESC")
				.endsWith("LIMIT 25 OFFSET 25");
		assertThat(page.pageNumber()).isEqualTo(2);
		assertThat(page.pageSize()).isEqualTo(25);
		assertThat(page.totalElements()).isEqualTo(26L);
		assertThat(page.totalPages()).isEqualTo(2);
		assertThat(page.content()).containsExactly(row);
	}

	@Test
	void shouldRunDashboardPageAndCountQueriesConcurrentlyTest() {
		// Given: each independent query waits until the other has reached its gateway call. Sequential
		// execution would time out; the bounded query executor allows both to proceed.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getOptionalColumns), "")
				.set(field(HubDashboard::getFilters), null)
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(dashboard).when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		CountDownLatch started = new CountDownLatch(2);
		doAnswer(invocation -> {
			started.countDown();
			if (!started.await(2, TimeUnit.SECONDS)) {
				throw new AssertionError("dashboard page and count queries did not overlap");
			}
			return 12L;
		}).when(searchGateway).countOfCachedUntilWrite(anyString());
		doAnswer(invocation -> {
			started.countDown();
			if (!started.await(2, TimeUnit.SECONDS)) {
				throw new AssertionError("dashboard page and count queries did not overlap");
			}
			return List.of(new DashboardDatasetRow(Map.of("Date", "2026-08-01")));
		}).when(searchGateway).fetchSqlCachedUntilWrite(anyString(), any());

		// When:
		DashboardDatasetPage page = service.previewRows(
				user, CAMPAIGN_ID, DASHBOARD_ID, 1, 25, DashboardDatasetCriteria.none());

		// Then:
		assertThat(page.totalElements()).isEqualTo(12L);
		assertThat(page.content()).hasSize(1);
	}

	@Test
	void shouldReadDistinctDashboardDatasetValuesForAKnownFieldTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme - Summer")
				.set(field(CampaignModel::clientName), "Acme")
				.create();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getOptionalColumns), "")
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create())
				.when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(List.of("Display", "Video")).when(searchGateway).fetchSqlCachedUntilWrite(anyString(), any());

		// When:
		List<String> values = service.distinctValues(user, CAMPAIGN_ID, DASHBOARD_ID, "Channel");

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(searchGateway).fetchSqlCachedUntilWrite(sql.capture(), any());
		assertThat(sql.getValue())
				.contains("SELECT DISTINCT CAST(`Channel` AS STRING) AS value")
				.contains("WHERE `Channel` IS NOT NULL AND CAST(`Channel` AS STRING) != ''")
				.endsWith("LIMIT 500");
		assertThat(values).containsExactly("Display", "Video");
	}

	@Test
	void shouldRejectUnknownPreviewFilterFieldsTest() {
		// When-Then:
		assertThatThrownBy(() -> service.activeCriteria(
				new DashboardDatasetCriteria(List.of(new DashboardDatasetFilter("not_a_column", List.of("x"))), null, null),
				List.of("Date", "Channel")))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_040");
	}

	@Test
	void shouldKeepDatasetRowsInTemplateOrderIncludingNullsTest() {
		// Given:
		BqRow row = new BqRow(Map.of("Date", "2026-08-01"));

		// When:
		DashboardDatasetRow mapped = service.toDatasetRow(row, List.of("Date", "Channel"));

		// Then:
		assertThat(mapped.values()).containsEntry("Date", "2026-08-01").containsEntry("Channel", null);
		assertThat(mapped.values().keySet()).containsExactly("Date", "Channel");
	}

	@Test
	@MockitoSettings(strictness = Strictness.LENIENT)
	void shouldCountTheWrittenTableRatherThanTheQueryAgainTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme")
				.set(field(CampaignModel::clientName), "Acme")
				.create();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), null)
				.set(field(HubDashboard::getFilters), null)
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create())
				.when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(DATASET).when(bigQueryProperties).getDashboardDataset();

		// When:
		service.createDataSource(user, CAMPAIGN_ID, DASHBOARD_ID, null);

		// Then: the figure shown beside a data source has to describe the table, not a second read of the mart
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(searchGateway).countOf(sql.capture());
		assertThat(sql.getValue())
				.isEqualTo("SELECT COUNT(*) AS total FROM `" + DATASET + ".acme_report_basic_dash_campaign`");
	}

	private void givenScope(CampaignModel campaign) {
		doReturn(new CampaignDeliveryScope(
				campaign,
				new BqRequest("SELECT " + campaign.id() + " AS `campaign_id`, 'uli' AS `line_item_id`"),
				new BqRequest("SELECT '" + campaign.name().replace("'", "\\'") + "' AS `constructed_name`")))
				.when(scopeResolver)
				.forCampaign(campaign);
	}

	@Test
	void shouldNotWriteAnythingWhenTheCampaignIsNotVisibleTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_025, CAMPAIGN_ID))
				.when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);

		// When-Then: visibility is checked before anything is written, not after
		assertThatThrownBy(() -> service.createDataSource(user, CAMPAIGN_ID, DASHBOARD_ID, null))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025");
		verifyNoInteractions(writeGateway);
	}

	@Test
	void shouldLeaveTheTableInPlaceWhenTheSourceIsRemovedTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		HubDashboard draft = Instancio.create(HubDashboard.class);
		doReturn(Instancio.create(CampaignModel.class))
				.when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		doReturn(draft).when(dashboardService).detachSource(CAMPAIGN_ID, DASHBOARD_ID);

		// When:
		HubDashboard result = service.removeDataSource(user, CAMPAIGN_ID, DASHBOARD_ID);

		// Then: a ClicData dashboard still reading that table must not go blank because the Hub was tidied
		assertThat(result).isEqualTo(draft);
		verifyNoInteractions(writeGateway);
	}

	@Test
	void shouldBuildSqlForACampaignWithNoHubClientTest() {
		// Given: CampaignModel documents both name and client as nullable
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.of(CampaignModel.class)
				.set(field(CampaignModel::name), "Acme - Summer")
				.set(field(CampaignModel::clientName), null)
				.create();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(user, CAMPAIGN_ID);
		givenScope(campaign);
		doReturn(Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Untitled Basic dashboard")
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getFilters), null)
				.set(field(HubDashboard::getDateFrom), null)
				.set(field(HubDashboard::getDateTo), null)
				.create())
				.when(dashboardService).getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);
		doReturn(DATASET).when(bigQueryProperties).getDashboardDataset();
		doReturn(1L).when(searchGateway).countOf(anyString());

		// When:
		service.createDataSource(user, CAMPAIGN_ID, DASHBOARD_ID, null);

		// Then: the SQL scopes by constructed names derived from line items, so a blank Hub client is safe.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(writeGateway).replaceTable(anyString(), sql.capture());
		assertThat(sql.getValue()).contains("SELECT 'Acme - Summer' AS `constructed_name`");
	}

	@Test
	void shouldCountWithoutSortingTheRowsItOnlyCountsTest() {
		// Given: the written query ends with the spreadsheet's own ORDER BY
		String query = "SELECT 1 AS one\nFROM t\nORDER BY `date` ASC, lvl1 ASC";

		// When:
		String counted = service.countOf(query);

		// Then: a table has no row order for it to establish, and sorting to count forces one worker
		assertThat(counted).isEqualTo("SELECT COUNT(*) AS total FROM (\nSELECT 1 AS one\nFROM t\n)");
	}

	@Test
	void shouldSeparateTheReplacedSortFromTheQueryItFollowsTest() {
		// Given: a query whose last line is the plans join, immediately before the sort that gets stripped
		String query = "SELECT 1 AS one\nFROM joined\nLEFT JOIN plans ON joined.lvl1 = plans.constructed_name"
				+ "\nORDER BY `date` ASC";

		// When:
		String paged = service.pageOf(query, DashboardDatasetCriteria.none(), 1, 25);

		// Then: the paging sort starts its own line - glued to the join it reads as one identifier and BigQuery
		// rejects the whole query
		assertThat(paged).contains("plans.constructed_name\nORDER BY");
		assertThat(paged).endsWith("LIMIT 25 OFFSET 0");
	}

	@Test
	void shouldReadAnEmptySelectionAsNoOptionalColumnsTest() {
		// Given: every checkbox cleared, which is a choice and not an omission
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getOptionalColumns), "")
				.create();

		// When:
		DashboardColumnChoice choice = service.columnChoice(dashboard);

		// Then:
		assertThat(choice).isEqualTo(new DashboardColumnChoice(false, false));
	}

	@Test
	void shouldReadOneKeptColumnWithoutTheOtherTest() {
		// Given:
		HubDashboard dashboard = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getOptionalColumns), "cpa")
				.create();

		// When:
		DashboardColumnChoice choice = service.columnChoice(dashboard);

		// Then:
		assertThat(choice).isEqualTo(new DashboardColumnChoice(false, true));
	}

	@Test
	void shouldCollapseARunOfUnusableCharactersIntoOneUnderscoreTest() {
		// Given: a name whose separator is several characters wide, as most campaign names have
		// When:
		String sanitized = service.sanitize("Acme  -  Summer / Fall 2026!!");

		// Then: the spreadsheet's slug collapses the run, and the table a ClicData dashboard already points at
		// is named from this - one underscore per character would name a different table
		assertThat(sanitized).isEqualTo("acme_summer_fall_2026");
	}

	@Test
	void shouldFallBackToAPlaceholderWhenNothingSurvivesSanitisingTest() {
		// Given/When: a name made entirely of punctuation still has to produce a legal table name
		String sanitized = service.sanitize("--- ---");

		// Then:
		assertThat(sanitized).isEqualTo("campaign");
	}

	/**
	 * Counts occurrences of a fragment in the rendered SQL.
	 *
	 * @param sql      the rendered SQL
	 * @param fragment the fragment to count
	 * @return how many times the fragment occurs
	 */
	private static int countOf(String sql, String fragment) {
		return sql.split(java.util.regex.Pattern.quote(fragment), -1).length - 1;
	}

}
