package com.aidigital.operationalhub.cachemanagement.registry;

import java.util.List;

/**
 * Resolves cache region names from the {@link CacheNamesByClassRegistry} by a class's simple name —
 * the form carried in an invalidation event.
 */
public interface CacheNamesByClassService {

	/**
	 * Returns the cache region names registered for the given simple class name.
	 *
	 * @param simpleClassName the {@link Class#getSimpleName() simple class name}
	 * @return the registered cache names, or an empty list when none are registered
	 */
	List<String> getCacheNamesBySimpleClassName(String simpleClassName);

	/**
	 * Returns every registered cache region name across all classes.
	 *
	 * @return all registered cache names
	 */
	List<String> getAllCacheNames();
}
