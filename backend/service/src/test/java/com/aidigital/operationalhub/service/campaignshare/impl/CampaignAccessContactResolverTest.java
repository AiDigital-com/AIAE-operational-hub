package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.agency.model.CampaignTeamLeadsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignAccessContactsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.entity.HubAgencyOwnerOverrideService;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.netsuite.org.NameNormalizer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignAccessContactResolver}: NetSuite's lead on a campaign
 * resolved to the Hub team that runs it and its people, every owning lead when it does not resolve.
 */
@ExtendWith(MockitoExtension.class)
class CampaignAccessContactResolverTest {

	private static final long AGENCY = 51076L;
	private static final String NAME = "Alexandra Williams for OUSD 6";
	private static final long SAVELIY_TEAM = 24L;
	private static final long VALENTINA_TEAM = 11L;
	private static final long SAVELIY = 380L;
	private static final long VALENTINA = 390L;
	private static final long ANNA = 167L;
	private static final long BORIS = 168L;
	private static final long CLARA = 169L;
	private static final String MPO = "Media & Performance Optimization > Media Optimization";

	@Mock
	private HubTeamAgencyService hubTeamAgencyService;

	@Mock
	private HubTeamService hubTeamService;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@Mock
	private HubAgencyOwnerOverrideService agencyOwnerOverrideService;

	@Mock
	private CampaignSharePersonDescriber personDescriber;

	private CampaignAccessContactResolver resolver;

	@BeforeEach
	void setUp() {
		resolver = new CampaignAccessContactResolver(hubTeamAgencyService, hubTeamService, hubUserService,
				hubRoleAssignmentService, agencyOwnerOverrideService, personDescriber, new NameNormalizer());
		lenient().when(personDescriber.describer(anyCollection()))
				.thenReturn(id -> new CampaignSharePersonRoleModel("Role " + id, "Team"));
		lenient().when(agencyOwnerOverrideService.findAllByStatus(HubStatus.ACTIVE.getCode())).thenReturn(List.of());
	}

	@Test
	void shouldNameTheRunningTeamLeadFirstThenWhoeverHasLoggedInTest() {
		// Given: two teams own the agency; NetSuite says "Sam Marley", the Hub calls him Saveliy Maslakov.
		// His team: Boris (never logged in), Clara (logged in), Anna (logged in), a Client Services person
		givenTwoOwningTeams();
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", Set.of(SAVELIY_TEAM)))
				.thenReturn(List.of(assignment(SAVELIY, "TL"), assignment(BORIS, "MPO_MANAGER"),
						assignment(CLARA, "MPO_MANAGER"), assignment(ANNA, "MPO_MANAGER"),
						assignment(99L, "CLIENT_SERVICES")));
		when(hubUserService.findAllByIds(Set.of(SAVELIY, BORIS, CLARA, ANNA))).thenReturn(List.of(
				person(BORIS, "Boris", HubStatus.INACTIVE, MPO),
				person(CLARA, "Clara", HubStatus.ACTIVE, MPO),
				person(ANNA, "Anna", HubStatus.ACTIVE, MPO),
				lead(SAVELIY, "Saveliy Maslakov", "sam.marley@aidigital.com")));

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("Sam Marley"));

		// Then: the lead, then the logged-in by name, then the rest; Valentina's team is not named
		assertThat(result.runningTeamFound()).isTrue();
		assertThat(result.campaignName()).isEqualTo(NAME);
		assertThat(result.netSuiteTeamLeads()).containsExactly("Sam Marley");
		assertThat(result.contacts()).extracting(CampaignShareCandidateModel::fullName)
				.containsExactly("Saveliy Maslakov", "Anna", "Clara", "Boris");
		assertThat(result.contacts().getFirst().email()).isEqualTo("sam.marley@aidigital.com");
	}

	@Test
	void shouldLeaveOutTeamPeopleWhoLeftTest() {
		// Given:
		givenTwoOwningTeams();
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", Set.of(SAVELIY_TEAM)))
				.thenReturn(List.of(assignment(ANNA, "MPO_MANAGER")));
		when(hubUserService.findAllByIds(Set.of(SAVELIY, ANNA))).thenReturn(List.of(
				lead(SAVELIY, "Saveliy Maslakov", "sam.marley@aidigital.com"),
				person(ANNA, "Anna", HubStatus.ACTIVE, null)));

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("Sam Marley"));

		// Then:
		assertThat(result.contacts()).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(SAVELIY);
	}

	@Test
	void shouldNameEveryOwningLeadWhenNetSuitesLeadMatchesNoneTest() {
		// Given: NetSuite names somebody who leads none of the owning teams
		givenTwoOwningTeams();

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("Nino Jincharadze"));

		// Then: the leads only - not a whole agency's worth of people
		assertThat(result.runningTeamFound()).isFalse();
		assertThat(result.contacts()).extracting(CampaignShareCandidateModel::fullName)
				.containsExactly("Saveliy Maslakov", "Valentina Mikhailova");
		verifyNoInteractions(hubRoleAssignmentService);
	}

	@Test
	void shouldFollowAnOwnerOverrideToTheTeamItPointsAtTest() {
		// Given: an override says agencies NetSuite gives "Old Owner" belong to Valentina's team
		givenTwoOwningTeams();
		HubAgencyOwnerOverride override = new HubAgencyOwnerOverride();
		override.setOwnerUserId(77L);
		override.setTeamLeadUserId(VALENTINA);
		when(agencyOwnerOverrideService.findAllByStatus(HubStatus.ACTIVE.getCode())).thenReturn(List.of(override));
		when(hubUserService.findAllByIds(Set.of(77L)))
				.thenReturn(List.of(person(77L, "Old Owner", HubStatus.ACTIVE, MPO)));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", Set.of(VALENTINA_TEAM)))
				.thenReturn(List.of());
		when(hubUserService.findAllByIds(Set.of(VALENTINA)))
				.thenReturn(List.of(lead(VALENTINA, "Valentina Mikhailova", "valentina.mikhailova@aidigital.com")));

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("old  OWNER"));

		// Then:
		assertThat(result.runningTeamFound()).isTrue();
		assertThat(result.contacts()).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(VALENTINA);
	}

	@Test
	void shouldNameNobodyWhenTheOnlyOwningTeamIsInactiveTest() {
		// Given:
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY)).thenReturn(List.of(SAVELIY_TEAM));
		when(hubTeamService.listAllOrderedByName()).thenReturn(List.of(team(SAVELIY_TEAM, SAVELIY, HubStatus.INACTIVE)));

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("Sam Marley"));

		// Then: the NetSuite name is still told, with nobody in the Hub to ask
		assertThat(result.contacts()).isEmpty();
		assertThat(result.runningTeamFound()).isFalse();
		assertThat(result.netSuiteTeamLeads()).containsExactly("Sam Marley");
		verifyNoInteractions(hubUserService);
	}

	@Test
	void shouldNameNobodyWhenNoTeamOwnsTheAgencyTest() {
		// Given:
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY)).thenReturn(List.of());

		// When:
		CampaignAccessContactsModel result = resolver.resolve(campaign("Sam Marley"));

		// Then:
		assertThat(result.contacts()).isEmpty();
		verifyNoInteractions(hubTeamService, hubUserService);
	}

	@Test
	void shouldNameNobodyForACampaignWithNoAgencyTest() {
		// When:
		CampaignAccessContactsModel result =
				resolver.resolve(new CampaignTeamLeadsModel(54741L, NAME, null, List.of("Sam Marley")));

		// Then:
		assertThat(result.contacts()).isEmpty();
		verifyNoInteractions(hubTeamAgencyService);
	}

	private void givenTwoOwningTeams() {
		givenOwningTeams(team(SAVELIY_TEAM, SAVELIY, HubStatus.ACTIVE), team(VALENTINA_TEAM, VALENTINA, HubStatus.ACTIVE));
		when(hubUserService.findAllByIds(Set.of(SAVELIY, VALENTINA))).thenReturn(List.of(
				lead(SAVELIY, "Saveliy Maslakov", "sam.marley@aidigital.com"),
				lead(VALENTINA, "Valentina Mikhailova", "valentina.mikhailova@aidigital.com")));
	}

	private void givenOwningTeams(HubTeam... teams) {
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY))
				.thenReturn(Arrays.stream(teams).map(HubTeam::getId).toList());
		when(hubTeamService.listAllOrderedByName()).thenReturn(List.of(teams));
	}

	private static CampaignTeamLeadsModel campaign(String netSuiteLead) {
		return new CampaignTeamLeadsModel(54741L, NAME, AGENCY, List.of(netSuiteLead));
	}

	private static HubTeam team(long id, long leadId, HubStatus status) {
		HubTeam team = new HubTeam();
		team.setId(id);
		team.setTeamName("Team " + id);
		team.setStatus(status.getCode());
		team.setTeamLeadUserId(leadId);
		return team;
	}

	private static HubUser lead(long id, String name, String email) {
		HubUser user = person(id, name, HubStatus.ACTIVE, MPO);
		user.setEmail(email);
		return user;
	}

	private static HubUser person(long id, String name, HubStatus status, String department) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setDisplayName(name);
		user.setEmail(name.toLowerCase().replace(' ', '.') + "@aidigital.com");
		user.setStatus(status.getCode());
		user.setDepartment(department);
		return user;
	}

	private static HubRoleAssignment assignment(long userId, String roleCode) {
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		HubRole role = new HubRole();
		role.setRoleCode(roleCode);
		assignment.setRole(role);
		return assignment;
	}
}
