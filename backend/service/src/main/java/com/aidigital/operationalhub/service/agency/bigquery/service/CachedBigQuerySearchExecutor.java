package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Caches agency/client/campaign search-page results by their exact rendered SQL, for
 * {@code bigQuerySearchResults}'s configured TTL (see {@code ehcache.xml}), so repeated identical
 * searches (paging back to an already-seen page, two users with the same filters, etc.) skip a
 * BigQuery round trip. The source table is a nightly BigQuery snapshot, so this staleness window is
 * acceptable.
 *
 * <p>A separate bean (rather than a method on {@link BigQuerySearchGateway}) because Spring's caching
 * proxy only intercepts calls made from outside the bean; a self-invoked call would silently bypass the
 * cache.
 *
 * <p>Deliberately scoped to the paged-search path only: {@link BigQuerySearchGateway}'s uncached
 * {@code fetch}/{@code count} methods remain how {@code AgencyLeadBigQueryService} and
 * {@code RipplingEmployeeBigQueryService} read for the NetSuite sync, which must see the freshest data
 * whenever it (or an admin-triggered re-sync) runs.
 *
 * <p>Caching can be switched off at runtime via {@code oph.cache.search-enabled} (see
 * {@code BigQuerySearchCacheProperties}), e.g. while diagnosing a staleness report.
 */
@Component
@RequiredArgsConstructor
public class CachedBigQuerySearchExecutor {

	/**
	 * Cache region name; must match the alias registered in {@code ehcache.xml}.
	 */
	public static final String CACHE_NAME = "bigQuerySearchResults";

	private final BigQueryClient bigQueryClient;

	/**
	 * Runs the given SQL, caching the result by its exact text unless caching is switched off or the
	 * result came back empty (an empty page is cheap to recompute and not worth occupying a cache slot).
	 *
	 * @param sql the rendered BigQuery SQL statement
	 * @return the raw result rows
	 */
	@Cacheable(
			cacheNames = CACHE_NAME,
			key = "#sql",
			condition = "@bigQuerySearchCacheProperties.isSearchEnabled()",
			unless = "#result == null || #result.isEmpty()")
	public List<Map<String, Object>> query(String sql) {
		return bigQueryClient.query(sql);
	}

	/**
	 * Evicts every cached search result. The report-rows adjustments view merges the append-only write
	 * table on read, so - unlike the other search paths this cache otherwise serves, all backed by a
	 * purely nightly BigQuery snapshot - a cached page/aggregate can go stale the moment an adjustment is
	 * written; called after a report-row write for that reason. The cache has no per-campaign key to
	 * evict selectively, so this clears the whole region rather than risk serving stale rows.
	 */
	@CacheEvict(cacheNames = CACHE_NAME, allEntries = true)
	public void evictAll() {
	}
}
