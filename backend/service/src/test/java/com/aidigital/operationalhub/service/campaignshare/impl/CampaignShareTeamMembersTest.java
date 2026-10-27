package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignShareTeamMembers}: the people on teams that own agencies,
 * Client Services left out.
 */
@ExtendWith(MockitoExtension.class)
class CampaignShareTeamMembersTest {

	@Mock
	private HubTeamAgencyService hubTeamAgencyService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@InjectMocks
	private CampaignShareTeamMembers teamMembers;

	@Test
	void shouldReadThePeopleOnTeamsThatOwnAgenciesButNotClientServicesTest() {
		// Given: team 7 owns two agencies; a manager, a role-less row and a Client Services person on it
		when(hubTeamAgencyService.findAll()).thenReturn(List.of(mapping(7L, 100L), mapping(7L, 101L)));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", Set.of(7L))).thenReturn(List.of(
				assignment(1L, "MPO_MANAGER"),
				assignment(2L, null),
				assignment(3L, "CLIENT_SERVICES")));

		// When:
		Set<Long> result = teamMembers.userIds();

		// Then:
		assertThat(result).containsExactlyInAnyOrder(1L, 2L);
	}

	@Test
	void shouldAskForNoAssignmentsWhenNoTeamOwnsAnAgencyTest() {
		// Given:
		when(hubTeamAgencyService.findAll()).thenReturn(List.of());

		// When:
		Set<Long> result = teamMembers.userIds();

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(hubRoleAssignmentService);
	}

	private static HubTeamAgency mapping(Long teamId, Long agencyId) {
		HubTeamAgency mapping = new HubTeamAgency();
		mapping.setTeamId(teamId);
		mapping.setAgencyId(agencyId);
		return mapping;
	}

	private static HubRoleAssignment assignment(Long userId, String roleCode) {
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		if (roleCode != null) {
			HubRole role = new HubRole();
			role.setRoleCode(roleCode);
			assignment.setRole(role);
		}
		return assignment;
	}
}
