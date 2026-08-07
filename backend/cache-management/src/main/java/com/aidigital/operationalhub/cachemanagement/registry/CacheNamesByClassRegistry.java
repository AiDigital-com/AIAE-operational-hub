package com.aidigital.operationalhub.cachemanagement.registry;

import java.util.List;
import java.util.Map;

/**
 * Application-supplied registry mapping a tracked class to the cache region names that must be cleared
 * when an instance of that class changes.
 *
 * <p>The application provides exactly one bean implementing this interface; the cache-management
 * mechanism flattens it (by {@link Class#getSimpleName() simple class name}) and uses it to resolve
 * which regions to evict for a given invalidation event.
 */
public interface CacheNamesByClassRegistry {

	/**
	 * Returns the cache region names to clear, keyed by tracked class.
	 *
	 * @return the cache names by class; never {@code null}
	 */
	Map<Class<?>, List<String>> cacheNamesByClassMap();
}
