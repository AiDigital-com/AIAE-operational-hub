package com.aidigital.operationalhub.cachemanagement.cache;

import lombok.RequiredArgsConstructor;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/**
 * Default {@link CacheService}. Injects every {@link CacheManager} bean and resolves a region name
 * against each, so regions from different managers are all reachable by name.
 */
@Service
@RequiredArgsConstructor
public class CacheServiceImpl implements CacheService {

	private final List<CacheManager> cacheManagers;

	@Override
	public List<Cache> getCachesByName(String name) {
		return cacheManagers.stream()
				.map(cacheManager -> cacheManager.getCache(name))
				.filter(Objects::nonNull)
				.toList();
	}
}
