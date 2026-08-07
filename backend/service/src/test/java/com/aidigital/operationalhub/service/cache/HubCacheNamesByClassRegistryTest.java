package com.aidigital.operationalhub.service.cache;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link HubCacheNamesByClassRegistry} — the static class → cache-region mapping.
 */
class HubCacheNamesByClassRegistryTest {

	private final HubCacheNamesByClassRegistry registry = new HubCacheNamesByClassRegistry();

	@Test
	void shouldMapEntitiesToTheirCacheRegionsTest() {
		// When:
		Map<Class<?>, List<String>> map = registry.cacheNamesByClassMap();

		// Verification: L2 regions for HubTeam, and the agency-visibility cache for the access-control inputs
		assertThat(map.get(HubTeam.class))
				.contains("hibernate-cache.findAllHubTeams",
						"hibernate-cache.com.aidigital.operationalhub.domain.entity.HubTeam");
		assertThat(map.get(HubRoleAssignment.class))
				.contains(
						AgencyVisibilityService.AGENCY_VISIBILITY_CACHE,
						"hibernate-cache.findAllByUserIdAndStatus",
						"hibernate-cache.findAllByUserIdInAndStatus");
		assertThat(map.get(HubTeamAgency.class)).containsExactly(AgencyVisibilityService.AGENCY_VISIBILITY_CACHE);
	}
}
