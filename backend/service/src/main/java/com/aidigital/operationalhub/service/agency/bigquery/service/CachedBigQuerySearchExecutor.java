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
	 * Region for reads of a nightly BigQuery snapshot; must match the alias registered in
	 * {@code ehcache.xml}.
	 */
	public static final String CACHE_NAME = "bigQuerySearchResults";

	/**
	 * Region for reads that a write can invalidate - anything through the adjustments view, which merges
	 * the append-only write table on read; must match the alias registered in {@code ehcache.xml}.
	 */
	public static final String WRITE_SENSITIVE_CACHE_NAME = "bigQueryWriteSensitiveResults";

	private final BigQueryClient bigQueryClient;

	/**
	 * Runs the given SQL, caching the result by its exact text unless caching is switched off.
	 *
	 * <p>For reads of a nightly snapshot only. Nothing this application writes can make one of these stale,
	 * which is what lets them survive a write - see {@link #evictAll()}.
	 *
	 * <p>{@code sync = true} makes concurrent callers asking the same question wait for one answer instead of
	 * each running the query. The same question means the same rendered SQL, which is the cache key: two users
	 * opening the same campaign, a page re-requested while its first read is still in flight, a preview and an
	 * export of one arrangement. It does nothing for a screen's count and page - those are two different
	 * statements, each of which single-flights only against another caller asking for that same one.
	 *
	 * <p>Empty results are cached too, which they were not before. The old reasoning was that an empty page is
	 * cheap to recompute; on these views it is not - a scan that matches nothing costs what a scan that matches
	 * everything costs, so an empty Live tab or a campaign with no delivery used to re-scan on every visit.
	 * Spring also forbids {@code unless} together with {@code sync}, and single-flight is worth more than the
	 * cache slot an empty list occupies.
	 *
	 * @param sql the rendered BigQuery SQL statement
	 * @return the raw result rows
	 */
	@Cacheable(
			cacheNames = CACHE_NAME,
			key = "#sql",
			condition = "@bigQuerySearchCacheProperties.isSearchEnabled()",
			sync = true)
	public List<Map<String, Object>> query(String sql) {
		return bigQueryClient.query(sql);
	}

	/**
	 * The same, for a read that a write can invalidate - single-flight and empty results included, for the
	 * reasons given on {@link #query(String)}. An empty result here cannot outlive its own truth either: the
	 * write that would make it wrong clears this whole region.
	 *
	 * <p>A separate region rather than a separate key, because eviction has to be wholesale: there is no
	 * per-campaign key to target, and Spring cannot evict by prefix. Keeping these reads apart is what
	 * makes that wholesale eviction affordable - it clears the reads a write actually affects and leaves
	 * the snapshot ones alone.
	 *
	 * @param sql the rendered BigQuery SQL statement
	 * @return the raw result rows
	 */
	@Cacheable(
			cacheNames = WRITE_SENSITIVE_CACHE_NAME,
			key = "#sql",
			condition = "@bigQuerySearchCacheProperties.isSearchEnabled()",
			sync = true)
	public List<Map<String, Object>> queryWriteSensitive(String sql) {
		return bigQueryClient.query(sql);
	}

	/**
	 * Evicts every cached read that a write can invalidate, called after a report-row or conversions write.
	 *
	 * <p>Only that region. It used to clear both, which meant one adjustment saved on one campaign threw
	 * away the agency, client and campaign lists - for every user - and those come from a nightly snapshot
	 * that no write in this application can touch. On a tab whose whole purpose is editing data, that kept
	 * the lists permanently cold.
	 */
	@CacheEvict(cacheNames = WRITE_SENSITIVE_CACHE_NAME, allEntries = true)
	public void evictAll() {
	}
}
