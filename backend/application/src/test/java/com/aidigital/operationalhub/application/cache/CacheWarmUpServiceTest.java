package com.aidigital.operationalhub.application.cache;

import com.aidigital.operationalhub.application.cache.properties.HubCacheProperties;
import com.aidigital.operationalhub.domain.ToWarmUp;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CacheWarmUpServiceTest {

	@Test
	void shouldWarmUpCacheWhenEnabledTest() {
		// Given:
		HubCacheProperties cacheProperties = new HubCacheProperties();
		cacheProperties.setWarmupEnabled(true);
		ToWarmUp<HubRole> roleRepository = mock();
		HubRole role = Instancio.create(HubRole.class);
		when(roleRepository.getClazz()).thenReturn(HubRole.class);
		when(roleRepository.findAll()).thenReturn(List.of(role));
		CacheWarmUpService cacheWarmUpService = spy(new CacheWarmUpService(
				cacheProperties,
				List.of(roleRepository)
		));

		// When:
		cacheWarmUpService.initCache();

		// Then:
		verify(cacheWarmUpService, times(1)).warmUpCache();
		verify(roleRepository, times(1)).getClazz();
		verify(roleRepository, times(1)).findAll();
	}

	@Test
	void shouldNotWarmUpCacheWhenDisabledTest() {
		// Given:
		HubCacheProperties cacheProperties = new HubCacheProperties();
		cacheProperties.setWarmupEnabled(false);
		ToWarmUp<HubRole> roleRepository = mock();
		CacheWarmUpService cacheWarmUpService = spy(new CacheWarmUpService(
				cacheProperties,
				List.of(roleRepository)
		));

		// When:
		cacheWarmUpService.initCache();

		// Then:
		verify(cacheWarmUpService, never()).warmUpCache();
		verifyNoInteractions(roleRepository);
	}

	@Test
	void shouldWarmUpCacheOnlyOnceTest() {
		// Given:
		HubCacheProperties cacheProperties = new HubCacheProperties();
		cacheProperties.setWarmupEnabled(true);
		ToWarmUp<HubRole> roleRepository = mock();
		HubRole role = Instancio.create(HubRole.class);
		when(roleRepository.getClazz()).thenReturn(HubRole.class);
		when(roleRepository.findAll()).thenReturn(List.of(role));
		CacheWarmUpService cacheWarmUpService = spy(new CacheWarmUpService(
				cacheProperties,
				List.of(roleRepository)
		));

		// When:
		cacheWarmUpService.initCache();
		cacheWarmUpService.initCache();

		// Then:
		verify(cacheWarmUpService, times(1)).warmUpCache();
		verify(roleRepository, times(1)).getClazz();
		verify(roleRepository, times(1)).findAll();
	}

	@Test
	void shouldCallFindAllForEachRepositoryWhenWarmUpCacheTest() {
		// Given:
		HubCacheProperties cacheProperties = new HubCacheProperties();
		ToWarmUp<HubRole> roleRepository = mock();
		ToWarmUp<HubScopeType> scopeTypeRepository = mock();
		HubRole role = Instancio.create(HubRole.class);
		HubScopeType scopeType = Instancio.create(HubScopeType.class);
		when(roleRepository.getClazz()).thenReturn(HubRole.class);
		when(roleRepository.findAll()).thenReturn(List.of(role));
		when(scopeTypeRepository.getClazz()).thenReturn(HubScopeType.class);
		when(scopeTypeRepository.findAll()).thenReturn(List.of(scopeType));
		CacheWarmUpService cacheWarmUpService = new CacheWarmUpService(
				cacheProperties,
				List.of(roleRepository, scopeTypeRepository)
		);

		// When:
		cacheWarmUpService.warmUpCache();

		// Then:
		verify(roleRepository, times(1)).getClazz();
		verify(roleRepository, times(1)).findAll();
		verify(scopeTypeRepository, times(1)).getClazz();
		verify(scopeTypeRepository, times(1)).findAll();
	}
}
