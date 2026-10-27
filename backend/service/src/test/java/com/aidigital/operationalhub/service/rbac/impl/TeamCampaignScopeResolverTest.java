package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.service.agency.AgencyCampaignIdService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.PacingCampaignIndexService;
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
 * Pure Mockito unit tests for {@link TeamCampaignScopeResolver}: the intersection, and that nothing is
 * read past the first empty step.
 */
@ExtendWith(MockitoExtension.class)
class TeamCampaignScopeResolverTest {

	private static final Long TEAM_ID = 130L;

	@Mock
	private HubTeamAgencyService hubTeamAgencyService;

	@Mock
	private AgencyCampaignIdService agencyCampaignIdService;

	@Mock
	private PacingCampaignIndexService pacingCampaignIndexService;

	@InjectMocks
	private TeamCampaignScopeResolver resolver;

	@Test
	void shouldKeepOnlyTheAgenciesCampaignsThatCarryAPacingTest() {
		// Given: three campaigns under the team's agencies, two of them with a pacing somewhere
		when(hubTeamAgencyService.findAgencyIdsByTeamIdIn(List.of(TEAM_ID))).thenReturn(List.of(500L));
		when(agencyCampaignIdService.findCampaignIdsByAgencyIds(List.of(500L))).thenReturn(List.of(100L, 200L, 300L));
		when(pacingCampaignIndexService.campaignIdsWithPacings()).thenReturn(Set.of("100", "300", "999"));

		// When:
		List<String> result = resolver.resolve(List.of(TEAM_ID));

		// Then: as text, in the agencies' order, without the campaign nobody paces
		assertThat(result).containsExactly("100", "300");
	}

	@Test
	void shouldNotAskBigQueryOrPacingWhenTheTeamsOwnNoAgencyTest() {
		// Given:
		when(hubTeamAgencyService.findAgencyIdsByTeamIdIn(List.of(TEAM_ID))).thenReturn(List.of());

		// When:
		List<String> result = resolver.resolve(List.of(TEAM_ID));

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(agencyCampaignIdService, pacingCampaignIndexService);
	}

	@Test
	void shouldNotAskPacingWhenTheAgenciesHaveNoCampaignTest() {
		// Given:
		when(hubTeamAgencyService.findAgencyIdsByTeamIdIn(List.of(TEAM_ID))).thenReturn(List.of(500L));
		when(agencyCampaignIdService.findCampaignIdsByAgencyIds(List.of(500L))).thenReturn(List.of());

		// When:
		List<String> result = resolver.resolve(List.of(TEAM_ID));

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(pacingCampaignIndexService);
	}

	@Test
	void shouldDegradeToNoTeamCampaignsWhenAReadFailsTest() {
		// Given: BigQuery is unhappy - the pacing call this sits in front of must still go through
		when(hubTeamAgencyService.findAgencyIdsByTeamIdIn(List.of(TEAM_ID))).thenReturn(List.of(500L));
		when(agencyCampaignIdService.findCampaignIdsByAgencyIds(List.of(500L)))
				.thenThrow(new IllegalStateException("BigQuery read failed"));

		// When:
		List<String> result = resolver.resolve(List.of(TEAM_ID));

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(pacingCampaignIndexService);
	}

	@Test
	void shouldAnswerEmptyForNoTeamsWithoutAnyReadTest() {
		// When:
		List<String> result = resolver.resolve(List.of());

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(hubTeamAgencyService, agencyCampaignIdService, pacingCampaignIndexService);
	}
}
