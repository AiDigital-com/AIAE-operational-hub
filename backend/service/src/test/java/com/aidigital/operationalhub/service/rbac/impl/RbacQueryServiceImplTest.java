package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.mapper.HubRoleAssignmentMapper;
import com.aidigital.operationalhub.service.rbac.mapper.HubUserMapper;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link RbacQueryServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class RbacQueryServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final String CLERK_ID = "user_clerk_42";

	@Mock
	private HubUserService hubUserService;
	@Mock
	private HubUserMapper hubUserMapper;
	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;
	@Mock
	private HubRoleAssignmentMapper hubRoleAssignmentMapper;

	@Test
	void shouldSearchUsersWithTheirActiveRoleTest() {
		// Given:
		Long teamId = 42L;
		RbacQueryServiceImpl service = spy(new RbacQueryServiceImpl(
				hubUserService, hubUserMapper, hubRoleAssignmentMapper, hubRoleAssignmentService));
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getRoleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		HubRoleAssignment activeAssignment = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getUserId), USER_ID)
				.set(field(HubRoleAssignment::getRole), role)
				.create();
		HubUserSummaryModel summary = Instancio.of(HubUserSummaryModel.class)
				.set(field(HubUserSummaryModel::hubUserId), USER_ID)
				.set(field(HubUserSummaryModel::roleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		when(hubUserService.searchUsers(criteria))
				.thenReturn(new PageImpl<>(List.of(user), PageRequest.of(0, 20), 1));
		when(hubRoleAssignmentService.findActiveByUserIds(List.of(USER_ID)))
				.thenReturn(List.of(activeAssignment));
		when(service.teamScopeId(activeAssignment)).thenReturn(teamId);
		when(hubUserMapper.toSummaryModel(user, RbacRoleCode.ADMIN.getCode(), teamId)).thenReturn(summary);

		// When:
		Page<HubUserSummaryModel> result = service.searchUsers(criteria);

		// Then:
		assertThat(result.getContent()).containsExactly(summary);
		assertThat(result.getTotalElements()).isEqualTo(1);
	}

	@Test
	void shouldReturnEffectiveAccessForAdminTest() {
		// Given:
		RbacQueryServiceImpl service = spy(new RbacQueryServiceImpl(
				hubUserService, hubUserMapper, hubRoleAssignmentMapper, hubRoleAssignmentService));
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.set(field(HubUser::getClerkUserId), CLERK_ID)
				.create();
		RoleAssignmentModel assignment = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::roleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		when(hubUserService.findByClerkUserId(CLERK_ID)).thenReturn(Optional.of(user));
		doReturn(List.of(assignment)).when(service).activeAssignmentModels(USER_ID);

		// When:
		EffectiveAccessContext result = service.getEffectiveAccess(CLERK_ID);

		// Then:
		assertThat(result.clerkUserId()).isEqualTo(CLERK_ID);
		assertThat(result.userId()).isEqualTo(USER_ID);
		assertThat(result.roleCodes()).containsExactly(RbacRoleCode.ADMIN.getCode());
		assertThat(result.assignments()).containsExactly(assignment);
		assertThat(result.admin()).isTrue();
		assertThat(result.canManageRoles()).isTrue();
	}

	@Test
	void shouldThrowWhenEffectiveAccessUserIsUnknownTest() {
		// Given:
		RbacQueryServiceImpl service = new RbacQueryServiceImpl(
				hubUserService, hubUserMapper, hubRoleAssignmentMapper, hubRoleAssignmentService);
		when(hubUserService.findByClerkUserId(CLERK_ID)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.getEffectiveAccess(CLERK_ID))
				.isInstanceOf(AccessDeniedException.class)
				.hasMessageContaining(CLERK_ID);
	}

	@Test
	void shouldListRoleAssignmentsTest() {
		// Given:
		RbacQueryServiceImpl service = spy(new RbacQueryServiceImpl(
				hubUserService, hubUserMapper, hubRoleAssignmentMapper, hubRoleAssignmentService));
		RoleAssignmentModel assignment = Instancio.create(RoleAssignmentModel.class);
		doReturn(List.of(assignment)).when(service).activeAssignmentModels(USER_ID);

		// When:
		List<RoleAssignmentModel> result = service.listRoleAssignments(USER_ID);

		// Then:
		assertThat(result).containsExactly(assignment);
	}

	@Test
	void shouldReturnActiveAssignmentModelsTest() {
		// Given:
		RbacQueryServiceImpl service = new RbacQueryServiceImpl(
				hubUserService, hubUserMapper, hubRoleAssignmentMapper, hubRoleAssignmentService);
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		RoleAssignmentModel model = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::assignment), assignment)
				.create();
		when(hubRoleAssignmentService.findActiveByUserId(USER_ID)).thenReturn(List.of(assignment));
		when(hubRoleAssignmentMapper.toModel(assignment)).thenReturn(model);

		// When:
		List<RoleAssignmentModel> result = service.activeAssignmentModels(USER_ID);

		// Then:
		assertThat(result).containsExactly(model);
	}
}
