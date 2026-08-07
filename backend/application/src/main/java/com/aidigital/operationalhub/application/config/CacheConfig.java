package com.aidigital.operationalhub.application.config;

import org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.jcache.JCacheCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.cache.Caching;
import java.net.URI;
import java.net.URISyntaxException;

/**
 * Enables Spring's caching abstraction and wires it over the same {@code ehcache.xml}-configured
 * JSR-107 provider that backs the Hibernate second-level cache, so every application cache region —
 * including {@code AgencyVisibilityService#AGENCY_VISIBILITY_CACHE} and the BigQuery search-result
 * cache ({@code CachedBigQuerySearchExecutor}) — is declared in one place with a real heap bound and
 * TTL, rather than created programmatically with no size cap.
 */
@Configuration
@EnableCaching
public class CacheConfig {

	/**
	 * The single JSR-107 cache manager backing both Hibernate's second-level cache and Spring's
	 * {@code @Cacheable}/{@code @CacheEvict} abstraction, built from {@code ehcache.xml}.
	 *
	 * @return the ehcache.xml-configured JSR-107 cache manager
	 */
	@Bean(destroyMethod = "close")
	javax.cache.CacheManager jCacheManager() {
		try {
			URI ehcacheConfig = getClass().getClassLoader().getResource("ehcache.xml").toURI();
			return Caching.getCachingProvider().getCacheManager(ehcacheConfig, getClass().getClassLoader());
		} catch (URISyntaxException ex) {
			throw new IllegalStateException("Cannot resolve ehcache.xml for the shared cache manager", ex);
		}
	}

	/**
	 * Adapts the shared JSR-107 cache manager to Spring's caching abstraction, so
	 * {@code @Cacheable}/{@code @CacheEvict} resolve every region declared in {@code ehcache.xml}.
	 *
	 * @param jCacheManager the shared JSR-107 cache manager
	 * @return the Spring cache manager
	 */
	@Bean
	CacheManager cacheManager(javax.cache.CacheManager jCacheManager) {
		return new JCacheCacheManager(jCacheManager);
	}

	/**
	 * Hands the shared JSR-107 cache manager to Hibernate so its second-level cache uses that exact
	 * instance, rather than creating its own from {@code ehcache.xml}.
	 *
	 * @param jCacheManager the shared JSR-107 cache manager
	 * @return the Hibernate properties customizer
	 */
	@Bean
	HibernatePropertiesCustomizer sharedJCacheManagerCustomizer(javax.cache.CacheManager jCacheManager) {
		return properties -> properties.put("hibernate.javax.cache.cache_manager", jCacheManager);
	}
}
