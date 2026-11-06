package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingTeamOwnersResolverImpl}.
 */
@ExtendWith(MockitoExtension.class)
class PacingTeamOwnersResolverImplTest {

	private static final String CLERK_ID = "user_clerk_1";
	private static final Long USER_ID = 1L;
	private static final Long MEMBER_ID = 2L;
	private static final Long OTHER_MEMBER_ID = 3L;
	private static final Long TEAM_ID = 130L;
	private static final String ACTING_PACING_USER_ID = "11111111-1111-1111-1111-111111111111";
	private static final String MEMBER_PACING_USER_ID = "22222222-2222-2222-2222-222222222222";

	@Mock
	private RbacQueryService rbacQueryService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@Mock
	private HubUserService hubUserService;

	@InjectMocks
	private PacingTeamOwnersResolverImpl resolver;

	@Test
	void shouldResolveTheUserAndTheirTeamMatesTest() {
		// Given: a member of one team with one team-mate
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("MPO_MANAGER", "TEAM", TEAM_ID))));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of(holder(USER_ID), holder(MEMBER_ID)));
		when(hubUserService.findAllByIds(argThat(ids -> ids.containsAll(List.of(USER_ID, MEMBER_ID)) && ids.size() == 2)))
				.thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID), hubUser(MEMBER_ID, MEMBER_PACING_USER_ID)));

		// When:
		List<String> ids = resolver.resolveTeamOwnerIds(user());

		// Then:
		assertThat(ids).containsExactly(ACTING_PACING_USER_ID, MEMBER_PACING_USER_ID);
		verify(hubRoleAssignmentService, never()).findActiveByRoleCode(anyString());
	}

	@Test
	void shouldResolveEveryAdminForAnAdminTest() {
		// Given: an admin, and one other admin
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(true, List.of(assignment("ADMIN", "ALL", null))));
		when(hubRoleAssignmentService.findActiveByRoleCode("ADMIN"))
				.thenReturn(List.of(holder(USER_ID), holder(MEMBER_ID)));
		when(hubUserService.findAllByIds(any()))
				.thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID), hubUser(MEMBER_ID, MEMBER_PACING_USER_ID)));

		// When:
		List<String> ids = resolver.resolveTeamOwnerIds(user());

		// Then: the admins are each other's team
		assertThat(ids).containsExactly(ACTING_PACING_USER_ID, MEMBER_PACING_USER_ID);
		verify(hubRoleAssignmentService, never()).findActiveByScopeTypeCodeAndScopeIds(anyString(), any());
	}

	@Test
	void shouldResolveTheUserAloneWithoutATeamTest() {
		// Given: no TEAM-scoped assignment at all
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(false, List.of()));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of())).thenReturn(List.of());
		when(hubUserService.findAllByIds(Set.of(USER_ID))).thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID)));

		// When:
		List<String> ids = resolver.resolveTeamOwnerIds(user());

		// Then:
		assertThat(ids).containsExactly(ACTING_PACING_USER_ID);
	}

	@Test
	void shouldLeaveOutMembersNotSyncedToPacingTest() {
		// Given: a team-mate the Pacing user sync has not reached, and a null holder
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("TL", "TEAM", TEAM_ID))));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of(holder(OTHER_MEMBER_ID), holder(null)));
		when(hubUserService.findAllByIds(any()))
				.thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID), hubUser(OTHER_MEMBER_ID, null)));

		// When:
		List<String> ids = resolver.resolveTeamOwnerIds(user());

		// Then:
		assertThat(ids).containsExactly(ACTING_PACING_USER_ID);
	}

	private static CurrentUserModel user() {
		return Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
	}

	private static HubUser hubUser(Long id, String pacingUserId) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setPacingUserId(pacingUserId);
		return user;
	}

	private static HubRoleAssignment holder(Long userId) {
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		return assignment;
	}

	private static EffectiveAccessContext access(boolean admin, List<RoleAssignmentModel> assignments) {
		Set<String> roleCodes = assignments.stream().map(RoleAssignmentModel::roleCode)
				.collect(java.util.stream.Collectors.toSet());
		return new EffectiveAccessContext(CLERK_ID, USER_ID, roleCodes, assignments, admin, admin);
	}

	private static RoleAssignmentModel assignment(String roleCode, String scopeCode, Long scopeId) {
		HubRoleAssignment entity = new HubRoleAssignment();
		entity.setScopeId(scopeId);
		return new RoleAssignmentModel(entity, roleCode, scopeCode);
	}
}
