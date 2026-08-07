package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.repository.HubUserRepository;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import com.aidigital.operationalhub.service.rbac.search.HubUserSearchMapper;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubUserServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubUserServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final String CLERK_ID = "user_clerk_42";

	@Mock
	private HubUserRepository userRepository;

	@Mock
	private HubUserSearchMapper hubUserSearchMapper;

	@InjectMocks
	private HubUserServiceImpl service;

	@Test
	void shouldFindUserByClerkUserIdTest() {
		// Given:
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getClerkUserId), CLERK_ID)
				.create();
		when(userRepository.findByClerkUserId(CLERK_ID)).thenReturn(Optional.of(user));

		// When:
		Optional<HubUser> result = service.findByClerkUserId(CLERK_ID);

		// Then:
		assertThat(result).contains(user);
	}

	@Test
	void shouldGetUserByIdForUpdateTest() {
		// Given:
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

		// When:
		HubUser result = service.existingByIdForUpdate(USER_ID);

		// Then:
		assertThat(result).isEqualTo(user);
	}

	@Test
	void shouldThrowWhenUserByIdForUpdateIsMissingTest() {
		// Given:
		when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.existingByIdForUpdate(USER_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_014.getCode())
				.hasMessageContaining(String.valueOf(USER_ID));
	}

	@Test
	void shouldSearchUsersUsingMappedSpecificationAndPageableTest() {
		// Given:
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Specification<HubUser> specification = (root, query, builder) -> null;
		Pageable pageable = PageRequest.of(0, 20);
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		Page<HubUser> page = new PageImpl<>(List.of(user), pageable, 1);
		when(hubUserSearchMapper.toSpecification(criteria)).thenReturn(specification);
		when(hubUserSearchMapper.toPageable(criteria)).thenReturn(pageable);
		when(userRepository.findAll(specification, pageable)).thenReturn(page);

		// When:
		Page<HubUser> result = service.searchUsers(criteria);

		// Then:
		assertThat(result).isSameAs(page);
	}

	@Test
	void shouldSaveUserTest() {
		// Given:
		HubUser user = Instancio.create(HubUser.class);
		HubUser saved = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		ArgumentCaptor<HubUser> userCaptor = ArgumentCaptor.forClass(HubUser.class);
		when(userRepository.save(userCaptor.capture())).thenReturn(saved);

		// When:
		HubUser result = service.save(user);

		// Then:
		assertThat(userCaptor.getValue()).isEqualTo(user);
		assertThat(result).isEqualTo(saved);
	}
}
