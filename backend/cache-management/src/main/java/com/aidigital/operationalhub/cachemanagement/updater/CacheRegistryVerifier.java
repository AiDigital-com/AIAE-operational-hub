package com.aidigital.operationalhub.cachemanagement.updater;

import com.aidigital.operationalhub.cachemanagement.cache.CacheService;
import com.aidigital.operationalhub.cachemanagement.registry.CacheNamesByClassService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Optional startup check that every cache region named in the
 * {@link com.aidigital.operationalhub.cachemanagement.registry.CacheNamesByClassRegistry} actually
 * exists in some cache manager — catching registry typos and stale region names. Disabled by default
 * (regions may be created lazily); enable via {@code app.cache-management.verify-registry=true} in
 * non-production environments.
 */
@Component
@RequiredArgsConstructor
public class CacheRegistryVerifier {

	private final CacheService cacheService;
	private final CacheNamesByClassService cacheNamesByClassService;

	@Value("${app.cache-management.verify-registry:false}")
	private boolean verifyEnabled;

	/**
	 * Verifies that each registered cache name resolves to at least one cache region.
	 *
	 * @throws IllegalStateException when a registered region is missing from every cache manager
	 */
	@PostConstruct
	public void verify() {
		if (!verifyEnabled) {
			return;
		}
		for (String cacheName : cacheNamesByClassService.getAllCacheNames()) {
			if (cacheService.getCachesByName(cacheName).isEmpty()) {
				throw new IllegalStateException("Cache region '" + cacheName
						+ "' is registered in CacheNamesByClassRegistry but not found in any cache manager");
			}
		}
	}
}
