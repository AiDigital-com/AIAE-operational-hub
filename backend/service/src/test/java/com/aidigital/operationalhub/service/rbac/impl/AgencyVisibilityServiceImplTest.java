package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link AgencyVisibilityServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class AgencyVisibilityServiceImplTest {

	private static final String CLERK_ID = "user_clerk_1";
	private static final Long USER_ID = 1L;
	private static final Long TEAM_ID = 130L;

	@Mock
	private RbacQueryService rbacQueryService;

	@Mock
	private HubTeamAgencyService hubTeamAgencyService;

	@InjectMocks
	private AgencyVisibilityServiceImpl service;

	@Test
	void shouldBeUnrestrictedForAdminTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(true, List.of()));

		// When:
		AgencyVisibility visibility = service.resolveForCurrentUser(user());

		// Verification:
		assertThat(visibility.seesAll()).isTrue();
		verifyNoInteractions(hubTeamAgencyService);
	}

	@Test
	void shouldBeUnrestrictedForAllScopedRoleTest() {
		// Given: a non-admin holding an ALL-scoped (global) role
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("DIRECTOR", "ALL", null))));

		// When:
		AgencyVisibility visibility = service.resolveForCurrentUser(user());

		// Verification:
		assertThat(visibility.seesAll()).isTrue();
		verifyNoInteractions(hubTeamAgencyService);
	}

	@Test
	void shouldRestrictToTeamAgenciesForTeamScopedRoleTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("MPO_MANAGER", "TEAM", TEAM_ID))));
		when(hubTeamAgencyService.findAgencyIdsByTeamIdIn(List.of(TEAM_ID))).thenReturn(List.of(500L, 501L));

		// When:
		AgencyVisibility visibility = service.resolveForCurrentUser(user());

		// Verification:
		assertThat(visibility.seesAll()).isFalse();
		assertThat(visibility.agencyIds()).containsExactlyInAnyOrder(500L, 501L);
		assertThat(visibility.seesNothing()).isFalse();
	}

	@Test
	void shouldSeeNothingWhenUserHasNoGrantingRoleTest() {
		// Given: a user with no role assignments
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(false, List.of()));

		// When:
		AgencyVisibility visibility = service.resolveForCurrentUser(user());

		// Verification:
		assertThat(visibility.seesNothing()).isTrue();
	}

	@Test
	void shouldNotBeTransactionalSoAWarmCacheHitBorrowsNoConnectionTest() throws NoSuchMethodException {
		// Given: the delegates it wraps already open their own read-only transaction on a cache miss
		Method resolveForCurrentUser =
				AgencyVisibilityServiceImpl.class.getMethod("resolveForCurrentUser", CurrentUserModel.class);

		// Execution + Verification: no @Transactional here, or a cache hit would borrow a connection anyway
		assertThat(resolveForCurrentUser.isAnnotationPresent(Transactional.class)).isFalse();
	}

	private static CurrentUserModel user() {
		return Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
	}

	private static EffectiveAccessContext access(boolean admin, List<RoleAssignmentModel> assignments) {
		return new EffectiveAccessContext(CLERK_ID, USER_ID, Set.of(), assignments, admin, admin);
	}

	private static RoleAssignmentModel assignment(String roleCode, String scopeCode, Long scopeId) {
		HubRoleAssignment entity = new HubRoleAssignment();
		entity.setScopeId(scopeId);
		return new RoleAssignmentModel(entity, roleCode, scopeCode);
	}
}
