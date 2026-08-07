package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubRoleAssignmentRepository;
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
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubRoleAssignmentServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubRoleAssignmentServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final Long ROLE_ID = 4L;
	private static final Long SCOPE_TYPE_ID = 3L;
	private static final Long SCOPE_ID = 9L;
	private static final Long ASSIGNMENT_ID = 7L;

	@Mock
	private HubRoleAssignmentRepository assignmentRepository;

	@InjectMocks
	private HubRoleAssignmentServiceImpl service;

	@Test
	void shouldFindActiveAssignmentsByUserIdTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		ArgumentCaptor<String> statusCaptor = ArgumentCaptor.forClass(String.class);
		when(assignmentRepository.findAllByUserIdAndStatus(eq(USER_ID), statusCaptor.capture()))
				.thenReturn(List.of(assignment));

		// When:
		List<HubRoleAssignment> result = service.findActiveByUserId(USER_ID);

		// Then:
		assertThat(statusCaptor.getValue()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result).containsExactly(assignment);
	}

	@Test
	void shouldFindAssignmentByIdForUpdateTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.create();
		when(assignmentRepository.findByIdForUpdate(ASSIGNMENT_ID)).thenReturn(Optional.of(assignment));

		// When:
		Optional<HubRoleAssignment> result = service.findByIdForUpdate(ASSIGNMENT_ID);

		// Then:
		assertThat(result).contains(assignment);
	}

	@Test
	void shouldFindActiveConflictsForUpdateTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		ArgumentCaptor<String> statusCaptor = ArgumentCaptor.forClass(String.class);
		when(assignmentRepository.findActiveForUserAndScopeForUpdate(
				eq(USER_ID), eq(ROLE_ID), eq(SCOPE_TYPE_ID), eq(SCOPE_ID), statusCaptor.capture()))
				.thenReturn(List.of(assignment));

		// When:
		List<HubRoleAssignment> result = service.findActiveConflictsForUpdate(
				USER_ID, ROLE_ID, SCOPE_TYPE_ID, SCOPE_ID);

		// Then:
		assertThat(statusCaptor.getValue()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result).containsExactly(assignment);
	}

	@Test
	void shouldFindAllAssignmentsByUserIdsRegardlessOfStatusTest() {
		// Given: preloading before a bulk reconcile needs every status, not just active
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		List<Long> userIds = List.of(USER_ID, 43L);
		when(assignmentRepository.findAllByUserIdIn(userIds)).thenReturn(List.of(assignment));

		// When:
		List<HubRoleAssignment> result = service.findAllByUserIds(userIds);

		// Then:
		assertThat(result).containsExactly(assignment);
	}

	@Test
	void shouldReturnEmptyWithoutQueryingWhenUserIdsIsEmptyTest() {
		// When:
		List<HubRoleAssignment> result = service.findAllByUserIds(List.of());

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldSaveAssignmentTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		HubRoleAssignment saved = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.create();
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(assignmentRepository.save(assignmentCaptor.capture())).thenReturn(saved);

		// When:
		HubRoleAssignment result = service.save(assignment);

		// Then:
		assertThat(assignmentCaptor.getValue()).isEqualTo(assignment);
		assertThat(result).isEqualTo(saved);
	}
}
