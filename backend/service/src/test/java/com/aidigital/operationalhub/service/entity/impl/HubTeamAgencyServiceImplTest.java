package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.domain.repository.HubTeamAgencyRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubTeamAgencyServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubTeamAgencyServiceImplTest {

	private static final Long TEAM_ID = 10L;

	@Mock
	private HubTeamAgencyRepository teamAgencyRepository;

	@InjectMocks
	private HubTeamAgencyServiceImpl service;

	@Test
	void shouldReturnAllMappingsTest() {
		// Given:
		HubTeamAgency one = mapping(1L, TEAM_ID);
		when(teamAgencyRepository.findAll()).thenReturn(List.of(one));

		// When:
		List<HubTeamAgency> result = service.findAll();

		// Then:
		assertThat(result).containsExactly(one);
	}

	@Test
	void shouldReturnAgencyIdsForTeamsTest() {
		// Given:
		List<Long> teamIds = List.of(TEAM_ID, 20L);
		when(teamAgencyRepository.findByTeamIdIn(teamIds))
				.thenReturn(List.of(mapping(100L, TEAM_ID), mapping(200L, TEAM_ID), mapping(100L, 20L)));

		// When:
		List<Long> result = service.findAgencyIdsByTeamIdIn(teamIds);

		// Then: distinct agency ids across both teams
		assertThat(result).containsExactlyInAnyOrder(100L, 200L);
	}

	@Test
	void shouldReturnEmptyWithoutQueryingWhenTeamIdsIsEmptyTest() {
		// When:
		List<Long> result = service.findAgencyIdsByTeamIdIn(List.of());

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldSaveMappingTest() {
		// Given:
		HubTeamAgency input = mapping(100L, TEAM_ID);
		when(teamAgencyRepository.save(input)).thenReturn(input);

		// When:
		HubTeamAgency result = service.save(input);

		// Then:
		assertThat(result).isEqualTo(input);
		verify(teamAgencyRepository).save(input);
	}

	@Test
	void shouldDeleteAllMappingsTest() {
		// Given:
		List<HubTeamAgency> mappings = List.of(mapping(100L, TEAM_ID));

		// When:
		service.deleteAll(mappings);

		// Then:
		verify(teamAgencyRepository).deleteAll(mappings);
	}

	private static HubTeamAgency mapping(Long agencyId, Long teamId) {
		HubTeamAgency mapping = new HubTeamAgency();
		mapping.setAgencyId(agencyId);
		mapping.setTeamId(teamId);
		return mapping;
	}
}
