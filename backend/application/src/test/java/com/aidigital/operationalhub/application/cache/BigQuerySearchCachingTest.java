package com.aidigital.operationalhub.application.cache;

import com.aidigital.operationalhub.application.config.CacheConfig;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.service.agency.bigquery.config.BigQuerySearchCacheProperties;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spring integration test proving the {@link CachedBigQuerySearchExecutor#CACHE_NAME} caching: a result
 * is served from cache on a repeat call with the identical SQL text, keyed by that text, recomputed
 * after eviction, shared by concurrent callers asking the same question, cached even when empty, and
 * skipped entirely when disabled via {@link BigQuerySearchCacheProperties}.
 */
@SpringJUnitConfig(BigQuerySearchCachingTest.TestConfig.class)
class BigQuerySearchCachingTest {

	private static final String SQL_ONE = "SELECT `a` FROM `t`";
	private static final String SQL_TWO = "SELECT `b` FROM `t`";

	@Configuration
	@Import(CacheConfig.class)
	static class TestConfig {

		@Bean
		BigQueryClient bigQueryClient() {
			return Mockito.mock(BigQueryClient.class);
		}

		@Bean
		BigQuerySearchCacheProperties bigQuerySearchCacheProperties() {
			return new BigQuerySearchCacheProperties();
		}

		@Bean
		CachedBigQuerySearchExecutor cachedBigQuerySearchExecutor(BigQueryClient bigQueryClient) {
			return new CachedBigQuerySearchExecutor(bigQueryClient);
		}
	}

	@Autowired
	private CachedBigQuerySearchExecutor executor;

	@Autowired
	private BigQueryClient bigQueryClient;

	@Autowired
	private CacheManager cacheManager;

	@Autowired
	private BigQuerySearchCacheProperties bigQuerySearchCacheProperties;

	@BeforeEach
	void reset() {
		Mockito.reset(bigQueryClient);
		Objects.requireNonNull(cacheManager.getCache(CachedBigQuerySearchExecutor.CACHE_NAME)).clear();
		bigQuerySearchCacheProperties.setSearchEnabled(true);
	}

	@Test
	void shouldServeFromCacheOnRepeatCallWithTheSameSqlTest() {
		// Given:
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of(Map.of("a", 1L)));

		// When: the same SQL is executed twice
		executor.query(SQL_ONE);
		executor.query(SQL_ONE);

		// Verification: BigQuery is only actually called once
		verify(bigQueryClient, times(1)).query(SQL_ONE);
	}

	@Test
	void shouldKeyCacheByExactSqlTextTest() {
		// Given:
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of());
		when(bigQueryClient.query(SQL_TWO)).thenReturn(List.of());

		// When: two different SQL statements are executed
		executor.query(SQL_ONE);
		executor.query(SQL_TWO);

		// Verification: each distinct SQL text is resolved on its own (separate cache keys)
		verify(bigQueryClient).query(SQL_ONE);
		verify(bigQueryClient).query(SQL_TWO);
	}

	@Test
	void shouldRecomputeAfterEvictionTest() {
		// Given:
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of());

		// When: executed, evicted, then executed again
		executor.query(SQL_ONE);
		Objects.requireNonNull(cacheManager.getCache(CachedBigQuerySearchExecutor.CACHE_NAME)).evict(SQL_ONE);
		executor.query(SQL_ONE);

		// Verification: eviction forces a fresh BigQuery call
		verify(bigQueryClient, times(2)).query(SQL_ONE);
	}

	@Test
	void shouldEvictEveryWriteSensitiveEntryTest() {
		// Given: two distinct SQL texts are both cached as write-sensitive reads
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of(Map.of("a", 1L)));
		when(bigQueryClient.query(SQL_TWO)).thenReturn(List.of(Map.of("b", 2L)));
		executor.queryWriteSensitive(SQL_ONE);
		executor.queryWriteSensitive(SQL_TWO);

		// When: the whole region is evicted, then both are re-requested
		executor.evictAll();
		executor.queryWriteSensitive(SQL_ONE);
		executor.queryWriteSensitive(SQL_TWO);

		// Verification: eviction cleared both entries, forcing a fresh BigQuery call for each
		verify(bigQueryClient, times(2)).query(SQL_ONE);
		verify(bigQueryClient, times(2)).query(SQL_TWO);
	}

	@Test
	void shouldLeaveSnapshotReadsAloneWhenAWriteEvictsTest() {
		// Given: a snapshot read - an agency, client or campaign list - is cached
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of(Map.of("a", 1L)));
		executor.query(SQL_ONE);

		// When: a write clears the write-sensitive region, as a saved adjustment does
		executor.evictAll();
		executor.query(SQL_ONE);

		// Verification: still one BigQuery call. Nothing this application writes can make a nightly
		// snapshot stale, and clearing these with the rest is what kept the lists permanently cold on a
		// tab whose whole purpose is editing data.
		verify(bigQueryClient, times(1)).query(SQL_ONE);
	}

	@Test
	void shouldCacheAnEmptyResultAsWellTest() {
		// Given: a query that matches nothing - which on these views costs a full scan, not nothing
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of());

		// When: the same SQL is executed twice, with no eviction in between
		executor.query(SQL_ONE);
		executor.query(SQL_ONE);

		// Verification: one BigQuery call. An empty Live tab used to re-scan on every visit.
		verify(bigQueryClient, times(1)).query(SQL_ONE);
	}

	@Test
	void shouldRunOneQueryWhenTwoCallersAskTheSameQuestionAtOnceTest() throws Exception {
		// Given: a slow query, and a second caller arriving while the first is still waiting for it
		when(bigQueryClient.query(SQL_ONE)).thenAnswer(invocation -> {
			Thread.sleep(300);
			return List.of(Map.of("a", 1L));
		});

		// When: both callers ask for it
		Thread first = new Thread(() -> executor.query(SQL_ONE));
		first.start();
		Thread.sleep(100);
		Thread second = new Thread(() -> executor.query(SQL_ONE));
		second.start();
		first.join();
		second.join();

		// Verification: the second caller waited for the first one's answer instead of paying for its own
		verify(bigQueryClient, times(1)).query(SQL_ONE);
	}

	@Test
	void shouldSkipTheCacheEntirelyWhenDisabledByPropertyTest() {
		// Given: the cache is switched off via oph.cache.search-enabled
		bigQuerySearchCacheProperties.setSearchEnabled(false);
		when(bigQueryClient.query(SQL_ONE)).thenReturn(List.of(Map.of("a", 1L)));

		// When: the same SQL is executed twice
		executor.query(SQL_ONE);
		executor.query(SQL_ONE);

		// Verification: every call reaches BigQuery directly - nothing was ever cached
		verify(bigQueryClient, times(2)).query(SQL_ONE);
	}
}
