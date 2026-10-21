package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignSharePersonDescriber}: a person reads as their role and,
 * for a team-scoped role, their team - and as nothing when they hold no role.
 */
@ExtendWith(MockitoExtension.class)
class CampaignSharePersonDescriberTest {

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@Mock
	private HubTeamService hubTeamService;

	@InjectMocks
	private CampaignSharePersonDescriber describer;

	@Test
	void shouldDescribeTeamScopedAndGlobalRolesAndTheRolelessTest() {
		// Given: one MPO manager on team 7, one Director with an ALL scope, one person with no role
		when(hubRoleAssignmentService.findActiveByUserIds(List.of(1L, 2L, 3L))).thenReturn(List.of(
				assignment(1L, "MPO Manager", "TEAM", 7L),
				assignment(2L, "Director", "ALL", null)));
		HubTeam team = new HubTeam();
		team.setId(7L);
		team.setTeamName("Team Vlad");
		when(hubTeamService.listAllOrderedByName()).thenReturn(List.of(team));

		// When:
		Map<Long, CampaignSharePersonRoleModel> described = describer.describe(List.of(1L, 2L, 3L));

		// Then:
		assertThat(described.get(1L)).isEqualTo(new CampaignSharePersonRoleModel("MPO Manager", "Team Vlad"));
		assertThat(described.get(2L)).isEqualTo(new CampaignSharePersonRoleModel("Director", null));
		assertThat(described.get(3L)).isEqualTo(CampaignSharePersonRoleModel.none());
	}

	@Test
	void shouldAskNothingForAnEmptyListTest() {
		// When:
		Map<Long, CampaignSharePersonRoleModel> described = describer.describe(List.of());

		// Then:
		assertThat(described).isEmpty();
		verifyNoInteractions(hubRoleAssignmentService, hubTeamService);
	}

	private static HubRoleAssignment assignment(Long userId, String roleName, String scopeCode, Long scopeId) {
		HubRole role = new HubRole();
		role.setDisplayName(roleName);
		HubScopeType scopeType = new HubScopeType();
		scopeType.setScopeCode(scopeCode);
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		assignment.setRole(role);
		assignment.setScopeType(scopeType);
		assignment.setScopeId(scopeId);
		return assignment;
	}
}
