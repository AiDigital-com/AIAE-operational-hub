package com.aidigital.operationalhub.cachemanagement.updater;

/**
 * Clears cache regions in response to an invalidation event.
 */
public interface CacheUpdaterService {

	/**
	 * Clears every cache region registered for the given simple class name.
	 *
	 * @param simpleClassName the changed class's simple name
	 */
	void clearCachesForClass(String simpleClassName);

	/**
	 * Clears every cache region with the given name (across all cache managers).
	 *
	 * @param cacheName the cache region name
	 */
	void clearCache(String cacheName);
}
