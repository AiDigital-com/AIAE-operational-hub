package com.aidigital.operationalhub.service.cache;

import com.aidigital.operationalhub.cachemanagement.registry.CacheNamesByClassRegistry;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Maps each tracked Hub entity to the cache regions invalidated when it changes: the Hibernate L2
 * regions (entity + query caches, aliased {@code hibernate-cache.*} in {@code ehcache.xml}) and, for
 * the access-control inputs, the Spring agency-visibility cache. Names must match the registered
 * regions exactly; enable {@code app.cache-management.verify-registry} to assert this at startup.
 */
@Component
public class HubCacheNamesByClassRegistry implements CacheNamesByClassRegistry {

	private static final String L2 = "hibernate-cache.";
	private static final String ENTITY = L2 + "com.aidigital.operationalhub.domain.entity.";

	private static final Map<Class<?>, List<String>> CACHE_NAMES_BY_CLASS = Map.of(
			HubRole.class, List.of(
					L2 + "findAllHubRoles",
					L2 + "findByRoleCode",
					L2 + "findAllHubRolesByStatusOrderByDisplayNameAsc",
					ENTITY + "HubRole"),
			HubScopeType.class, List.of(
					L2 + "findAllHubScopeTypes",
					L2 + "findByScopeCode",
					L2 + "findAllHubScopesByStatusOrderByDisplayNameAsc",
					ENTITY + "HubScopeType"),
			HubTeam.class, List.of(
					L2 + "findAllHubTeams",
					L2 + "existsHubTeamById",
					ENTITY + "HubTeam"),
			HubUser.class, List.of(
					L2 + "findByClerkUserId",
					ENTITY + "HubUser"),
			HubRoleAssignment.class, List.of(
					L2 + "findAllByUserIdAndStatus",
					L2 + "findAllByUserIdInAndStatus",
					ENTITY + "HubRoleAssignment",
					AgencyVisibilityService.AGENCY_VISIBILITY_CACHE),
			HubTeamAgency.class, List.of(
					AgencyVisibilityService.AGENCY_VISIBILITY_CACHE));

	@Override
	public Map<Class<?>, List<String>> cacheNamesByClassMap() {
		return CACHE_NAMES_BY_CLASS;
	}
}
