package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceRoster;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingAudienceResolver} — the reverse of
 * {@code PacingScopeResolverImpl}, so every case here mirrors a forward-resolver case: whoever the
 * forward resolver would entitle to see an owner's pacings must appear in that owner's audience, and
 * nobody else. Widening (a stranger in the audience becomes a Google Sheet grant) is the failure
 * mode these tests exist to prevent.
 */
@ExtendWith(MockitoExtension.class)
class PacingAudienceResolverTest {

	private static final Long ADMIN_ID = 1L;
	private static final Long DIRECTOR_ID = 2L;
	private static final Long OWNER_ID = 3L;
	private static final Long TEAMMATE_ID = 4L;
	private static final Long OUTSIDER_ID = 5L;
	private static final Long INACTIVE_ID = 6L;
	private static final Long TEAM_A = 100L;
	private static final Long TEAM_B = 200L;
	private static final String OWNER_PACING_ID = "11111111-1111-1111-1111-111111111111";
	private static final String OUTSIDER_PACING_ID = "22222222-2222-2222-2222-222222222222";

	@Mock
	private HubUserService hubUserService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@InjectMocks
	private PacingAudienceResolver resolver;

	@Test
	void shouldResolveGlobalsFromAdminRoleAndAllScopeOnlyTest() {
		// Given: an admin (role code), a director (ALL scope), and a team-scoped user
		when(hubUserService.findAll()).thenReturn(List.of(
				user(ADMIN_ID, "admin@x.com", HubStatus.ACTIVE, null),
				user(DIRECTOR_ID, "director@x.com", HubStatus.ACTIVE, null),
				user(TEAMMATE_ID, "mate@x.com", HubStatus.ACTIVE, null)));
		when(hubRoleAssignmentService.findAllActive()).thenReturn(List.of(
				assignment(ADMIN_ID, "ADMIN", "OWN", null),
				assignment(DIRECTOR_ID, "DIRECTOR", "ALL", null),
				assignment(TEAMMATE_ID, "MPO_MANAGER", "TEAM", TEAM_A)));

		// When:
		PacingAudienceRoster roster = resolver.resolve();

		// Then: the TEAM-scoped user is not a global viewer
		assertThat(roster.globalEmails()).containsExactly("admin@x.com", "director@x.com");
	}

	@Test
	void shouldResolveTeamViewersAsCoAssignedTeamMembersKeyedByOwnerPacingIdTest() {
		// Given: owner and teammate share TEAM_A; the outsider holds TEAM_B only
		when(hubUserService.findAll()).thenReturn(List.of(
				user(OWNER_ID, "owner@x.com", HubStatus.ACTIVE, OWNER_PACING_ID),
				user(TEAMMATE_ID, "mate@x.com", HubStatus.ACTIVE, null),
				user(OUTSIDER_ID, "outsider@x.com", HubStatus.ACTIVE, OUTSIDER_PACING_ID)));
		when(hubRoleAssignmentService.findAllActive()).thenReturn(List.of(
				assignment(OWNER_ID, "MPO_MANAGER", "TEAM", TEAM_A),
				assignment(TEAMMATE_ID, "TL", "TEAM", TEAM_A),
				assignment(OUTSIDER_ID, "MPO_MANAGER", "TEAM", TEAM_B)));

		// When:
		PacingAudienceRoster roster = resolver.resolve();

		// Then: the owner's audience is their team (owner included - Pacing dedupes against its own
		// locally-computed owner leg), never the other team's member
		assertThat(roster.teamViewerEmailsByOwnerPacingId().get(OWNER_PACING_ID))
				.containsExactly("mate@x.com", "owner@x.com");
		assertThat(roster.teamViewerEmailsByOwnerPacingId().get(OUTSIDER_PACING_ID))
				.containsExactly("outsider@x.com");
	}

	@Test
	void shouldKeepAKnownOwnerWithNoTeamAsAnEmptyEntryNotAnAbsentOneTest() {
		// Given: an owner with a pacing_user_id but no TEAM assignment at all
		when(hubUserService.findAll()).thenReturn(List.of(
				user(OWNER_ID, "owner@x.com", HubStatus.ACTIVE, OWNER_PACING_ID)));
		when(hubRoleAssignmentService.findAllActive()).thenReturn(List.of());

		// When:
		PacingAudienceRoster roster = resolver.resolve();

		// Then: present with an empty list - the sync service tells "known, teamless" apart from
		// "unknown owner id" (a §2 sync gap) by exactly this containsKey distinction
		assertThat(roster.teamViewerEmailsByOwnerPacingId()).containsEntry(OWNER_PACING_ID, List.of());
	}

	@Test
	void shouldNeverEmitInactiveOrEmaillessEmployeesTest() {
		// Given: an inactive admin, an active admin with a blank email, and an inactive teammate
		HubUser blankEmailAdmin = user(DIRECTOR_ID, " ", HubStatus.ACTIVE, null);
		when(hubUserService.findAll()).thenReturn(List.of(
				user(ADMIN_ID, "gone@x.com", HubStatus.INACTIVE, null),
				blankEmailAdmin,
				user(OWNER_ID, "owner@x.com", HubStatus.ACTIVE, OWNER_PACING_ID),
				user(INACTIVE_ID, "left@x.com", HubStatus.INACTIVE, null)));
		when(hubRoleAssignmentService.findAllActive()).thenReturn(List.of(
				assignment(ADMIN_ID, "ADMIN", "OWN", null),
				assignment(DIRECTOR_ID, "ADMIN", "OWN", null),
				assignment(OWNER_ID, "MPO_MANAGER", "TEAM", TEAM_A),
				assignment(INACTIVE_ID, "TL", "TEAM", TEAM_A)));

		// When:
		PacingAudienceRoster roster = resolver.resolve();

		// Then: these lists become Google Drive grants - departed people must fall out of them
		assertThat(roster.globalEmails()).isEmpty();
		assertThat(roster.teamViewerEmailsByOwnerPacingId().get(OWNER_PACING_ID))
				.containsExactly("owner@x.com");
	}

	/**
	 * Builds a Hub user with the fields the resolver reads.
	 *
	 * @param id           the hub_users id
	 * @param email        the email address
	 * @param status       the employment status
	 * @param pacingUserId the Pacing user id, or {@code null} when the §2 sync has not linked them
	 * @return the user
	 */
	HubUser user(Long id, String email, HubStatus status, String pacingUserId) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setEmail(email);
		user.setStatus(status.getCode());
		user.setPacingUserId(pacingUserId);
		return user;
	}

	/**
	 * Builds an active role assignment with the associations the resolver reads.
	 *
	 * @param userId    the holder's hub_users id
	 * @param roleCode  the role dictionary code
	 * @param scopeCode the scope dictionary code
	 * @param scopeId   the scope id, or {@code null} for unscoped
	 * @return the assignment
	 */
	HubRoleAssignment assignment(Long userId, String roleCode, String scopeCode, Long scopeId) {
		HubRole role = new HubRole();
		role.setRoleCode(roleCode);
		HubScopeType scopeType = new HubScopeType();
		scopeType.setScopeCode(scopeCode);
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		assignment.setRole(role);
		assignment.setScopeType(scopeType);
		assignment.setScopeId(scopeId);
		assignment.setStatus(HubStatus.ACTIVE.getCode());
		return assignment;
	}
}
