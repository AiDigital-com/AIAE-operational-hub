package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubAgencyOwnerOverrideRepository;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubAgencyOwnerOverrideServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubAgencyOwnerOverrideServiceImplTest {

	private static final Long OWNER_USER_ID = 100L;
	private static final Long TEAM_LEAD_USER_ID = 200L;

	@Mock
	private HubAgencyOwnerOverrideRepository agencyOwnerOverrideRepository;

	@InjectMocks
	private HubAgencyOwnerOverrideServiceImpl service;

	@Test
	void shouldDelegateToRepositoryAndReturnItsResultTest() {
		// Given:
		HubAgencyOwnerOverride override = override(HubStatus.ACTIVE.getCode());
		when(agencyOwnerOverrideRepository.findAllByStatus(HubStatus.ACTIVE.getCode()))
				.thenReturn(List.of(override));

		// When:
		List<HubAgencyOwnerOverride> result = service.findAllByStatus(HubStatus.ACTIVE.getCode());

		// Then:
		assertThat(result).containsExactly(override);
	}

	@Test
	void shouldFilterByTheExactStatusPassedInTest() {
		// Given: an inactive row exists, but only ACTIVE rows are requested
		HubAgencyOwnerOverride activeOverride = override(HubStatus.ACTIVE.getCode());
		when(agencyOwnerOverrideRepository.findAllByStatus(HubStatus.ACTIVE.getCode()))
				.thenReturn(List.of(activeOverride));
		when(agencyOwnerOverrideRepository.findAllByStatus(HubStatus.INACTIVE.getCode()))
				.thenReturn(List.of());

		// When:
		List<HubAgencyOwnerOverride> activeResult = service.findAllByStatus(HubStatus.ACTIVE.getCode());
		List<HubAgencyOwnerOverride> inactiveResult = service.findAllByStatus(HubStatus.INACTIVE.getCode());

		// Then:
		assertThat(activeResult).containsExactly(activeOverride);
		assertThat(inactiveResult).isEmpty();
		verify(agencyOwnerOverrideRepository).findAllByStatus(HubStatus.ACTIVE.getCode());
		verify(agencyOwnerOverrideRepository).findAllByStatus(HubStatus.INACTIVE.getCode());
	}

	@Test
	void shouldReturnEmptyWhenRepositoryHasNoMatchingRowsTest() {
		// Given:
		when(agencyOwnerOverrideRepository.findAllByStatus(HubStatus.ACTIVE.getCode())).thenReturn(List.of());

		// When:
		List<HubAgencyOwnerOverride> result = service.findAllByStatus(HubStatus.ACTIVE.getCode());

		// Then:
		assertThat(result).isEmpty();
	}

	private static HubAgencyOwnerOverride override(String status) {
		return Instancio.of(HubAgencyOwnerOverride.class)
				.set(field(HubAgencyOwnerOverride::getOwnerUserId), OWNER_USER_ID)
				.set(field(HubAgencyOwnerOverride::getTeamLeadUserId), TEAM_LEAD_USER_ID)
				.set(field(HubAgencyOwnerOverride::getStatus), status)
				.create();
	}
}
