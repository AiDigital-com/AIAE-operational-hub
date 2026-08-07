package com.aidigital.operationalhub.application.cache;

import com.aidigital.operationalhub.application.config.CacheConfig;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.impl.AgencyVisibilityServiceImpl;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.instancio.Instancio;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

import java.util.List;
import java.util.Objects;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spring integration test proving the {@link AgencyVisibilityService#AGENCY_VISIBILITY_CACHE} caching:
 * a per-user result is served from cache on repeat calls, keyed by user id, and recomputed after eviction.
 */
@SpringJUnitConfig(AgencyVisibilityCachingTest.TestConfig.class)
class AgencyVisibilityCachingTest {

	private static final Long USER_ID = 1L;
	private static final String CLERK_ID = "clerk_1";

	@Configuration
	@Import(CacheConfig.class)
	static class TestConfig {

		@Bean
		RbacQueryService rbacQueryService() {
			return Mockito.mock(RbacQueryService.class);
		}

		@Bean
		HubTeamAgencyService hubTeamAgencyService() {
			return Mockito.mock(HubTeamAgencyService.class);
		}

		@Bean
		AgencyVisibilityService agencyVisibilityService(
				RbacQueryService rbacQueryService, HubTeamAgencyService hubTeamAgencyService) {
			return new AgencyVisibilityServiceImpl(rbacQueryService, hubTeamAgencyService);
		}
	}

	@Autowired
	private AgencyVisibilityService service;

	@Autowired
	private RbacQueryService rbacQueryService;

	@Autowired
	private CacheManager cacheManager;

	@BeforeEach
	void reset() {
		Mockito.reset(rbacQueryService);
		Objects.requireNonNull(cacheManager.getCache(AgencyVisibilityService.AGENCY_VISIBILITY_CACHE)).clear();
	}

	@Test
	void shouldServeFromCacheOnRepeatCallTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(adminAccess());
		CurrentUserModel user = user(USER_ID, CLERK_ID);

		// When: resolved twice for the same user
		service.resolveForCurrentUser(user);
		AgencyVisibility second = service.resolveForCurrentUser(user);

		// Verification: the second call is served from cache (access resolved only once)
		assertThat(second.seesAll()).isTrue();
		verify(rbacQueryService, times(1)).getEffectiveAccess(CLERK_ID);
	}

	@Test
	void shouldKeyCacheByUserIdTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(adminAccess());
		when(rbacQueryService.getEffectiveAccess("clerk_2")).thenReturn(adminAccess());

		// When: two distinct users are resolved
		service.resolveForCurrentUser(user(USER_ID, CLERK_ID));
		service.resolveForCurrentUser(user(2L, "clerk_2"));

		// Verification: each user is resolved on its own (separate cache keys)
		verify(rbacQueryService).getEffectiveAccess(CLERK_ID);
		verify(rbacQueryService).getEffectiveAccess("clerk_2");
	}

	@Test
	void shouldRecomputeAfterEvictionTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(adminAccess());
		CurrentUserModel user = user(USER_ID, CLERK_ID);

		// When: resolved, evicted, then resolved again
		service.resolveForCurrentUser(user);
		Objects.requireNonNull(cacheManager.getCache(AgencyVisibilityService.AGENCY_VISIBILITY_CACHE))
				.evict(USER_ID);
		service.resolveForCurrentUser(user);

		// Verification: eviction forces a rebuild
		verify(rbacQueryService, times(2)).getEffectiveAccess(CLERK_ID);
	}

	private static EffectiveAccessContext adminAccess() {
		return new EffectiveAccessContext(CLERK_ID, USER_ID, Set.of(), List.of(), true, true);
	}

	private static CurrentUserModel user(Long id, String clerkId) {
		return Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), id)
				.set(field(CurrentUserModel::clerkUserId), clerkId)
				.create();
	}
}
