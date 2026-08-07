package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQuerySearchGateway}, which executes {@link BqRequest}s and centralises
 * table resolution, count extraction, row mapping, and exception translation.
 */
@ExtendWith(MockitoExtension.class)
class BigQuerySearchGatewayTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private CachedBigQuerySearchExecutor cachedSearchExecutor;

	@InjectMocks
	private BigQuerySearchGateway gateway;

	@Test
	void shouldReturnQualifiedTableVerbatimWhenAlreadyDottedTest() {
		// Given: the IO Lines table is configured as a fully-qualified project.dataset.table name
		when(bigQueryProperties.getIoLinesTable()).thenReturn("proj.ds.io_lines");

		// Execution + Verification: a dotted name is used verbatim, ignoring any configured dataset
		assertThat(gateway.table()).isEqualTo("proj.ds.io_lines");
	}

	@Test
	void shouldPrependDatasetToBareTableTest() {
		// Given: a bare table name and a configured dataset
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryProperties.getDataset()).thenReturn("ds");

		// Execution + Verification
		assertThat(gateway.table()).isEqualTo("ds.io_lines");
	}

	@Test
	void shouldLeaveBareTableUnqualifiedWhenNoDatasetTest() {
		// Given: a bare table name and no configured dataset
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(bigQueryProperties.getDataset()).thenReturn("  ");

		// Execution + Verification
		assertThat(gateway.table()).isEqualTo("io_lines");
	}

	@Test
	void shouldReturnTotalFromCountRowTest() {
		// Given:
		when(bigQueryClient.query(any())).thenReturn(List.of(Map.of("total", 17L)));

		// Execution + Verification
		assertThat(gateway.count(new BqRequest("SELECT COUNT(DISTINCT `id`) AS total FROM `t`"))).isEqualTo(17L);
	}

	@Test
	void shouldReturnZeroWhenCountResultIsEmptyOrNullTest() {
		// Given: an empty result, then a null total
		when(bigQueryClient.query(any())).thenReturn(List.of());
		assertThat(gateway.count(new BqRequest("SELECT 1"))).isZero();

		when(bigQueryClient.query(any())).thenReturn(List.of(java.util.Collections.singletonMap("total", null)));
		assertThat(gateway.count(new BqRequest("SELECT 1"))).isZero();
	}

	@Test
	void shouldMapRowsWithTheGivenMapperTest() {
		// Given:
		when(bigQueryClient.query(any())).thenReturn(List.of(
				Map.of("name", "Alpha"),
				Map.of("name", "Beta")
		));

		// Execution
		List<String> names = gateway.fetch(new BqRequest("SELECT name FROM `t`"), row -> row.getString("name"));

		// Verification
		assertThat(names).containsExactly("Alpha", "Beta");
	}

	@Test
	void shouldMapHandWrittenSqlRowsWithTheGivenMapperTest() {
		// Given:
		when(bigQueryClient.query("SELECT name FROM `dashboard_preview`")).thenReturn(List.of(
				Map.of("name", "Alpha"),
				Map.of("name", "Beta")));

		// Execution:
		List<String> names = gateway.fetchSql(
				"SELECT name FROM `dashboard_preview`",
				row -> row.getString("name"));

		// Verification: dashboard preview SQL still travels through the gateway's mapper/failure path
		assertThat(names).containsExactly("Alpha", "Beta");
	}


	@Test
	void shouldMapCachedRowsWithTheGivenMapperTest() {
		// Given:
		when(cachedSearchExecutor.query(any())).thenReturn(List.of(
				Map.of("name", "Alpha"),
				Map.of("name", "Beta")
		));

		// Execution
		List<String> names =
				gateway.fetchCached(new BqRequest("SELECT name FROM `t`"), row -> row.getString("name"));

		// Verification: read through the cached executor, not the plain BigQuery client
		assertThat(names).containsExactly("Alpha", "Beta");
		verify(bigQueryClient, never()).query(any());
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionForFetchCachedTest() {
		// Given:
		when(cachedSearchExecutor.query(any())).thenThrow(new BigQueryExternalException("boom"));

		// Execution + Verification
		assertThatThrownBy(() -> gateway.fetchCached(new BqRequest("SELECT 1"), row -> row))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldDelegateSearchCacheEvictionToTheCachedExecutorTest() {
		// Execution:
		gateway.evictSearchCache();

		// Verification:
		verify(cachedSearchExecutor).evictAll();
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionTest() {
		// Given:
		when(bigQueryClient.query(any())).thenThrow(new BigQueryExternalException("boom"));

		// Execution + Verification
		assertThatThrownBy(() -> gateway.count(new BqRequest("SELECT 1")))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldReturnContentAndTotalFromTheFirstRowOfANonEmptyPageTest() {
		// Given: a data query whose select list carries a window-function total on every row
		when(cachedSearchExecutor.query(any())).thenReturn(List.of(
				Map.of("name", "Alpha", "total", 5L),
				Map.of("name", "Beta", "total", 5L)));
		AtomicInteger countFallbackCalls = new AtomicInteger();

		// When:
		BqPage<String> page = gateway.fetchPage(
				new BqRequest("SELECT `name`, COUNT(DISTINCT `id`) OVER () AS total FROM `t`"),
				() -> {
					countFallbackCalls.incrementAndGet();
					return new BqRequest("SELECT COUNT(DISTINCT `id`) AS total FROM `t`");
				},
				1,
				row -> row.getString("name"));

		// Then: content and total both come from the single data query; the count fallback never runs
		assertThat(page.content()).containsExactly("Alpha", "Beta");
		assertThat(page.total()).isEqualTo(5L);
		assertThat(countFallbackCalls).hasValue(0);
		verify(bigQueryClient, never()).query(any());
	}

	@Test
	void shouldReturnZeroTotalWithoutFallbackWhenFirstPageIsEmptyTest() {
		// Given: page 1 comes back empty - unambiguously a zero total, no fallback needed
		when(cachedSearchExecutor.query(any())).thenReturn(List.of());
		AtomicInteger countFallbackCalls = new AtomicInteger();

		// When:
		BqPage<String> page = gateway.fetchPage(
				new BqRequest("SELECT `name` FROM `t`"),
				() -> {
					countFallbackCalls.incrementAndGet();
					return new BqRequest("SELECT COUNT(DISTINCT `id`) AS total FROM `t`");
				},
				1,
				row -> row.getString("name"));

		// Then:
		assertThat(page.content()).isEmpty();
		assertThat(page.total()).isZero();
		assertThat(countFallbackCalls).hasValue(0);
	}

	@Test
	void shouldFallBackToTheCountQueryWhenAPageBeyondTheEndComesBackEmptyTest() {
		// Given: page 2 comes back empty (the result set shrank since the caller last knew the total), so
		// the true total is read via the supplied count-request fallback
		when(cachedSearchExecutor.query(any())).thenReturn(List.of());
		when(bigQueryClient.query(any())).thenReturn(List.of(Map.of("total", 3L)));

		// When:
		BqPage<String> page = gateway.fetchPage(
				new BqRequest("SELECT `name` FROM `t`"),
				() -> new BqRequest("SELECT COUNT(DISTINCT `id`) AS total FROM `t`"),
				2,
				row -> row.getString("name"));

		// Then:
		assertThat(page.content()).isEmpty();
		assertThat(page.total()).isEqualTo(3L);
	}

	@Test
	void shouldWrapBigQueryFailuresInBusinessExceptionForFetchPageTest() {
		// Given:
		when(cachedSearchExecutor.query(any())).thenThrow(new BigQueryExternalException("boom"));

		// Execution + Verification
		assertThatThrownBy(() -> gateway.fetchPage(
				new BqRequest("SELECT `name` FROM `t`"),
				() -> new BqRequest("SELECT COUNT(DISTINCT `id`) AS total FROM `t`"),
				1,
				row -> row.getString("name")))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldReadThroughTheWriteSensitiveCacheForARequestTest() {
		// Given: a request whose answer an adjustment write can change
		when(cachedSearchExecutor.queryWriteSensitive(any())).thenReturn(List.of(Map.of("name", "Alpha")));

		// Execution
		List<String> names = gateway.fetchCachedUntilWrite(
				new BqRequest("SELECT name FROM `t`"), row -> row.getString("name"));

		// Verification: the write-sensitive region, not the snapshot one a write must leave alone
		assertThat(names).containsExactly("Alpha");
		verify(cachedSearchExecutor).queryWriteSensitive("SELECT name FROM `t`");
		verify(cachedSearchExecutor, never()).query(any());
		verify(bigQueryClient, never()).query(any());
	}

	@Test
	void shouldReadThroughTheWriteSensitiveCacheForRawSqlTest() {
		// Given: SQL assembled as text, as the dashboard dataset preview builds it
		when(cachedSearchExecutor.queryWriteSensitive(any())).thenReturn(List.of(Map.of("name", "Beta")));

		// Execution
		List<String> names = gateway.fetchSqlCachedUntilWrite("SELECT name FROM `t`", row -> row.getString("name"));

		// Verification:
		assertThat(names).containsExactly("Beta");
		verify(cachedSearchExecutor).queryWriteSensitive("SELECT name FROM `t`");
		verify(bigQueryClient, never()).query(any());
	}

	@Test
	void shouldCountThroughTheWriteSensitiveCacheTest() {
		// Given: a count query, which every page of one filter set asks identically
		when(cachedSearchExecutor.queryWriteSensitive(any())).thenReturn(List.of(Map.of("total", 42L)));

		// Execution + Verification:
		assertThat(gateway.countOfCachedUntilWrite("SELECT COUNT(*) AS total FROM `t`")).isEqualTo(42L);
		verify(cachedSearchExecutor).queryWriteSensitive("SELECT COUNT(*) AS total FROM `t`");
	}

	@Test
	void shouldCountZeroWhenTheWriteSensitiveCountReturnsNothingTest() {
		// Given: a count query that came back empty
		when(cachedSearchExecutor.queryWriteSensitive(any())).thenReturn(List.of());

		// Execution + Verification: zero, rather than a null the caller has to guard
		assertThat(gateway.countOfCachedUntilWrite("SELECT COUNT(*) AS total FROM `t`")).isZero();
	}

	@Test
	void shouldTranslateAWriteSensitiveReadFailureTest() {
		// Given: BigQuery refuses the read
		when(cachedSearchExecutor.queryWriteSensitive(any()))
				.thenThrow(new BigQueryExternalException("denied", new RuntimeException("denied")));

		// Execution + Verification: the same business error the uncached paths raise, not a leaked SDK type
		assertThatThrownBy(() -> gateway.countOfCachedUntilWrite("SELECT COUNT(*) AS total FROM `t`"))
				.isInstanceOf(BusinessException.class);
	}
}
