package com.aidigital.operationalhub.cachemanagement.updater;

import com.aidigital.operationalhub.cachemanagement.cache.CacheService;
import com.aidigital.operationalhub.cachemanagement.registry.CacheNamesByClassService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CacheRegistryVerifier}.
 */
@ExtendWith(MockitoExtension.class)
class CacheRegistryVerifierTest {

	@Mock
	private CacheService cacheService;

	@Mock
	private CacheNamesByClassService cacheNamesByClassService;

	@InjectMocks
	private CacheRegistryVerifier verifier;

	@Test
	void shouldDoNothingWhenDisabledTest() {
		// Given: verify-registry defaults to false

		// When / Then: no registry/cache lookups, no failure
		assertThatCode(verifier::verify).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenRegisteredRegionIsMissingTest() {
		// Given:
		ReflectionTestUtils.setField(verifier, "verifyEnabled", true);
		when(cacheNamesByClassService.getAllCacheNames()).thenReturn(List.of("missing"));
		when(cacheService.getCachesByName("missing")).thenReturn(List.of());

		// When / Then:
		assertThatThrownBy(verifier::verify)
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("missing");
	}

	@Test
	void shouldPassWhenEveryRegionExistsTest() {
		// Given:
		ReflectionTestUtils.setField(verifier, "verifyEnabled", true);
		when(cacheNamesByClassService.getAllCacheNames()).thenReturn(List.of("present"));
		when(cacheService.getCachesByName("present")).thenReturn(List.of(org.mockito.Mockito.mock(Cache.class)));

		// When / Then:
		assertThatCode(verifier::verify).doesNotThrowAnyException();
	}
}
