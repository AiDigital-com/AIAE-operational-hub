package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryClientService}, which builds count and paged data queries through
 * {@link BqRequest} and runs them via a real {@link BigQuerySearchGateway} over a mocked client.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryClientServiceTest {

	private static final String COUNT_QUERY = "COUNT(DISTINCT `advertiser_id`)";
	private static final String DATA_QUERY = "GROUP BY `advertiser_id`";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private AgencyVisibilityService agencyVisibilityService;

	@Mock
	private CampaignMartClientResolver clientResolver;

	private BigQueryClientService service;

	@BeforeEach
	void setUp() {
		service = new BigQueryClientService(
				new BigQuerySearchGateway(
						bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)),
				agencyVisibilityService,
				clientResolver);
		lenient().when(agencyVisibilityService.resolveForCurrentUser(any()))
				.thenReturn(AgencyVisibility.unrestricted());
		lenient().when(clientResolver.cleanClientName(nullable(String.class)))
				.thenAnswer(invocation -> cleanClientName(invocation.getArgument(0)));
		lenient().when(clientResolver.adjustmentsMartClientNameSetsForAgencyClients(anyList()))
				.thenReturn(Map.of());
		lenient().when(clientResolver.agencyClientRowsForMartClientSearch(anyList(), anyString()))
				.thenReturn(new BqRequest(
						"SELECT `agency_id`, `advertiser_id`, `advertiser` FROM mart_client_matches"));
	}

	@Test
	void shouldReturnPageContentAndTotalFromTheSingleDataQueryTest() {
		// Given: the data query's select list carries its own window-function total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Corp", "agency_id", 10L, "total", 9L),
				Map.of("id", 2L, "name", "Globex", "agency_id", 10L, "total", 9L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 1, 2);

		// When:
		Page<ClientModel> page = service.searchClients(null, criteria);

		// Then:
		assertThat(page.getContent()).extracting(ClientModel::name).containsExactly("Acme Corp", "Globex");
		assertThat(page.getTotalElements()).isEqualTo(9L);
		assertThat(page.getTotalPages()).isEqualTo(5);
		verify(bigQueryClient, times(1)).query(any());
	}

	@Test
	void shouldPushAgencyIdFilterIntoTheSingleDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Corp", "agency_id", 10L, "total", 1L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(ClientField.AGENCY_ID, "10", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		service.searchClients(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("`agency_id` = 10");
	}

	@Test
	void shouldSplitPlaceholderClientsByMartClientNameTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 0L, "name", "", "agency_id", 42L, "total", 1L)
		));
		AgencyClientKey key = new AgencyClientKey(42L, 0L);
		when(clientResolver.adjustmentsMartClientNameSetsForAgencyClients(anyList()))
				.thenReturn(Map.of(key, List.of("Sunland Park", "Comfort Care")));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(ClientField.AGENCY_ID, "42", FilterOperation.EQUALS, false)),
				null, 1, 20);

		// When:
		Page<ClientModel> page = service.searchClients(null, criteria);

		// Then:
		assertThat(page.getContent())
				.extracting(ClientModel::id, ClientModel::name)
				.containsExactly(tuple(0L, "Sunland Park"), tuple(0L, "Comfort Care"));
	}

	@Test
	void shouldPushNameFilterAsSubstringMatchTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Corp", "agency_id", 10L, "total", 1L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(ClientField.NAME, "acme", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchClients(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("CONTAINS_SUBSTR(`advertiser`, 'acme')");
	}

	@Test
	void shouldPushNameFilterThroughMartClientCompositeKeyTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 0L, "name", "", "agency_id", 11517L, "total", 1L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(ClientField.NAME, "Andy's", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchClients(null, criteria);

		// Then:
		assertThat(dataQuery())
				.contains("CONTAINS_SUBSTR(`advertiser`, 'Andy\\'s')")
				.contains("STRUCT(`agency_id`, `advertiser_id`) IN")
				.contains("mart_client_matches");
	}

	@Test
	void shouldApplyIdFilterAndSkipNonFilterableFieldsTest() {
		// Given: an id filter plus an email filter (not filterable in the IO Lines source)
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 5L, "name", "Acme Corp", "agency_id", 10L, "total", 1L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(
				List.of(
						new FilterCriterion<>(ClientField.ID, "5", FilterOperation.EQUALS, false),
						new FilterCriterion<>(ClientField.EMAIL, "x@y.z", FilterOperation.CONTAINS, false)),
				null, 1, 20);

		// When:
		service.searchClients(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("`advertiser_id` = 5").doesNotContain("email");
	}

	@Test
	void shouldPageWithLimitAndOffsetInTheDataQueryTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				Map.of("id", 1L, "name", "Acme Corp", "agency_id", 10L, "total", 100L)
		));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 2, 16);

		// When:
		service.searchClients(null, criteria);

		// Then:
		assertThat(dataQuery()).contains("LIMIT 16 OFFSET 16");
	}

	@Test
	void shouldReturnEmptyFirstPageWithZeroTotalWithoutACountFallbackTest() {
		// Given: the data query itself comes back empty on page 1 - unambiguously zero total
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Page<ClientModel> page = service.searchClients(null, criteria);

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
		// the literal "COUNT(DISTINCT `advertiser_id`)" text, so a contains() matcher here would
		// ambiguously match the data-query call too; buildCount()'s SQL uniquely starts with this text.
		when(bigQueryClient.query(startsWith("SELECT " + COUNT_QUERY))).thenReturn(List.of(Map.of("total", 4L)));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 2, 20);

		// When:
		Page<ClientModel> page = service.searchClients(null, criteria);

		// Then:
		assertThat(page.getContent()).isEmpty();
		assertThat(page.getTotalElements()).isEqualTo(4L);
	}

	@Test
	void shouldMapSortFieldsToOrderByExpressionsTest() {
		// Execution + Verification
		assertThat(service.sortExpression(null)).isEqualTo("LOWER(ANY_VALUE(`advertiser`))");
		assertThat(service.sortExpression(new SortCriterion<>(ClientField.NAME, SortDirection.ASC)))
				.isEqualTo("LOWER(ANY_VALUE(`advertiser`))");
		assertThat(service.sortExpression(new SortCriterion<>(ClientField.ID, SortDirection.ASC)))
				.isEqualTo("`advertiser_id`");
		assertThat(service.sortExpression(new SortCriterion<>(ClientField.AGENCY_ID, SortDirection.ASC)))
				.isEqualTo("ANY_VALUE(`agency_id`)");
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryClient.query(contains(DATA_QUERY)))
				.thenThrow(new BigQueryExternalException("boom"));
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When/Then:
		assertThatThrownBy(() -> service.searchClients(null, criteria))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("BigQuery data query failed")
				.hasFieldOrPropertyWithValue("code", "OPH_018");
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
	 * Mirrors the resolver's client-name normalization for the client-service mock.
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
