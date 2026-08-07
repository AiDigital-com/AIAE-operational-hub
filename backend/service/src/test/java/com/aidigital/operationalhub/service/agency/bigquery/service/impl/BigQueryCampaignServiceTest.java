package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryCampaignService}, which builds count and paged data queries through
 * {@link BqRequest} and runs them via a real {@link BigQuerySearchGateway} over a mocked client.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryCampaignServiceTest {

	private static final String COUNT_QUERY = "COUNT(DISTINCT `campaign_id`)";
	private static final String DATA_QUERY = "GROUP BY `campaign_id`";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private AgencyVisibilityService agencyVisibilityService;

	@Mock
	private CampaignMartClientResolver clientResolver;

	private BigQueryCampaignService service;

	@BeforeEach
	void setUp() {
		service = new BigQueryCampaignService(
				new BigQuerySearchGateway(
						bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)),
				agencyVisibilityService,
				clientResolver);
		lenient().when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.unrestricted());
		lenient().when(clientResolver.forAdjustmentsMart(anyList())).thenAnswer(invocation -> invocation.getArgument(0));
	}

	private Map<String, Object> campaignRow(long id, String name, String status,
	                                        String startDate, String endDate, double budget, List<String> channels,
											long total) {
		Map<String, Object> row = new HashMap<>();
		row.put("id", id);
		row.put("name", name);
		row.put("client_id", 10L);
		row.put("client_name", "Space Coast");
		row.put("agency_id", 20L);
		row.put("agency_name", "&Barr");
		row.put("status", status);
		row.put("start_date", startDate);
		row.put("end_date", endDate);
		row.put("budget", budget);
		row.put("channels", channels);
		row.put("total", total);
		row.put("line_item_count", 1L);
		return row;
	}

	@Test
	void shouldReturnPageContentAndTotalFromTheSingleDataQueryTest() {
		// Given: the data query's select list carries its own window-function total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Fall Campaign", "Finished", "2025-10-14", "2026-01-31",
						50000.0, List.of("Display", "Video"), 12L),
				campaignRow(2L, "Spring Sale", "Live", "2026-03-01", "2026-05-31", 32000.0, List.of("Video"), 12L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 2);

		// When:
		Page<CampaignModel> page = service.searchCampaigns(null, criteria);

		// Then:
		assertThat(page.getContent()).extracting(CampaignModel::name).containsExactly("Fall Campaign", "Spring Sale");
		assertThat(page.getContent().get(0).channels()).containsExactly("Display", "Video");
		assertThat(page.getContent().get(0).budget()).isEqualTo(50000.0);
		assertThat(page.getTotalElements()).isEqualTo(12L);
		assertThat(page.getTotalPages()).isEqualTo(6);
		verify(bigQueryClient, times(1)).query(any());
	}

	@Test
	void shouldSumTacticBudgetNotOrderBudgetTest() {
		// Given: order_budget is order-level and repeated on every line-item row of that order - summing
		// it directly over a group would over-count by the order's own line-item count, so the campaign
		// budget must come from the line-item-grained tactic_budget instead
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Fall Campaign", "Finished", "2025-10-14", "2026-01-31",
						45000.0, List.of("Display"), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		String dataQuery = dataQuery();
		assertThat(dataQuery).contains("SUM(`tactic_budget`)");
		assertThat(dataQuery).doesNotContain("SUM(`order_budget`)");
	}

	@Test
	void shouldMapTheDistinctLineItemCountIntoTheCampaignModelTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		Map<String, Object> row = campaignRow(1L, "Fall Campaign", "Finished",
				"2025-10-14", "2026-01-31", 45000.0, List.of("Display"), 1L);
		row.put("line_item_count", 4L);
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(row));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<CampaignModel> page = service.searchCampaigns(null, criteria);

		// Then:
		assertThat(page.getContent().get(0).lineItemCount()).isEqualTo(4L);
		assertThat(dataQuery()).contains("COUNT(DISTINCT `line_item_id`)");
	}

	@Test
	void shouldExposeTheReportMartClientNameWhenTheCampaignSourceHasNoClientTest() {
		// Given: the IO-lines advertiser name is absent, but the report mart can resolve the display client.
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		Map<String, Object> row = campaignRow(42452L, "TCL Mobile/Tablets 2026", "Live",
				"2026-04-02", "2026-12-31", 1000.0, List.of("Meta"), 1L);
		row.put("client_name", "");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(row));
		CampaignModel martCampaign = new CampaignModel(
				42452L, "TCL Mobile/Tablets 2026", 10L, "TCL", 20L, "&Barr",
				"Live", "2026-04-02", "2026-12-31", 1000.0, List.of("Meta"), "Automotive", 1L);
		when(clientResolver.forAdjustmentsMart(anyList())).thenReturn(List.of(martCampaign));

		// When:
		Page<CampaignModel> page = service.searchCampaigns(null, new SearchCriteria<>(List.of(), null, 1, 20));

		// Then:
		assertThat(page.getContent()).extracting(CampaignModel::clientName).containsExactly("TCL");
	}

	@Test
	void shouldResolveCampaignClientsInOneBatchPerPageTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Fall Campaign", "Finished", "2025-10-14", "2026-01-31",
						50000.0, List.of("Display"), 12L),
				campaignRow(2L, "Spring Sale", "Live", "2026-03-01", "2026-05-31", 32000.0, List.of("Video"), 12L)
		));

		// When:
		service.searchCampaigns(null, new SearchCriteria<>(List.of(), null, 1, 2));

		// Then:
		verify(clientResolver).forAdjustmentsMart(anyList());
	}

	@Test
	void shouldPushClientIdFilterIntoTheSingleDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Fall Campaign", "Finished", "2025-10-14", "2026-01-31", 50000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(CampaignField.CLIENT_ID, "10", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("`advertiser_id` = 10");
	}

	@Test
	void shouldPushEffectiveClientNameFilterThroughTheAdjustmentsMartTest() {
		// Given: client id 0 is not enough to identify an effective mart client, so the client-name
		// scope is applied through a mart campaign-name subquery
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Sunland Campaign", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		BqRequest subquery = new BqRequest.Builder()
				.from("adjustments_view")
				.distinct()
				.select("CNB_campaign_name")
				.whereNameEquals("CNB_client", "Sunland Park", null)
				.build();
		when(clientResolver.adjustmentsCampaignNamesForClient(eq("Sunland Park"), any(BqRequest.class)))
				.thenReturn(subquery);
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.CLIENT_ID, "0", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "12760", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.CLIENT_NAME, "Sunland Park", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		assertThat(dataQuery()).contains(
				"`campaign` IN (SELECT `CNB_campaign_name` FROM (SELECT DISTINCT "
						+ "`CNB_campaign_name` AS CNB_campaign_name FROM `adjustments_view` "
						+ "WHERE LOWER(TRIM(`CNB_client`)) = LOWER(TRIM('Sunland Park'))))");
		ArgumentCaptor<BqRequest> scope = ArgumentCaptor.forClass(BqRequest.class);
		verify(clientResolver).adjustmentsCampaignNamesForClient(eq("Sunland Park"), scope.capture());
		assertThat(scope.getValue().sql())
				.contains("FROM `io_lines`")
				.contains("`agency_id` IN (12760)")
				.contains("`advertiser_id` IN (0)")
				.contains("`campaign` IS NOT NULL");
	}

	@Test
	void shouldPushUnknownEffectiveClientNameFilterThroughTheAdjustmentsMartTest() {
		// Given: the fallback UI bucket means campaigns under the same agency/client id whose mart rows
		// do not have any real CNB_client
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Unknown Campaign", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		BqRequest subquery = new BqRequest.Builder()
				.from("adjustments_view")
				.distinct()
				.select("CNB_campaign_name")
				.whereNotNull("CNB_campaign_name")
				.whereNotNull("CNB_client")
				.whereNotBlank("CNB_client")
				.whereNormalizedNotInStrings("CNB_client", List.of("-", "null", "client without name"))
				.build();
		when(clientResolver.isUnknownClientName("Client without name")).thenReturn(true);
		when(clientResolver.adjustmentsCampaignNamesWithRealClient(any(BqRequest.class))).thenReturn(subquery);
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.CLIENT_ID, "0", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "12760", FilterOperation.EQUALS, false),
						new FilterCriterion<>(
								CampaignField.CLIENT_NAME, "Client without name", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		assertThat(dataQuery()).contains(
				"`campaign` NOT IN (SELECT `CNB_campaign_name` FROM (SELECT DISTINCT "
						+ "`CNB_campaign_name` AS CNB_campaign_name FROM `adjustments_view` "
						+ "WHERE `CNB_campaign_name` IS NOT NULL AND `CNB_client` IS NOT NULL "
						+ "AND TRIM(`CNB_client`) != '' AND LOWER(TRIM(`CNB_client`)) "
						+ "NOT IN ('-', 'null', 'client without name')))");
		ArgumentCaptor<BqRequest> scope = ArgumentCaptor.forClass(BqRequest.class);
		verify(clientResolver).adjustmentsCampaignNamesWithRealClient(scope.capture());
		assertThat(scope.getValue().sql())
				.contains("FROM `io_lines`")
				.contains("`agency_id` IN (12760)")
				.contains("`advertiser_id` IN (0)")
				.contains("`campaign` IS NOT NULL");
	}

	@Test
	void shouldPushNameStatusAndAgencyFiltersTest() {
		// Given: a substring name filter, a status filter, and an agency-id filter
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Ourisman Ford 2026", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.NAME, "2026", FilterOperation.CONTAINS, false),
						new FilterCriterion<>(CampaignField.STATUS, "Live", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "20", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: a lone agency filter is still an IN, of one id
		String dataQuery = dataQuery();
		assertThat(dataQuery).contains("CONTAINS_SUBSTR(`campaign`, '2026')");
		assertThat(dataQuery).contains("LOWER(`order_status`) = LOWER('Live')");
		assertThat(dataQuery).contains("`agency_id` IN (20)");
	}

	@Test
	void shouldMatchASearchTermAgainstCampaignClientAndAgencyNameTest() {
		// Given: one term from a single search box - the user knows the agency's name, not the campaign's
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "Builders Insurance", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(CampaignField.SEARCH, "Crowley", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: the three names are ORed inside one parenthesised group, so the group still ANDs with
		// the visibility predicate instead of widening past it
		assertThat(dataQuery()).contains(
				"(CONTAINS_SUBSTR(`campaign`, 'Crowley') "
						+ "OR CONTAINS_SUBSTR(`advertiser`, 'Crowley') "
						+ "OR CONTAINS_SUBSTR(`agency`, 'Crowley'))");
	}

	@Test
	void shouldNotRestrictTheSearchOnABlankTermTest() {
		// Given: a search filter that survived to the backend with nothing typed in it
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(CampaignField.SEARCH, "   ", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: no predicate at all - matching the empty string matches every row, and would cost a
		// full scan to say so
		assertThat(dataQuery()).doesNotContain("CONTAINS_SUBSTR");
	}

	@Test
	void shouldOrSeveralAgencyFiltersIntoASingleInPredicateTest() {
		// Given: three agencies picked at once - ANDing equality on the same column would match nothing
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.AGENCY_ID, "20", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "21", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "22", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		String dataQuery = dataQuery();
		assertThat(dataQuery).contains("`agency_id` IN (20, 21, 22)");
		assertThat(dataQuery).doesNotContain("`agency_id` = ");
	}

	@Test
	void shouldIntersectRequestedAgenciesWithTheUsersVisibleOnesTest() {
		// Given: a team-scoped user who sees agencies 20 and 30, asking for 20 and 99 (99 is not theirs)
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(20L, 30L)));
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.AGENCY_ID, "20", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "99", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: both predicates are present and AND together, so asking for 99 cannot widen visibility
		String dataQuery = dataQuery();
		assertThat(dataQuery).contains("`agency_id` IN (20, 30)");
		assertThat(dataQuery).contains("`agency_id` IN (20, 99)");
	}

	@Test
	void shouldIgnoreANonNumericAgencyFilterValueTest() {
		// Given: a junk value that cannot be an id
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(CampaignField.AGENCY_ID, "all", FilterOperation.EQUALS, false),
						new FilterCriterion<>(CampaignField.AGENCY_ID, "21", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: the junk value is dropped rather than poisoning the whole predicate
		assertThat(dataQuery()).contains("`agency_id` IN (21)");
	}

	@Test
	void shouldAddNoAgencyPredicateWhenNoAgencyIsRequestedTest() {
		// Given: only a name filter
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(CampaignField.NAME, "2026", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchCampaigns(null, criteria);

		// Then: no agency predicate at all - the column still appears in the SELECT list as ANY_VALUE
		String dataQuery = dataQuery();
		assertThat(dataQuery).doesNotContain("`agency_id` IN");
		assertThat(dataQuery).doesNotContain("`agency_id` = ");
	}

	@Test
	void shouldOrderByNameAndPageInTheDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(1L, "A", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 50L)
		));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(
				List.of(), new SortCriterion<>(CampaignField.NAME, SortDirection.ASC), 2, 16);

		// When:
		service.searchCampaigns(null, criteria);

		// Then:
		String dataQuery = dataQuery();
		assertThat(dataQuery).contains("ORDER BY LOWER(ANY_VALUE(`campaign`)) ASC NULLS LAST");
		assertThat(dataQuery).contains("LIMIT 16 OFFSET 16");
	}

	@Test
	void shouldReturnEmptyFirstPageWithZeroTotalWithoutACountFallbackTest() {
		// Given: the data query itself comes back empty on page 1 - unambiguously zero total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<CampaignModel> page = service.searchCampaigns(null, criteria);

		// Then: no separate count query is ever issued
		assertThat(page.getContent()).isEmpty();
		assertThat(page.getTotalElements()).isZero();
		verify(bigQueryClient, times(1)).query(any());
	}

	@Test
	void shouldFallBackToCountQueryWhenAPageBeyondTheEndComesBackEmptyTest() {
		// Given: page 2 comes back empty, so the true total is read via the count-query fallback
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		// startsWith, not contains: the data query's own withTotalCount() window function also contains
		// the literal "COUNT(DISTINCT `campaign_id`)" text, so a contains() matcher here would
		// ambiguously match the data-query call too; buildCount()'s SQL uniquely starts with this text.
		when(bigQueryClient.query(startsWith("SELECT " + COUNT_QUERY))).thenReturn(List.of(Map.of("total", 7L)));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 2, 20);

		// When:
		Page<CampaignModel> page = service.searchCampaigns(null, criteria);

		// Then:
		assertThat(page.getContent()).isEmpty();
		assertThat(page.getTotalElements()).isEqualTo(7L);
	}

	@Test
	void shouldMapSortFieldsToOrderByExpressionsTest() {
		// Execution + Verification
		assertThat(service.sortExpression(null)).isEqualTo("LOWER(ANY_VALUE(`campaign`))");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.NAME, SortDirection.ASC)))
				.isEqualTo("LOWER(ANY_VALUE(`campaign`))");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.ID, SortDirection.ASC)))
				.isEqualTo("`campaign_id`");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.CLIENT_ID, SortDirection.ASC)))
				.isEqualTo("ANY_VALUE(`advertiser_id`)");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.AGENCY_ID, SortDirection.ASC)))
				.isEqualTo("ANY_VALUE(`agency_id`)");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.CLIENT_NAME, SortDirection.ASC)))
				.isEqualTo("LOWER(ANY_VALUE(`advertiser`))");
		assertThat(service.sortExpression(new SortCriterion<>(CampaignField.STATUS, SortDirection.ASC)))
				.isEqualTo("LOWER(ANY_VALUE(`order_status`))");
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY)))
				.thenThrow(new BigQueryExternalException("boom"));
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When/Then:
		assertThatThrownBy(() -> service.searchCampaigns(null, criteria))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("BigQuery data query failed")
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldResolveVisibleCampaignByIdTest() {
		// Given: getVisibleCampaign is the shared campaign-resolution helper other services (e.g. report
		// rows, report views) delegate to instead of building their own id-filter search
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				campaignRow(42L, "Ourisman Ford 2026", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of(), 1L)
		));

		// When:
		CampaignModel resolved = service.getVisibleCampaign(null, 42L);

		// Then: the id was passed through as an EQUALS filter on the same visibility-scoped search
		assertThat(resolved.id()).isEqualTo(42L);
		assertThat(dataQuery()).contains("`campaign_id` = 42");
	}

	@Test
	void shouldThrowOph025WhenCampaignNotVisibleTest() {
		// Given: an inaccessible campaign resolves the same as an unknown one - the underlying
		// visibility-scoped search simply excludes it from the result
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());

		// When/Then:
		assertThatThrownBy(() -> service.getVisibleCampaign(null, 99L))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025")
				.hasMessageContaining("99");
	}

	/**
	 * Captures and returns the data (GROUP BY) query SQL passed to the BigQuery client.
	 *
	 * @return the data query SQL
	 */
	private String dataQuery() {
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, atLeastOnce()).query(sql.capture());
		return sql.getAllValues().stream()
				.filter(query -> query.contains(DATA_QUERY))
				.findFirst()
				.orElseThrow();
	}
}
