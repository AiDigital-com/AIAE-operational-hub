package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
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
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingScopeResolverImpl}.
 *
 * <p>Every non-admin case is explicitly asserted to resolve to {@code owners}, never {@code all}:
 * widening access on a missing or misread role would be the worst possible bug here.
 *
 * <p>{@code owners} ids are Pacing {@code user_id}s (UUIDs, as text) as of the §1→§2 follow-up, not
 * emails — see {@link PacingScopeResolverImpl}'s own doc comment for the full reasoning.
 */
@ExtendWith(MockitoExtension.class)
class PacingScopeResolverImplTest {

	private static final String CLERK_ID = "user_clerk_1";
	private static final String USER_EMAIL = "acting-user@aidigital.com";
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
	private PacingScopeResolverImpl resolver;

	@Test
	void shouldBeUnrestrictedForAdminTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(true, List.of()));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then:
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_ALL);
		assertThat(entitlement.scope().ids()).isEmpty();
		assertThat(entitlement.canCreate()).isFalse();
		verifyNoInteractions(hubRoleAssignmentService, hubUserService);
	}

	@Test
	void shouldBeUnrestrictedForAllScopedRoleTest() {
		// Given: a non-admin holding an ALL-scoped (global) role, e.g. how DIRECTOR is provisioned
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("DIRECTOR", "ALL", null))));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then:
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_ALL);
		assertThat(entitlement.canCreate()).isTrue();
		verifyNoInteractions(hubRoleAssignmentService, hubUserService);
	}

	@Test
	void shouldResolveOwnersScopeWithTeamMemberPacingUserIdsForTeamScopedRoleTest() {
		// Given:
		RoleAssignmentModel teamAssignment = assignment("MPO_MANAGER", "TEAM", TEAM_ID);
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(teamAssignment)));
		HubRoleAssignment memberAssignment = new HubRoleAssignment();
		memberAssignment.setUserId(MEMBER_ID);
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of(memberAssignment));
		HubUser actingUser = hubUser(USER_ID, ACTING_PACING_USER_ID);
		HubUser member = hubUser(MEMBER_ID, MEMBER_PACING_USER_ID);
		// The resolver looks up its OWN pacing_user_id the same way as any team member's — both come
		// out of the same batch load, keyed by hub_users.id, not by email.
		when(hubUserService.findAllByIds(argThat(ids -> Set.copyOf(ids).equals(Set.of(USER_ID, MEMBER_ID)))))
				.thenReturn(List.of(actingUser, member));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: never "all" — a TEAM scope must resolve to owners, restricted to the team's members
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids())
				.containsExactlyInAnyOrder(ACTING_PACING_USER_ID, MEMBER_PACING_USER_ID);
		assertThat(entitlement.canCreate()).isTrue();
	}

	@Test
	void shouldSkipATeamMemberWithNoPacingUserIdYetTest() {
		// Given: `notSyncedMember` has no pacing_user_id yet - §2 has not reached them - and must be
		// omitted from the scope rather than poisoning it with a null/blank id. This is the failure mode
		// this whole design exists to avoid, so it must never silently include everyone else's pacings
		// disappearing along with it - only the unsynced member drops out.
		RoleAssignmentModel teamAssignment = assignment("MPO_MANAGER", "TEAM", TEAM_ID);
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(teamAssignment)));
		HubRoleAssignment memberAssignment = new HubRoleAssignment();
		memberAssignment.setUserId(MEMBER_ID);
		HubRoleAssignment notSyncedAssignment = new HubRoleAssignment();
		notSyncedAssignment.setUserId(OTHER_MEMBER_ID);
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of(memberAssignment, notSyncedAssignment));
		HubUser actingUser = hubUser(USER_ID, ACTING_PACING_USER_ID);
		HubUser member = hubUser(MEMBER_ID, MEMBER_PACING_USER_ID);
		HubUser notSyncedMember = hubUser(OTHER_MEMBER_ID, null);
		when(hubUserService.findAllByIds(
				argThat(ids -> Set.copyOf(ids).equals(Set.of(USER_ID, MEMBER_ID, OTHER_MEMBER_ID)))))
				.thenReturn(List.of(actingUser, member, notSyncedMember));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: the unsynced member is omitted, not included as null/blank, and everyone else survives
		assertThat(entitlement.scope().ids())
				.containsExactlyInAnyOrder(ACTING_PACING_USER_ID, MEMBER_PACING_USER_ID)
				.doesNotContainNull();
	}

	@Test
	void shouldResolveEmptyOwnersScopeForClientServicesTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("CLIENT_SERVICES", "CLIENT", 99L))));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: never "all" — Client Services is entitled to nothing until campaign-based scoping lands
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids()).isEmpty();
		// Client Services is excluded from can_create even though it holds an active assignment:
		// creating a pacing is MPO work, and CS is the one role where the answer is genuinely doubtful.
		assertThat(entitlement.canCreate()).isFalse();
		verifyNoInteractions(hubRoleAssignmentService, hubUserService);
	}

	@Test
	void shouldGrantCanCreateForMpoTlDirectorAndAdminAssignmentsTest() {
		// Given: an active, non-Client-Services assignment for each of MPO, TL, DIRECTOR and ADMIN
		for (String roleCode : List.of("MPO_MANAGER", "TL", "DIRECTOR", "ADMIN")) {
			when(rbacQueryService.getEffectiveAccess(CLERK_ID))
					.thenReturn(access(false, List.of(assignment(roleCode, "TEAM", TEAM_ID))));
			when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
					.thenReturn(List.of());
			when(hubUserService.findAllByIds(any())).thenReturn(List.of());

			// When:
			PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

			// Then: any active role other than Client Services grants can_create
			assertThat(entitlement.canCreate()).as("canCreate for role %s", roleCode).isTrue();
		}
	}

	@Test
	void shouldResolveEmptyOwnersScopeWhenUserHasNoActiveAssignmentTest() {
		// Given:
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(false, List.of()));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: never "all" — no role at all must not widen access
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids()).isEmpty();
		assertThat(entitlement.canCreate()).isFalse();
		verifyNoInteractions(hubRoleAssignmentService, hubUserService);
	}

	private static CurrentUserModel user() {
		return Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.set(field(CurrentUserModel::email), USER_EMAIL)
				.create();
	}

	private static HubUser hubUser(Long id, String pacingUserId) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setPacingUserId(pacingUserId);
		return user;
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
