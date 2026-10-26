package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
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

	@Mock
	private HubCampaignShareService hubCampaignShareService;

	@Mock
	private TeamCampaignScopeResolver teamCampaignScopeResolver;

	@InjectMocks
	private PacingScopeResolverImpl resolver;

	@Test
	void shouldCarryTheTeamsCampaignsWithPacingsBesideTheSharesTest() {
		// Given: a team member whose team's agencies have two campaigns with pacings, one of them also
		// shared with the person directly
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("MPO_MANAGER", "TEAM", TEAM_ID))));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of());
		when(hubUserService.findAllByIds(any())).thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID)));
		when(hubCampaignShareService.findCampaignIdsByUserId(USER_ID)).thenReturn(List.of(100L));
		when(teamCampaignScopeResolver.resolve(List.of(TEAM_ID))).thenReturn(List.of("100", "200"));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: still an owners scope, with the union of both lists and no repeat
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids()).containsExactly(ACTING_PACING_USER_ID);
		assertThat(entitlement.scope().campaignIds()).containsExactly("100", "200");
	}

	@Test
	void shouldDropTheTeamCampaignsAndKeepTheSharesWhenTheListWouldNotFitTheHeaderTest() {
		// Given: a team whose agencies have more campaigns with pacings than the header holds
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(access(false, List.of(assignment("TL", "TEAM", TEAM_ID))));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID)))
				.thenReturn(List.of());
		when(hubUserService.findAllByIds(any())).thenReturn(List.of(hubUser(USER_ID, ACTING_PACING_USER_ID)));
		when(hubCampaignShareService.findCampaignIdsByUserId(USER_ID)).thenReturn(List.of(7L));
		List<String> tooMany = java.util.stream.IntStream
				.range(0, PacingScopeResolverImpl.MAX_CAMPAIGN_IDS_IN_SCOPE + 1)
				.mapToObj(i -> String.valueOf(1000 + i))
				.toList();
		when(teamCampaignScopeResolver.resolve(List.of(TEAM_ID))).thenReturn(tooMany);

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: predictable degradation - the person's own shares, none of the team's campaigns
		assertThat(entitlement.scope().campaignIds()).containsExactly("7");
	}

	@Test
	void shouldResolveADirectorsSeveralTeamAssignmentsIntoOneOwnersScopeTest() {
		// Given: a Director holding DIRECTOR/TEAM on two teams of her stream (2026-10-23), each with a member
		Long otherTeamId = 131L;
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(false, List.of(
				assignment("DIRECTOR", "TEAM", TEAM_ID), assignment("DIRECTOR", "TEAM", otherTeamId))));
		HubRoleAssignment memberAssignment = new HubRoleAssignment();
		memberAssignment.setUserId(MEMBER_ID);
		HubRoleAssignment otherMemberAssignment = new HubRoleAssignment();
		otherMemberAssignment.setUserId(OTHER_MEMBER_ID);
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(TEAM_ID, otherTeamId)))
				.thenReturn(List.of(memberAssignment, otherMemberAssignment));
		when(hubUserService.findAllByIds(any())).thenReturn(List.of(
				hubUser(USER_ID, ACTING_PACING_USER_ID), hubUser(MEMBER_ID, MEMBER_PACING_USER_ID),
				hubUser(OTHER_MEMBER_ID, "33333333-3333-3333-3333-333333333333")));
		when(hubCampaignShareService.findCampaignIdsByUserId(USER_ID)).thenReturn(List.of());
		when(teamCampaignScopeResolver.resolve(List.of(TEAM_ID, otherTeamId))).thenReturn(List.of());

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: never "all" for a Director any more - the owners of both teams, herself included
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids()).containsExactlyInAnyOrder(
				ACTING_PACING_USER_ID, MEMBER_PACING_USER_ID, "33333333-3333-3333-3333-333333333333");
		assertThat(entitlement.canCreate()).isTrue();
	}

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
		// Given: a non-admin holding an ALL-scoped (global) role - a manual grant, since the sync stopped
		// handing Directors ALL on 2026-10-23
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
	void shouldCarrySharedCampaignsBesideAnOwnersScopeTest() {
		// Given: no team yet, but one campaign shared with the person
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access(false, List.of()));
		when(hubCampaignShareService.findCampaignIdsByUserId(any())).thenReturn(List.of(19813L));

		// When:
		PacingEntitlement entitlement = resolver.resolveForCurrentUser(user());

		// Then: still owners (never "all"), with the share as text ids Pacing filters campaign_ids by
		assertThat(entitlement.scope().kind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(entitlement.scope().ids()).isEmpty();
		assertThat(entitlement.scope().campaignIds()).containsExactly("19813");
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
