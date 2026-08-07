package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubScopeTypeRepository;
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
 * Pure Mockito unit tests for {@link HubScopeTypeServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubScopeTypeServiceImplTest {

	private static final String SCOPE_CODE = "TEAM";

	@Mock
	private HubScopeTypeRepository scopeTypeRepository;

	@InjectMocks
	private HubScopeTypeServiceImpl service;

	@Test
	void shouldListActiveScopeTypesOrderedByDisplayNameTest() {
		// Given:
		HubScopeType scopeType = Instancio.create(HubScopeType.class);
		ArgumentCaptor<String> statusCaptor = ArgumentCaptor.forClass(String.class);
		when(scopeTypeRepository.findAllByStatusOrderByDisplayNameAsc(statusCaptor.capture()))
				.thenReturn(List.of(scopeType));

		// When:
		List<HubScopeType> result = service.listActiveOrderedByDisplayName();

		// Then:
		assertThat(statusCaptor.getValue()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result).containsExactly(scopeType);
	}

	@Test
	void shouldGetScopeTypeByCodeTest() {
		// Given:
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getScopeCode), SCOPE_CODE)
				.create();
		when(scopeTypeRepository.findByScopeCode(SCOPE_CODE)).thenReturn(Optional.of(scopeType));

		// When:
		HubScopeType result = service.existingByScopeCode(SCOPE_CODE);

		// Then:
		assertThat(result).isEqualTo(scopeType);
	}

	@Test
	void shouldThrowWhenScopeCodeIsBlankTest() {
		// Given:

		// When-Then:
		assertThatThrownBy(() -> service.existingByScopeCode(" "))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_005.getCode());
	}

	@Test
	void shouldThrowWhenScopeCodeIsUnknownTest() {
		// Given:
		when(scopeTypeRepository.findByScopeCode(SCOPE_CODE)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.existingByScopeCode(SCOPE_CODE))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_006.getCode())
				.hasMessageContaining(SCOPE_CODE);
	}
}
