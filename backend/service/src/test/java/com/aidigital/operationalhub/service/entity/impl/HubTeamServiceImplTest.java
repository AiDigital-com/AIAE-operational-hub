package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.repository.HubTeamRepository;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubTeamServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubTeamServiceImplTest {

	private static final Long TEAM_ID = 7L;

	@Mock
	private HubTeamRepository teamRepository;

	@Mock
	private CacheInvalidationEventService cacheInvalidationEventService;

	@InjectMocks
	private HubTeamServiceImpl service;

	@Test
	void shouldReturnTrueWhenTeamExistsTest() {
		// Given:
		when(teamRepository.existsById(TEAM_ID)).thenReturn(true);

		// When:
		boolean result = service.existsById(TEAM_ID);

		// Then:
		assertThat(result).isTrue();
	}

	@Test
	void shouldReturnFalseWhenTeamMissingTest() {
		// Given:
		when(teamRepository.existsById(TEAM_ID)).thenReturn(false);

		// When:
		boolean result = service.existsById(TEAM_ID);

		// Then:
		assertThat(result).isFalse();
	}

	@Test
	void shouldListAllTeamsOrderedByNameTest() {
		// Given: the cached findAll() returns teams out of name order
		HubTeam alpha = team("Alpha");
		HubTeam beta = team("Beta");
		when(teamRepository.findAll()).thenReturn(List.of(beta, alpha));

		// When:
		List<HubTeam> result = service.listAllOrderedByName();

		// Then: sorted in memory, and the query-cached no-arg findAll() is what's read
		assertThat(result).containsExactly(alpha, beta);
	}

	@Test
	void shouldCreateTeamWithValidNameTest() {
		// Given:
		HubTeam input = team("New Team");
		HubTeam saved = team("New Team");
		when(teamRepository.save(input)).thenReturn(saved);

		// When:
		HubTeam result = service.create(input);

		// Then:
		assertThat(result).isEqualTo(saved);
		verify(teamRepository).save(input);
	}

	@Test
	void shouldRejectCreateWhenNameBlankTest() {
		// Given:
		HubTeam input = team("  ");

		// When/Then:
		assertThatThrownBy(() -> service.create(input))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Team name must not be blank");
	}

	@Test
	void shouldUpdateExistingTeamTest() {
		// Given:
		HubTeam existing = team("Old Team");
		existing.setStatus("ACTIVE");
		HubTeam update = team("Updated Team");
		update.setPodKey("POD-1");
		update.setStatus("INACTIVE");
		when(teamRepository.findById(TEAM_ID)).thenReturn(Optional.of(existing));

		// When:
		HubTeam result = service.update(TEAM_ID, update);

		// Then:
		assertThat(result.getTeamName()).isEqualTo("Updated Team");
		assertThat(result.getPodKey()).isEqualTo("POD-1");
		assertThat(result.getStatus()).isEqualTo("INACTIVE");
	}

	@Test
	void shouldThrowWhenUpdatingMissingTeamTest() {
		// Given:
		HubTeam update = team("Updated Team");
		when(teamRepository.findById(TEAM_ID)).thenReturn(Optional.empty());

		// When/Then:
		assertThatThrownBy(() -> service.update(TEAM_ID, update))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Unknown team");
	}

	@Test
	void shouldRejectUpdatingNetSuiteTeamTest() {
		// Given: the existing team was synced from NetSuite
		HubTeam existing = team("Synced Team");
		existing.setFromNetSuite(true);
		HubTeam update = team("Updated Team");
		when(teamRepository.findById(TEAM_ID)).thenReturn(Optional.of(existing));

		// When/Then:
		assertThatThrownBy(() -> service.update(TEAM_ID, update))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("cannot be edited");
	}

	@Test
	void shouldRejectUpdateWhenNameBlankTest() {
		// Given:
		HubTeam update = team("  ");

		// When/Then:
		assertThatThrownBy(() -> service.update(TEAM_ID, update))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Team name must not be blank");
	}

	private HubTeam team(String name) {
		HubTeam team = new HubTeam();
		team.setTeamName(name);
		return team;
	}
}
