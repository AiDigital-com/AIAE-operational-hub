package com.aidigital.operationalhub.cachemanagement.cache;

import org.springframework.cache.Cache;

import java.util.List;

/**
 * Looks up cache regions by name across every Spring {@link org.springframework.cache.CacheManager}
 * in the context, so a single name can resolve regions managed by different managers (e.g. the
 * Hibernate second-level cache and an application Spring cache).
 */
public interface CacheService {

	/**
	 * Returns all caches registered under the given name across all cache managers.
	 *
	 * @param name the cache region name
	 * @return the matching caches; empty when no manager knows the name
	 */
	List<Cache> getCachesByName(String name);
}
