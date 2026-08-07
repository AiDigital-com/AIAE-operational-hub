package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.AgencyClientRefModel;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
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
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryAgencyService}, which builds count and paged data queries through
 * {@link BqRequest} and runs them via a real {@link BigQuerySearchGateway} over a mocked client.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryAgencyServiceTest {

	private static final String COUNT_QUERY = "COUNT(DISTINCT `agency_id`)";
	private static final String DATA_QUERY = "GROUP BY `agency_id`";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private AgencyVisibilityService agencyVisibilityService;

	@Mock
	private CampaignMartClientResolver clientResolver;

	private BigQueryAgencyService service;

	@BeforeEach
	void setUp() {
		service = new BigQueryAgencyService(
				new BigQuerySearchGateway(
						bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)),
				agencyVisibilityService,
				clientResolver);
		lenient().when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.unrestricted());
		lenient().when(clientResolver.cleanClientName(nullable(String.class)))
				.thenAnswer(invocation -> cleanClientName(invocation.getArgument(0)));
		lenient().when(clientResolver.adjustmentsMartClientNamesForAgencyClients(anyList()))
				.thenReturn(Map.of());
		lenient().when(clientResolver.adjustmentsMartClientNameSetsForAgencyClients(anyList()))
				.thenReturn(Map.of());
		lenient().when(clientResolver.agencyIdsForMartClientSearch(anyString(), anyList()))
				.thenReturn(new BqRequest("SELECT `agency_id` FROM mart_client_agency_matches"));
		lenient().when(clientResolver.agencyClientRowsForMartClientSearch(anyList(), anyString()))
				.thenReturn(new BqRequest(
						"SELECT `agency_id`, `advertiser_id`, `advertiser` FROM mart_client_matches"));
	}

	@Test
	void shouldReturnPageContentAndTotalFromTheSingleDataQueryTest() {
		// Given: the data query's select list carries its own window-function total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Alpha", "clients_count", 5L, "total", 42L),
				Map.of("id", 2L, "name", "Beta", "clients_count", 3L, "total", 42L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 2);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria);

		// Then:
		assertThat(page.getContent()).extracting(AgencyModel::name).containsExactly("Alpha", "Beta");
		assertThat(page.getContent().get(0).clientsCount()).isEqualTo(5L);
		assertThat(page.getTotalElements()).isEqualTo(42L);
		assertThat(page.getTotalPages()).isEqualTo(21);
		verify(bigQueryClient, times(1)).query(any());
	}

	@Test
	void shouldPushNameFilterIntoTheSingleDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Media", "clients_count", 2L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(AgencyField.NAME, "acme", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchAgencies(null, criteria);

		// Then: the name filter is pushed into the one data query
		assertThat(dataQuery()).contains("CONTAINS_SUBSTR(`agency`, 'acme')");
	}

	@Test
	void shouldSearchAgenciesThroughMartClientNamesTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 11517L, "name", "True Media", "clients_count", 22L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchAgencies(null, criteria, "Andy's Frozen Custard", false);

		// Then:
		assertThat(dataQuery())
				.contains("CONTAINS_SUBSTR(`agency`, 'Andy\\'s Frozen Custard')")
				.contains("UNION DISTINCT")
				.contains("mart_client_agency_matches");
	}

	@Test
	void shouldApplyIdFilterAndSkipNonFilterableFieldsTest() {
		// Given: an id filter plus a status filter (not filterable in the IO Lines source)
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 7L, "name", "Alpha", "clients_count", 1L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(AgencyField.ID, "7", FilterOperation.EQUALS, false),
						new FilterCriterion<>(AgencyField.STATUS, "ACTIVE", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchAgencies(null, criteria);

		// Then: the id predicate is present and the status filter is silently ignored
		assertThat(dataQuery()).contains("`agency_id` = 7").doesNotContain("status");
	}

	@Test
	void shouldOrderByClientsCountDescendingInTheDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Big", "clients_count", 50L, "total", 3L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(
				List.of(), new SortCriterion<>(AgencyField.CLIENTS_COUNT, SortDirection.DESC), 1, 5);

		// When:
		service.searchAgencies(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("ORDER BY COUNT(DISTINCT `advertiser_id`) DESC NULLS LAST");
	}

	@Test
	void shouldPageWithLimitAndOffsetInTheDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Alpha", "clients_count", 1L, "total", 100L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 3, 20);

		// When:
		service.searchAgencies(null, criteria);

		// Then: the third page of 20 is requested from the database
		assertThat(dataQuery()).contains("LIMIT 20 OFFSET 40");
	}

	@Test
	void shouldReturnEmptyFirstPageWithZeroTotalWithoutACountFallbackTest() {
		// Given: the data query itself comes back empty on page 1 - unambiguously zero total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria);

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
		// the literal "COUNT(DISTINCT `agency_id`)" text, so a contains() matcher here would ambiguously
		// match the data-query call too; buildCount()'s SQL uniquely starts with "SELECT " + this text.
		when(bigQueryClient.query(startsWith("SELECT " + COUNT_QUERY))).thenReturn(List.of(Map.of("total", 5L)));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 2, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria);

		// Then:
		assertThat(page.getContent()).isEmpty();
		assertThat(page.getTotalElements()).isEqualTo(5L);
	}

	@Test
	void shouldEmbedClientsWhenRequestedTest() {
		// Given: the embedded-clients query is now pre-sorted and capped by BigQuery itself, so
		// the mocked rows arrive already in the order BigQuery's ROW_NUMBER()/ORDER BY would produce
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Alpha", "clients_count", 2L, "total", 1L)
		));
		when(bigQueryClient.query(contains("IN (1)"))).thenReturn(List.of(
				Map.of("id", 12L, "name", "Acme Co", "agency_id", 1L),
				Map.of("id", 11L, "name", "Zebra Co", "agency_id", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria, true);

		// Then: each agency carries its clients, in the order BigQuery returned them
		assertThat(page.getContent().get(0).clients())
				.extracting(AgencyClientRefModel::name)
				.containsExactly("Acme Co", "Zebra Co");
	}

	@Test
	void shouldResolveEmbeddedClientNameFromTheAdjustmentsMartWhenAdvertiserNameIsMissingTest() {
		// Given: the agency/client pair has a placeholder advertiser name in IO-lines
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 31291L, "name", "TCL", "clients_count", 1L, "total", 1L)
		));
		Map<String, Object> missingClient = new HashMap<>();
		missingClient.put("id", 0L);
		missingClient.put("name", "");
		missingClient.put("agency_id", 31291L);
		when(bigQueryClient.query(contains("IN (31291)"))).thenReturn(List.of(missingClient));
		AgencyClientKey key = new AgencyClientKey(31291L, 0L);
		when(clientResolver.adjustmentsMartClientNameSetsForAgencyClients(anyList()))
				.thenReturn(Map.of(key, List.of("Sunland Park")));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria, true);

		// Then: the embedded sidebar client row carries the same mart client name as the campaigns page
		assertThat(page.getContent().get(0).clients())
				.extracting(AgencyClientRefModel::name)
				.containsExactly("Sunland Park");
	}

	@Test
	void shouldLoadMatchingEmbeddedClientsThroughMartClientNamesTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 11517L, "name", "True Media", "clients_count", 22L, "total", 1L)
		));
		when(bigQueryClient.query(contains("ROW_NUMBER() OVER"))).thenReturn(List.of(
				Map.of("id", 21376L, "name", "Andy's Frozen Custard", "agency_id", 11517L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria, "Andy's", true);

		// Then:
		assertThat(page.getContent().get(0).clients())
				.extracting(AgencyClientRefModel::name)
				.containsExactly("Andy's Frozen Custard");
	}

	@Test
	void shouldSplitEmbeddedPlaceholderClientsByMartClientNameTest() {
		// Given: one IO-lines client id contains several effective mart clients
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 31291L, "name", "TCL", "clients_count", 1L, "total", 1L)
		));
		Map<String, Object> missingClient = new HashMap<>();
		missingClient.put("id", 0L);
		missingClient.put("name", "");
		missingClient.put("agency_id", 31291L);
		when(bigQueryClient.query(contains("IN (31291)"))).thenReturn(List.of(missingClient));
		AgencyClientKey key = new AgencyClientKey(31291L, 0L);
		when(clientResolver.adjustmentsMartClientNameSetsForAgencyClients(anyList()))
				.thenReturn(Map.of(key, List.of("Sunland Park", "Comfort Care")));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria, true);

		// Then:
		assertThat(page.getContent().get(0).clients())
				.extracting(AgencyClientRefModel::id, AgencyClientRefModel::name)
				.containsExactly(
						tuple(0L, "Sunland Park"),
						tuple(0L, "Comfort Care"));
	}

	@Test
	void shouldRankAndCapEmbeddedClientsInBigQueryNotJavaTest() {
		// Given: the embedded-clients statement itself must carry the per-agency rank and cap
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Alpha", "clients_count", 1L, "total", 1L)
		));
		when(bigQueryClient.query(contains("IN (1)"))).thenReturn(List.of());
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchAgencies(null, criteria, true);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, atLeastOnce()).query(sql.capture());
		String embeddedClientsQuery = sql.getAllValues().stream()
				.filter(query -> query.contains("IN (1)"))
				.findFirst()
				.orElseThrow();
		assertThat(embeddedClientsQuery)
				.contains("ROW_NUMBER() OVER (PARTITION BY `agency_id` ORDER BY LOWER(`advertiser`))")
				.contains("WHERE `rn` <= 16");
	}

	@Test
	void shouldMapSortFieldsToOrderByExpressionsTest() {
		// Execution + Verification
		assertThat(service.sortExpression(null)).isEqualTo("LOWER(ANY_VALUE(`agency`))");
		assertThat(service.sortExpression(new SortCriterion<>(AgencyField.NAME, SortDirection.ASC)))
				.isEqualTo("LOWER(ANY_VALUE(`agency`))");
		assertThat(service.sortExpression(new SortCriterion<>(AgencyField.ID, SortDirection.ASC)))
				.isEqualTo("`agency_id`");
		assertThat(service.sortExpression(new SortCriterion<>(AgencyField.CLIENTS_COUNT, SortDirection.ASC)))
				.isEqualTo("COUNT(DISTINCT `advertiser_id`)");
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY)))
				.thenThrow(new BigQueryExternalException("boom"));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When/Then:
		assertThatThrownBy(() -> service.searchAgencies(null, criteria))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("BigQuery data query failed")
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldRestrictToVisibleAgencyIdsWhenScopedTest() {
		// Given: the user's RBAC scope limits them to agencies 7 and 9
		when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(7L, 9L)));
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY)))
				.thenReturn(List.of(Map.of("id", 7L, "name", "Alpha", "clients_count", 1L, "total", 1L)));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchAgencies(null, criteria);

		// Then: the data query is constrained to the visible agency ids
		assertThat(dataQuery()).contains("`agency_id` IN (7, 9)");
	}

	@Test
	void shouldPushGlobalSearchIntoAnOrPredicateAcrossAgencyAndClientNamesTest() {
		// Given: a global search term
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Media", "clients_count", 1L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchAgencies(null, criteria, "acme", false);

		// Then: the data query matches an agency name OR an agency that owns a matching client
		assertThat(dataQuery())
				.contains("CONTAINS_SUBSTR(`agency`, 'acme')")
				.contains("`agency_id` IN (SELECT `agency_id` FROM (")
				.contains("CONTAINS_SUBSTR(`advertiser`, 'acme')");
	}

	@Test
	void shouldEmbedOnlyMatchingClientsWhenSearchMatchesClientNameOnlyTest() {
		// Given: the agency name "Beta" does not contain "ford", but it owns an advertiser "Ourisman Ford"
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 2L, "name", "Beta", "clients_count", 1L, "total", 1L)
		));
		when(bigQueryClient.query(contains("IN (2)"))).thenReturn(List.of(
				Map.of("id", 20L, "name", "Ourisman Ford", "agency_id", 2L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria, "ford", true);

		// Then: the embedded-clients query filters the advertiser column to the search term and the
		// returned agency carries only that matching client
		assertThat(embeddedClientsQuery()).contains("CONTAINS_SUBSTR(`advertiser`, 'ford')");
		assertThat(page.getContent().get(0).clients())
				.extracting(AgencyClientRefModel::name)
				.containsExactly("Ourisman Ford");
	}

	@Test
	void shouldRestrictTheSearchSubqueryToVisibleAgencyIdsWhenScopedTest() {
		// Given: the user's scope is limited to agencies 7 and 9 and a global search is active
		when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(7L, 9L)));
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 7L, "name", "Alpha", "clients_count", 1L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		service.searchAgencies(null, criteria, "ford", false);

		// Then: both the outer data query and the global-search client subquery are constrained to the
		// visible agency ids, so the search cannot surface inaccessible agencies via their clients
		assertThat(dataQuery())
				.contains("`agency_id` IN (7, 9)")
				.contains("CONTAINS_SUBSTR(`advertiser`, 'ford')");
	}

	@Test
	void shouldIgnoreCaseAndTrimOfTheSearchTermTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Media", "clients_count", 1L, "total", 1L)
		));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When: surrounding whitespace and mixed case are trimmed/lowered
		service.searchAgencies(null, criteria, "  AcMe  ", false);

		// Then: the predicate still uses the trimmed value; BigQuery CONTAINS_SUBSTR is case-insensitive
		assertThat(dataQuery()).contains("CONTAINS_SUBSTR(`agency`, 'AcMe')");
	}

	@Test
	void shouldReturnEmptyPageWithoutQueryingWhenUserSeesNothingTest() {
		// Given: the user's RBAC scope grants access to no agency
		when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of()));
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<AgencyModel> page = service.searchAgencies(null, criteria);

		// Then: an empty page is returned and BigQuery is never queried
		assertThat(page.getContent()).isEmpty();
		assertThat(page.getTotalElements()).isZero();
		verify(bigQueryClient, never()).query(any());
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

	/**
	 * Captures and returns the embedded-clients query SQL passed to the BigQuery client.
	 *
	 * @return the embedded-clients query SQL
	 */
	private String embeddedClientsQuery() {
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, atLeastOnce()).query(sql.capture());
		return sql.getAllValues().stream()
				.filter(query -> query.contains("IN (2)"))
				.findFirst()
				.orElseThrow();
	}

	/**
	 * Mirrors the resolver's client-name normalization for the agency-service mock.
	 *
	 * @param value the raw client name
	 * @return a usable client name or {@code null}
	 */
	private String cleanClientName(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		String trimmed = value.trim();
		if ("null".equalsIgnoreCase(trimmed) || "Client without name".equalsIgnoreCase(trimmed)) {
			return null;
		}
		return trimmed;
	}
}
