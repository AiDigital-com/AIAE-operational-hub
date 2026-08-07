package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubRoleRepository;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubRoleServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubRoleServiceImplTest {

	private static final String ROLE_CODE = "ADMIN";

	@Mock
	private HubRoleRepository roleRepository;

	@InjectMocks
	private HubRoleServiceImpl service;

	@Test
	void shouldListActiveRolesOrderedByDisplayNameTest() {
		// Given:
		HubRole role = Instancio.create(HubRole.class);
		ArgumentCaptor<String> statusCaptor = ArgumentCaptor.forClass(String.class);
		when(roleRepository.findAllByStatusOrderByDisplayNameAsc(statusCaptor.capture()))
				.thenReturn(List.of(role));

		// When:
		List<HubRole> result = service.listActiveOrderedByDisplayName();

		// Then:
		assertThat(statusCaptor.getValue()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result).containsExactly(role);
	}

	@Test
	void shouldGetRoleByCodeTest() {
		// Given:
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getRoleCode), ROLE_CODE)
				.create();
		when(roleRepository.findByRoleCode(ROLE_CODE)).thenReturn(Optional.of(role));

		// When:
		HubRole result = service.existingByRoleCode(ROLE_CODE);

		// Then:
		assertThat(result).isEqualTo(role);
	}

	@Test
	void shouldThrowWhenRoleCodeIsBlankTest() {
		// Given:

		// When-Then:
		assertThatThrownBy(() -> service.existingByRoleCode(" "))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_003.getCode());
	}

	@Test
	void shouldThrowWhenRoleCodeIsUnknownTest() {
		// Given:
		when(roleRepository.findByRoleCode(ROLE_CODE)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.existingByRoleCode(ROLE_CODE))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_004.getCode())
				.hasMessageContaining(ROLE_CODE);
	}
}
