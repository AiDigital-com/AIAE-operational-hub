package com.aidigital.operationalhub.cachemanagement.cache;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CacheServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class CacheServiceImplTest {

	@Mock
	private CacheManager firstManager;

	@Mock
	private CacheManager secondManager;

	@Mock
	private Cache cache;

	@Test
	void shouldCollectMatchingCachesAcrossManagersIgnoringMissesTest() {
		// Given: only the first manager knows the region
		when(firstManager.getCache("region")).thenReturn(cache);
		when(secondManager.getCache("region")).thenReturn(null);
		CacheServiceImpl service = new CacheServiceImpl(List.of(firstManager, secondManager));

		// When / Then:
		assertThat(service.getCachesByName("region")).containsExactly(cache);
	}
}
