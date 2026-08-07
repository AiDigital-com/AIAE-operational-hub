package com.aidigital.operationalhub.service.netsuite.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.Grade;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import com.aidigital.operationalhub.service.netsuite.org.NameNormalizer;
import com.aidigital.operationalhub.service.netsuite.org.OrgResolution;
import com.aidigital.operationalhub.service.netsuite.org.OrgRole;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedEmployee;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedTeam;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link NetSuiteSyncReconciler}. Covers the DB-write side extracted from
 * {@link NetSuiteSyncServiceImpl} by {@code team-by-team-lead-REMEDIATION.md} R2: team upsert/deactivation,
 * grade, role/scope assignment (including the R1 director-ALL-scope and R5 unresolved-member-revoke
 * behavior), agency mapping, and the bulk-preload read pattern — users,
 * assignments (any status), and teams are each loaded once via
 * {@code findAllByEmailIgnoreCaseIn}/{@code findAllByUserIds}/{@code listAllOrderedByName} rather than
 * queried per employee. {@link NameNormalizer} is used as a real instance (like
 * {@code OrgTreeTeamResolverTest} does for its own trivial collaborators) rather than mocked, so tests
 * genuinely exercise the shared collapse-whitespace matching (R4) instead of asserting against a stub.
 */
@ExtendWith(MockitoExtension.class)
class NetSuiteSyncReconcilerTest {

	private static final Long TL_ROLE_ID = 1L;
	private static final Long MEMBER_ROLE_ID = 2L;
	private static final Long DIRECTOR_ROLE_ID = 3L;
	private static final Long ADMIN_ROLE_ID = 4L;
	private static final Long TEAM_SCOPE_ID = 5L;
	private static final Long ALL_SCOPE_ID = 6L;
	private static final Long TEAM_ID = 10L;
	private static final Long USER_ID = 100L;
	private static final Long AGENCY_ID = 500L;
	private static final String TEAM_NAME = "Media Optimization: Jane";
	private static final String EMAIL = "jane@example.com";
	private static final String LEAD_NAME = "Jane Lead";
	private static final String MEMBER_NAME = "John Member";

	@Mock
	private HubTeamService teamService;

	@Mock
	private HubUserService userService;

	@Mock
	private HubRoleService roleService;

	@Mock
	private HubScopeTypeService scopeTypeService;

	@Mock
	private HubRoleAssignmentService assignmentService;

	@Mock
	private HubTeamAgencyService teamAgencyService;

	@Mock
	private CacheInvalidationEventService cacheInvalidationEventService;

	@Test
	void shouldCreateTeamUserAndTeamLeadAssignmentForLeadTest() {
		// Given: no existing user, team, or assignment - all preload queries return empty
		stubDictionaries();
		when(teamAgencyService.findAll()).thenReturn(List.of());
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(teamService.create(any())).thenReturn(team(TEAM_ID));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, LEAD_NAME)));

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 1, 1));

		ArgumentCaptor<HubTeam> teamCaptor = ArgumentCaptor.forClass(HubTeam.class);
		verify(teamService).create(teamCaptor.capture());
		assertThat(teamCaptor.getValue().getTeamName()).isEqualTo(TEAM_NAME);
		assertThat(teamCaptor.getValue().isFromNetSuite()).isTrue();
		assertThat(teamCaptor.getValue().getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(teamCaptor.getValue().getPodKey()).isEqualTo("HOUSE");
		assertThat(teamCaptor.getValue().getTeamLeadUserId()).isEqualTo(USER_ID);

		ArgumentCaptor<HubUser> userCaptor = ArgumentCaptor.forClass(HubUser.class);
		verify(userService).save(userCaptor.capture());
		assertThat(userCaptor.getValue().getEmail()).isEqualTo(EMAIL);
		assertThat(userCaptor.getValue().getDisplayName()).isEqualTo(LEAD_NAME);
		assertThat(userCaptor.getValue().getClerkUserId()).isNull();
		assertThat(userCaptor.getValue().getStatus()).isEqualTo(HubStatus.INACTIVE.getCode());
		assertThat(userCaptor.getValue().getGrade()).isEqualTo(Grade.TEAM_LEAD.getCode());

		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(assignmentCaptor.capture());
		HubRoleAssignment created = assignmentCaptor.getValue();
		assertThat(created.getUserId()).isEqualTo(USER_ID);
		assertThat(created.getRole().getId()).isEqualTo(TL_ROLE_ID);
		assertThat(created.getScopeType().getId()).isEqualTo(TEAM_SCOPE_ID);
		assertThat(created.getScopeId()).isEqualTo(TEAM_ID);
		assertThat(created.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());

		// R6: the redundant end-of-sync HubTeam publish is gone - HubTeamService already publishes per write.
		verify(cacheInvalidationEventService, never()).publishUpdateEvent(HubTeam.class);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubUser.class);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubRoleAssignment.class);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubTeamAgency.class);
	}

	@Test
	void shouldAssignMemberRoleToAResolvedTeamTest() {
		// Given: the team already exists (returned by the bulk team preload)
		stubDictionaries();
		when(teamAgencyService.findAll()).thenReturn(List.of());
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedMember(EMAIL, MEMBER_NAME, "lead@example.com", "HOUSE")),
				List.of(resolvedTeam("lead@example.com", LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 1, 0));
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(assignmentCaptor.capture());
		assertThat(assignmentCaptor.getValue().getRole().getId()).isEqualTo(MEMBER_ROLE_ID);
		assertThat(assignmentCaptor.getValue().getScopeId()).isEqualTo(TEAM_ID);
	}

	@Test
	void shouldAssignDirectorRoleWithAllScopeAndNullScopeIdTest() {
		// Given: R1 - directors see ALL data (product decision), so DIRECTOR is granted with ALL scope and
		// a null scope_id (mirroring every other unscoped assignment, e.g. ADMIN/ALL) - not TEAM/OWN
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(List.of(resolvedDirector(EMAIL, LEAD_NAME)), List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 1, 0));
		verify(teamService, never()).create(any());
		verify(teamService, never()).saveFromNetSuite(any());

		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(assignmentCaptor.capture());
		HubRoleAssignment created = assignmentCaptor.getValue();
		assertThat(created.getRole().getId()).isEqualTo(DIRECTOR_ROLE_ID);
		assertThat(created.getScopeType().getId()).isEqualTo(ALL_SCOPE_ID);
		assertThat(created.getScopeId()).isNull();
	}

	@Test
	void shouldBeIdempotentForDirectorWithNullScopeIdAlreadyCorrectTest() {
		// Given: R1 - a director's ALL/null-scope_id assignment is already exactly correct; the null-safe
		// lookup must find and reactivate it rather than NPE or insert a duplicate
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(List.of(resolvedDirector(EMAIL, LEAD_NAME)), List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment existing = assignment(role(DIRECTOR_ROLE_ID), scopeType(ALL_SCOPE_ID), null);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(existing));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification: nothing changed, and no duplicate row was ever attempted
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 0, 0));
		verify(assignmentService, never()).save(any());
	}

	@Test
	void shouldRevokeStaleTeamAssignmentAndCreateAllScopeWhenUserBecomesDirectorTest() {
		// Given: R1 - a user previously held a TEAM-scoped assignment and is now resolved as a Director;
		// the stale TEAM assignment must be revoked and replaced with DIRECTOR/ALL (null scope_id)
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(List.of(resolvedDirector(EMAIL, LEAD_NAME)), List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment stale = assignment(role(MEMBER_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(stale));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 1, 0));
		assertThat(stale.getStatus()).isEqualTo(HubStatus.REVOKED.getCode());
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService, times(2)).save(assignmentCaptor.capture());
		HubRoleAssignment created = assignmentCaptor.getAllValues().get(1);
		assertThat(created.getRole().getId()).isEqualTo(DIRECTOR_ROLE_ID);
		assertThat(created.getScopeId()).isNull();
		assertThat(created.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
	}

	@Test
	void shouldRevokeActiveAssignmentForMemberWithUnresolvedTeamTest() {
		// Given: R5 - the resolver flagged this member's team as unresolved (teamLeadEmail == null); a
		// pre-existing active assignment (pointing at what may now be a deactivated legacy team) must be
		// revoked rather than left dangling, and no new assignment may be guessed
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(new ResolvedEmployee(EMAIL, MEMBER_NAME, OrgRole.MEMBER, Grade.MIDDLE, null, null, List.of())),
				List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment danglingAssignment = assignment(role(MEMBER_ROLE_ID), scopeType(TEAM_SCOPE_ID), 999L);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(danglingAssignment));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 1, 0));
		assertThat(danglingAssignment.getStatus()).isEqualTo(HubStatus.REVOKED.getCode());
		ArgumentCaptor<HubRoleAssignment> savedCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(savedCaptor.capture());
		assertThat(savedCaptor.getValue()).isSameAs(danglingAssignment);
	}

	@Test
	void shouldChangeNothingForUnresolvedMemberWithNoExistingAssignmentTest() {
		// Given: R5 - an unresolved member with no pre-existing assignment stays with none; the revoke path
		// must be a no-op rather than fabricating one
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(new ResolvedEmployee(EMAIL, MEMBER_NAME, OrgRole.MEMBER, Grade.MIDDLE, null, null, List.of())),
				List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 0, 0));
		verify(assignmentService, never()).save(any());
	}

	@Test
	void shouldBeIdempotentWhenAssignmentAlreadyCorrectTest() {
		// Given:
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedMember(EMAIL, MEMBER_NAME, "lead@example.com", "HOUSE")),
				List.of(resolvedTeam("lead@example.com", LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(MEMBER_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 0, 0));
		verify(teamService, never()).create(any());
		verify(teamService, never()).saveFromNetSuite(any());
		verify(assignmentService, never()).save(any());
	}

	@Test
	void shouldRevokeStaleAssignmentAndCreateNewWhenRoleChangesTest() {
		// Given:
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment stale = assignment(role(MEMBER_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(stale));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 1, 0));
		assertThat(stale.getStatus()).isEqualTo(HubStatus.REVOKED.getCode());
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService, times(2)).save(assignmentCaptor.capture());
		HubRoleAssignment created = assignmentCaptor.getAllValues().get(1);
		assertThat(created.getRole().getId()).isEqualTo(TL_ROLE_ID);
		assertThat(created.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
	}

	@Test
	void shouldPreserveActiveAdminAssignmentDuringSyncTest() {
		// Given: BackOffice granted ADMIN manually. NetSuite sync still sees the employee as a regular
		// team member, but must not revoke ADMIN or replace it with MPO_MANAGER.
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedMember(EMAIL, MEMBER_NAME, "lead@example.com", "HOUSE")),
				List.of(resolvedTeam("lead@example.com", LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment admin = assignment(
				role(ADMIN_ROLE_ID, RbacRoleCode.ADMIN.getCode()), scopeType(ALL_SCOPE_ID), null);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(admin));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification: the user metadata can still refresh, but role assignments stay untouched.
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 0, 0));
		assertThat(admin.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		verify(assignmentService, never()).save(any());
	}

	@Test
	void shouldPreserveActiveAdminAssignmentForUnresolvedMemberTest() {
		// Given: unresolved members normally have active assignments revoked, but ADMIN is manually
		// managed and must survive the sync.
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(new ResolvedEmployee(EMAIL, MEMBER_NAME, OrgRole.MEMBER, Grade.MIDDLE, null, null, List.of())),
				List.of());
		when(teamService.listAllOrderedByName()).thenReturn(List.of());
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment admin = assignment(
				role(ADMIN_ROLE_ID, RbacRoleCode.ADMIN.getCode()), scopeType(ALL_SCOPE_ID), null);
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(admin));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 1, 0, 0));
		assertThat(admin.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		verify(assignmentService, never()).save(any());
	}

	@Test
	void shouldReactivatePreviouslyRevokedAssignmentTest() {
		// Given: the desired TL assignment exists but was manually revoked, so it is not active
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		HubRoleAssignment revoked = assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID);
		revoked.setStatus(HubStatus.REVOKED.getCode());
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of(revoked));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification: the existing row is reactivated in place - no new row inserted
		assertThat(summary).isEqualTo(new SyncSummary(1, 1, 1, 0));
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(assignmentCaptor.capture());
		assertThat(assignmentCaptor.getValue()).isSameAs(revoked);
		assertThat(assignmentCaptor.getValue().getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
	}

	@Test
	void shouldDeactivateStaleNetSuiteTeamNoLongerDesiredTest() {
		// Given: a legacy department-wide team (e.g. the old single "Media Optimization" team) is no
		// longer backed by any resolved Team Lead this run
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(List.of(), List.of());
		HubTeam legacyTeam = team(20L);
		legacyTeam.setTeamName("Media Optimization");
		legacyTeam.setFromNetSuite(true);
		legacyTeam.setStatus(HubStatus.ACTIVE.getCode());
		when(teamService.listAllOrderedByName()).thenReturn(List.of(legacyTeam));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(summary).isEqualTo(new SyncSummary(0, 0, 0, 0));
		assertThat(legacyTeam.getStatus()).isEqualTo(HubStatus.INACTIVE.getCode());
		verify(teamService).saveFromNetSuite(legacyTeam);
	}

	@Test
	void shouldNeverDeactivateAnAdminCreatedTeamTest() {
		// Given: an admin-created team not in the desired set must never be touched, even though it is
		// no longer among the resolved teams
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(List.of(), List.of());
		HubTeam adminTeam = team(30L);
		adminTeam.setTeamName("Special Ops");
		adminTeam.setFromNetSuite(false);
		adminTeam.setStatus(HubStatus.ACTIVE.getCode());
		when(teamService.listAllOrderedByName()).thenReturn(List.of(adminTeam));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		reconciler().reconcile(resolution, List.of());

		// Verification:
		assertThat(adminTeam.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		verify(teamService, never()).saveFromNetSuite(any());
	}

	@Test
	void shouldSkipTeamUpsertWhenNameCollidesWithAnAdminCreatedTeamTest() {
		// Given: the computed team_name happens to already exist as an admin-created (non-NetSuite) team;
		// the sync must not repurpose it - it uses the admin team's id for role assignment instead
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		HubTeam adminTeam = team(40L);
		adminTeam.setTeamName(TEAM_NAME);
		adminTeam.setFromNetSuite(false);
		when(teamService.listAllOrderedByName()).thenReturn(List.of(adminTeam));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any())).thenReturn(List.of());

		// When:
		reconciler().reconcile(resolution, List.of());

		// Verification:
		verify(teamService, never()).create(any());
		verify(teamService, never()).saveFromNetSuite(any());
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		verify(assignmentService).save(assignmentCaptor.capture());
		assertThat(assignmentCaptor.getValue().getScopeId()).isEqualTo(40L);
	}

	@Test
	void shouldMapAgencyToItsLeadTeamTest() {
		// Given: the agency's MPO team lead is a synced Team Lead on team TEAM_ID
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll()).thenReturn(List.of());

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, LEAD_NAME)));

		// Verification:
		assertThat(summary.agenciesMapped()).isEqualTo(1);
		ArgumentCaptor<HubTeamAgency> mappingCaptor = ArgumentCaptor.forClass(HubTeamAgency.class);
		verify(teamAgencyService).save(mappingCaptor.capture());
		assertThat(mappingCaptor.getValue().getAgencyId()).isEqualTo(AGENCY_ID);
		assertThat(mappingCaptor.getValue().getTeamId()).isEqualTo(TEAM_ID);
		verify(teamAgencyService, never()).deleteAll(any());
	}

	@Test
	void shouldMapAgencyViaDerivedEmailFallbackWhenNameDoesNotMatchTest() {
		// Given: the Team Lead's synced display name ("Saveliy Maslakov") no longer matches the local part
		// of their email ("sam.marley"), e.g. an inherited mailbox; IO Lines still records the original name
		stubDictionaries();
		String tlEmail = "sam.marley@example.com";
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(tlEmail, "Saveliy Maslakov", "HOUSE")),
				List.of(resolvedTeam(tlEmail, "Saveliy Maslakov", TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll()).thenReturn(List.of());

		// When: the agency's BQ mpo_team_lead is "Sam Marley" - no exact match against "Saveliy Maslakov"
		SyncSummary summary =
				reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, "Sam Marley")));

		// Verification: resolved via the derived-email fallback (Sam Marley -> sam.marley -> sam.marley@example.com)
		assertThat(summary.agenciesMapped()).isEqualTo(1);
		ArgumentCaptor<HubTeamAgency> mappingCaptor = ArgumentCaptor.forClass(HubTeamAgency.class);
		verify(teamAgencyService).save(mappingCaptor.capture());
		assertThat(mappingCaptor.getValue().getAgencyId()).isEqualTo(AGENCY_ID);
		assertThat(mappingCaptor.getValue().getTeamId()).isEqualTo(TEAM_ID);
	}

	@Test
	void shouldMapAgencyViaFirstNameEmailFallbackWhenAliasDoesNotMatchDisplayNameTest() {
		// Given: the Team Lead's synced display name is Galina, but IO Lines still carries a legacy public
		// alias that matches only the mailbox local part ("Abigail Kuras" -> abigail@...)
		stubDictionaries();
		String tlEmail = "abigail@aidigital.com";
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(tlEmail, "Galina Kurasheva", "HOUSE")),
				List.of(resolvedTeam(tlEmail, "Galina Kurasheva", TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of());
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll()).thenReturn(List.of());

		// When:
		SyncSummary summary =
				reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, "Abigail Kuras")));

		// Verification: resolved via the first-name email fallback (Abigail Kuras -> abigail)
		assertThat(summary.agenciesMapped()).isEqualTo(1);
		ArgumentCaptor<HubTeamAgency> mappingCaptor = ArgumentCaptor.forClass(HubTeamAgency.class);
		verify(teamAgencyService).save(mappingCaptor.capture());
		assertThat(mappingCaptor.getValue().getAgencyId()).isEqualTo(AGENCY_ID);
		assertThat(mappingCaptor.getValue().getTeamId()).isEqualTo(TEAM_ID);
	}

	@Test
	void shouldLeaveAgencyUnmappedWhenNoNameOrEmailFallbackMatchesTest() {
		// Given: the BQ lead name matches neither a synced Team Lead's name nor either email local-part
		// fallback
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll()).thenReturn(List.of());

		// When:
		SyncSummary summary =
				reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, "Someone Else")));

		// Verification:
		assertThat(summary.agenciesMapped()).isEqualTo(0);
		verify(teamAgencyService, never()).save(any());
	}

	@Test
	void shouldMatchAgencyLeadWithDoubleSpaceToTeamLeadNameTest() {
		// Given: R4 - the IO Lines mpo_team_lead carries a double space; the shared NameNormalizer (used by
		// both the resolver and this agency-lead match) must still resolve it to the Team Lead's team
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, "Daria Feofanova", "HOUSE")),
				List.of(resolvedTeam(EMAIL, "Daria Feofanova", TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll()).thenReturn(List.of());

		// When: the agency's mpo_team_lead has an irregular double space
		SyncSummary summary =
				reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, "Daria  Feofanova")));

		// Verification:
		assertThat(summary.agenciesMapped()).isEqualTo(1);
		ArgumentCaptor<HubTeamAgency> mappingCaptor = ArgumentCaptor.forClass(HubTeamAgency.class);
		verify(teamAgencyService).save(mappingCaptor.capture());
		assertThat(mappingCaptor.getValue().getTeamId()).isEqualTo(TEAM_ID);
	}

	@Test
	void shouldRemoveStaleAndRetargetAgencyMappingsTest() {
		// Given: agency AGENCY_ID is mapped to the wrong team, and agency 999 is no longer backed by a lead
		stubDictionaries();
		OrgResolution resolution = new OrgResolution(
				List.of(resolvedTeamLead(EMAIL, LEAD_NAME, "HOUSE")),
				List.of(resolvedTeam(EMAIL, LEAD_NAME, TEAM_NAME, "HOUSE")));
		when(teamService.listAllOrderedByName()).thenReturn(List.of(team(TEAM_ID)));
		when(userService.findAllByEmailIgnoreCaseIn(any())).thenReturn(List.of(user(USER_ID)));
		when(userService.save(any())).thenReturn(user(USER_ID));
		when(assignmentService.findAllByUserIds(any()))
				.thenReturn(List.of(assignment(role(TL_ROLE_ID), scopeType(TEAM_SCOPE_ID), TEAM_ID)));
		when(teamAgencyService.findAll())
				.thenReturn(List.of(teamAgency(AGENCY_ID, 99L), teamAgency(999L, 7L)));

		// When:
		SyncSummary summary = reconciler().reconcile(resolution, List.of(new AgencyLead(AGENCY_ID, LEAD_NAME)));

		// Verification:
		assertThat(summary.agenciesMapped()).isEqualTo(1);

		@SuppressWarnings("unchecked")
		ArgumentCaptor<Collection<HubTeamAgency>> deleteCaptor = ArgumentCaptor.forClass(Collection.class);
		verify(teamAgencyService).deleteAll(deleteCaptor.capture());
		assertThat(deleteCaptor.getValue()).extracting(HubTeamAgency::getAgencyId).containsExactly(999L);

		ArgumentCaptor<HubTeamAgency> saveCaptor = ArgumentCaptor.forClass(HubTeamAgency.class);
		verify(teamAgencyService).save(saveCaptor.capture());
		assertThat(saveCaptor.getValue().getAgencyId()).isEqualTo(AGENCY_ID);
		assertThat(saveCaptor.getValue().getTeamId()).isEqualTo(TEAM_ID);
	}

	/**
	 * Builds the reconciler under test, wired with this test's mocks and a real {@link NameNormalizer}
	 * (constructed fresh per test rather than shared, per {@code .claude/rules/20-tests.md}).
	 */
	private NetSuiteSyncReconciler reconciler() {
		return new NetSuiteSyncReconciler(teamService, userService, roleService, scopeTypeService, assignmentService,
				teamAgencyService, cacheInvalidationEventService, new NameNormalizer());
	}

	private void stubDictionaries() {
		when(roleService.existingByRoleCode(RbacRoleCode.TL.getCode()))
				.thenReturn(role(TL_ROLE_ID, RbacRoleCode.TL.getCode()));
		when(roleService.existingByRoleCode(RbacRoleCode.MPO_MANAGER.getCode()))
				.thenReturn(role(MEMBER_ROLE_ID, RbacRoleCode.MPO_MANAGER.getCode()));
		when(roleService.existingByRoleCode(RbacRoleCode.DIRECTOR.getCode()))
				.thenReturn(role(DIRECTOR_ROLE_ID, RbacRoleCode.DIRECTOR.getCode()));
		when(scopeTypeService.existingByScopeCode(RbacScopeCode.TEAM.getCode())).thenReturn(scopeType(TEAM_SCOPE_ID));
		when(scopeTypeService.existingByScopeCode(RbacScopeCode.ALL.getCode())).thenReturn(scopeType(ALL_SCOPE_ID));
	}

	private static ResolvedEmployee resolvedTeamLead(String email, String name, String podKey) {
		return new ResolvedEmployee(email, name, OrgRole.TEAM_LEAD, Grade.TEAM_LEAD, email, podKey, List.of());
	}

	private static ResolvedEmployee resolvedMember(String email, String name, String teamLeadEmail, String podKey) {
		return new ResolvedEmployee(email, name, OrgRole.MEMBER, Grade.MIDDLE, teamLeadEmail, podKey, List.of());
	}

	private static ResolvedEmployee resolvedDirector(String email, String name) {
		return new ResolvedEmployee(email, name, OrgRole.DIRECTOR, Grade.DIRECTOR, null, null, List.of());
	}

	private static ResolvedTeam resolvedTeam(
			String teamLeadEmail, String teamLeadName, String teamName, String podKey) {
		return new ResolvedTeam(teamLeadEmail, teamLeadName, teamName, podKey, List.of());
	}

	private static HubRole role(Long id) {
		return role(id, "ROLE_" + id);
	}

	private static HubRole role(Long id, String roleCode) {
		return Instancio.of(HubRole.class)
				.set(field(HubRole::getId), id)
				.set(field(HubRole::getRoleCode), roleCode)
				.create();
	}

	private static HubScopeType scopeType(Long id) {
		return Instancio.of(HubScopeType.class).set(field(HubScopeType::getId), id).create();
	}

	private static HubTeam team(Long id) {
		// fromNetSuite pinned to false (like every other unset field this fixture's callers don't care
		// about) because upsertTeam() branches on it: a random true from Instancio would flip several
		// existing-team tests onto the refresh path instead of the plain lookup they intend to exercise.
		return Instancio.of(HubTeam.class)
				.set(field(HubTeam::getId), id)
				.set(field(HubTeam::getTeamName), TEAM_NAME)
				.set(field(HubTeam::isFromNetSuite), false)
				.create();
	}

	private static HubUser user(Long id) {
		return Instancio.of(HubUser.class)
				.set(field(HubUser::getId), id)
				.set(field(HubUser::getEmail), EMAIL)
				.create();
	}

	private static HubRoleAssignment assignment(HubRole role, HubScopeType scopeType, Long scopeId) {
		return Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getUserId), USER_ID)
				.set(field(HubRoleAssignment::getRole), role)
				.set(field(HubRoleAssignment::getScopeType), scopeType)
				.set(field(HubRoleAssignment::getScopeId), scopeId)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
	}

	private static HubTeamAgency teamAgency(Long agencyId, Long teamId) {
		return Instancio.of(HubTeamAgency.class)
				.set(field(HubTeamAgency::getAgencyId), agencyId)
				.set(field(HubTeamAgency::getTeamId), teamId)
				.create();
	}
}
