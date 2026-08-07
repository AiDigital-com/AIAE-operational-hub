package com.aidigital.operationalhub.cachemanagement.registry;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CacheNamesByClassServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class CacheNamesByClassServiceImplTest {

	@Mock
	private CacheNamesByClassRegistry registry;

	@Test
	void shouldResolveCacheNamesBySimpleClassNameTest() {
		// Given: the registry maps two classes to cache regions (constructor consumes it, so build after stubbing)
		when(registry.cacheNamesByClassMap()).thenReturn(Map.of(
				String.class, List.of("a", "b"),
				Integer.class, List.of("c")));
		CacheNamesByClassServiceImpl service = new CacheNamesByClassServiceImpl(registry);

		// When / Then:
		assertThat(service.getCacheNamesBySimpleClassName("String")).containsExactly("a", "b");
		assertThat(service.getCacheNamesBySimpleClassName("Integer")).containsExactly("c");
		assertThat(service.getCacheNamesBySimpleClassName("Unknown")).isEmpty();
		assertThat(service.getAllCacheNames()).containsExactlyInAnyOrder("a", "b", "c");
	}
}
