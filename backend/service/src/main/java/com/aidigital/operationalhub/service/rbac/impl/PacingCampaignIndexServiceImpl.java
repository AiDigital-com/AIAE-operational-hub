package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.service.rbac.PacingCampaignIndexService;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.Set;
import java.util.TreeSet;

/**
 * Default {@link PacingCampaignIndexService}: one system call to Pacing, cached under
 * {@link #CAMPAIGNS_WITH_PACINGS_CACHE} with a fixed key, since there is exactly one answer for
 * everybody.
 */
@Service
@RequiredArgsConstructor
public class PacingCampaignIndexServiceImpl implements PacingCampaignIndexService {

	/**
	 * The one cache key: the set is fleet-wide, not per user.
	 */
	static final String CACHE_KEY = "'all'";

	private final PacingCampaignAccessClient pacingCampaignAccessClient;

	@Override
	@Cacheable(cacheNames = CAMPAIGNS_WITH_PACINGS_CACHE, key = CACHE_KEY)
	public Set<String> campaignIdsWithPacings() {
		return new TreeSet<>(pacingCampaignAccessClient.listCampaignIdsWithPacings());
	}

	@Override
	@CacheEvict(cacheNames = CAMPAIGNS_WITH_PACINGS_CACHE, allEntries = true)
	public void evict() {
		// The annotation is the whole method: nothing to do but let the proxy drop the entry.
	}
}
