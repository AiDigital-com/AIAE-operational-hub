package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingCampaignIndexServiceImpl} - the read itself; the caching is
 * the container's, declared in {@code ehcache.xml}.
 */
@ExtendWith(MockitoExtension.class)
class PacingCampaignIndexServiceImplTest {

	@Mock
	private PacingCampaignAccessClient pacingCampaignAccessClient;

	@InjectMocks
	private PacingCampaignIndexServiceImpl service;

	@Test
	void shouldReadPacingsCampaignIdsAsASetTest() {
		// Given: Pacing's list, with a repeat
		when(pacingCampaignAccessClient.listCampaignIdsWithPacings()).thenReturn(List.of("200", "100", "200"));

		// When:
		Set<String> result = service.campaignIdsWithPacings();

		// Then:
		assertThat(result).containsExactly("100", "200");
	}

	@Test
	void shouldLeaveTheEvictionToTheCacheProxyTest() {
		// When:
		service.evict();

		// Then: the method itself calls nothing; the proxy drops the cached set
		verifyNoInteractions(pacingCampaignAccessClient);
	}
}
