package com.aidigital.operationalhub.cachemanagement.updater;

import com.aidigital.operationalhub.cachemanagement.cache.CacheService;
import com.aidigital.operationalhub.cachemanagement.registry.CacheNamesByClassService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link CacheUpdaterService}: resolves region names from the registry and clears each region
 * found across the cache managers.
 */
@Service
@RequiredArgsConstructor
public class CacheUpdaterServiceImpl implements CacheUpdaterService {

	private static final Logger LOG = LoggerFactory.getLogger(CacheUpdaterServiceImpl.class);

	private final CacheService cacheService;
	private final CacheNamesByClassService cacheNamesByClassService;

	@Override
	public void clearCachesForClass(String simpleClassName) {
		List<String> cacheNames = cacheNamesByClassService.getCacheNamesBySimpleClassName(simpleClassName);
		cacheNames.forEach(this::clearCache);
		if (!cacheNames.isEmpty()) {
			LOG.debug("Cleared {} cache region(s) for class {}", cacheNames.size(), simpleClassName);
		}
	}

	@Override
	public void clearCache(String cacheName) {
		List<Cache> caches = cacheService.getCachesByName(cacheName);
		if (caches.isEmpty()) {
			LOG.warn("Cache region '{}' is registered for invalidation but not found in any cache manager", cacheName);
			return;
		}
		caches.forEach(Cache::clear);
	}
}
