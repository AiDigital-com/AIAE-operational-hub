package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.mapper.HubRoleAssignmentMapper;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import com.aidigital.operationalhub.service.rbac.model.RevokeRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link RbacAdministrationServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class RbacAdministrationServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final Long ROLE_ID = 4L;
	private static final Long SCOPE_TYPE_ID = 3L;
	private static final Long ASSIGNMENT_ID = 7L;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@Mock
	private RoleAssignmentValidator roleAssignmentValidator;

	@Mock
	private HubRoleAssignmentMapper hubRoleAssignmentMapper;

	@Mock
	private CacheInvalidationEventService cacheInvalidationEventService;

	@Spy
	@InjectMocks
	private RbacAdministrationServiceImpl service;

	@Test
	void shouldAssignRoleWhenNoConflictExistsTest() {
		// Given:
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.set(field(HubRole::getRoleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.set(field(HubScopeType::getScopeCode), RbacScopeCode.ALL.getCode())
				.create();
		ResolvedAssignment resolvedAssignment = new ResolvedAssignment(role, scopeType);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::roleCode), RbacRoleCode.ADMIN.getCode())
				.set(field(AssignRoleModel::scopeCode), RbacScopeCode.ALL.getCode())
				.set(field(AssignRoleModel::scopeId), null)
				.create();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		HubRoleAssignment saved = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.set(field(HubRoleAssignment::getUserId), USER_ID)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		RoleAssignmentModel savedModel = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::assignment), saved)
				.set(field(RoleAssignmentModel::roleCode), RbacRoleCode.ADMIN.getCode())
				.set(field(RoleAssignmentModel::scopeCode), RbacScopeCode.ALL.getCode())
				.create();
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(roleAssignmentValidator.validate(command)).thenReturn(resolvedAssignment);
		when(hubUserService.existingByIdForUpdate(USER_ID)).thenReturn(user);
		when(hubRoleAssignmentService.findActiveConflictsForUpdate(
				USER_ID, ROLE_ID, SCOPE_TYPE_ID, null))
				.thenReturn(List.of());
		when(hubRoleAssignmentMapper.toNewAssignment(
				command, resolvedAssignment, USER_ID, HubStatus.ACTIVE.getCode()))
				.thenReturn(saved);
		when(hubRoleAssignmentService.save(assignmentCaptor.capture())).thenReturn(saved);
		doReturn(savedModel).when(service).singleView(saved);

		// When:
		RoleAssignmentModel result = service.assignRole(command);

		// Then:
		assertThat(assignmentCaptor.getValue().getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(assignmentCaptor.getValue().getUserId()).isEqualTo(USER_ID);
		assertThat(result).isEqualTo(savedModel);
	}

	@Test
	void shouldReturnExistingAssignmentWhenDuplicateConflictExistsTest() {
		// Given:
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.create();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		HubRoleAssignment existing = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.create();
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::scopeId), null)
				.create();
		RoleAssignmentModel existingModel = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::assignment), existing)
				.create();
		when(roleAssignmentValidator.validate(command)).thenReturn(new ResolvedAssignment(role, scopeType));
		when(hubUserService.existingByIdForUpdate(USER_ID)).thenReturn(user);
		when(hubRoleAssignmentService.findActiveConflictsForUpdate(
				USER_ID, ROLE_ID, SCOPE_TYPE_ID, null))
				.thenReturn(List.of(existing));
		doReturn(existingModel).when(service).singleView(existing);
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);

		// When:
		RoleAssignmentModel result = service.assignRole(command);

		// Then:
		assertThat(result).isEqualTo(existingModel);
		verify(hubRoleAssignmentService, never()).save(assignmentCaptor.capture());
	}

	@Test
	void shouldAutoRevokeOtherActiveAssignmentWhenAssigningADifferentRoleTest() {
		// Given: the user already holds a different active role; assigning a new one revokes it
		// automatically in the same call instead of requiring a separate revoke call first
		HubRole requestedRole = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.set(field(HubRole::getRoleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.create();
		HubRole existingRole = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), 9L)
				.set(field(HubRole::getRoleCode), RbacRoleCode.TL.getCode())
				.create();
		HubRoleAssignment existingActive = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getRole), existingRole)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.create();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		ResolvedAssignment resolvedAssignment = new ResolvedAssignment(requestedRole, scopeType);
		HubRoleAssignment saved = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.set(field(HubRoleAssignment::getUserId), USER_ID)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		RoleAssignmentModel savedModel = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::assignment), saved)
				.create();
		when(roleAssignmentValidator.validate(command)).thenReturn(resolvedAssignment);
		when(hubUserService.existingByIdForUpdate(USER_ID)).thenReturn(user);
		when(hubRoleAssignmentService.findActiveConflictsForUpdate(
				USER_ID, ROLE_ID, SCOPE_TYPE_ID, command.scopeId()))
				.thenReturn(List.of());
		when(hubRoleAssignmentService.findActiveByUserId(USER_ID)).thenReturn(List.of(existingActive));
		when(hubRoleAssignmentMapper.toNewAssignment(command, resolvedAssignment, USER_ID, HubStatus.ACTIVE.getCode()))
				.thenReturn(saved);
		when(hubRoleAssignmentService.save(saved)).thenReturn(saved);
		doNothing().when(service).revoke(existingActive);
		doReturn(savedModel).when(service).singleView(saved);

		// When:
		RoleAssignmentModel result = service.assignRole(command);

		// Then: the old active assignment was revoked, and the new one was created
		verify(service).revoke(existingActive);
		assertThat(result).isEqualTo(savedModel);
	}

	@Test
	void shouldReactivateAPreviouslyRevokedAssignmentForTheSameRoleAndScopeInsteadOfInsertingADuplicateTest() {
		// Given: the desired role/scope already exists as a REVOKED row (e.g. reassigned away and back);
		// the unique index forbids a second row for the same (user, role, scope type, scope id) tuple, so
		// it must be reactivated in place rather than inserted as a new row
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.create();
		ResolvedAssignment resolvedAssignment = new ResolvedAssignment(role, scopeType);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.create();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		HubRoleAssignment revoked = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.set(field(HubRoleAssignment::getUserId), USER_ID)
				.set(field(HubRoleAssignment::getRole), role)
				.set(field(HubRoleAssignment::getScopeType), scopeType)
				.set(field(HubRoleAssignment::getStatus), HubStatus.REVOKED.getCode())
				.create();
		RoleAssignmentModel reactivatedModel = Instancio.of(RoleAssignmentModel.class)
				.set(field(RoleAssignmentModel::assignment), revoked)
				.create();
		ArgumentCaptor<HubRoleAssignment> savedCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(roleAssignmentValidator.validate(command)).thenReturn(resolvedAssignment);
		when(hubUserService.existingByIdForUpdate(USER_ID)).thenReturn(user);
		when(hubRoleAssignmentService.findActiveConflictsForUpdate(
				USER_ID, ROLE_ID, SCOPE_TYPE_ID, command.scopeId()))
				.thenReturn(List.of());
		when(hubRoleAssignmentService.findActiveByUserId(USER_ID)).thenReturn(List.of());
		when(hubRoleAssignmentService.findForScopeForUpdate(USER_ID, ROLE_ID, SCOPE_TYPE_ID, command.scopeId()))
				.thenReturn(Optional.of(revoked));
		when(hubRoleAssignmentService.save(savedCaptor.capture())).thenReturn(revoked);
		doReturn(reactivatedModel).when(service).singleView(revoked);

		// When:
		RoleAssignmentModel result = service.assignRole(command);

		// Then: the existing row was reactivated in place, not replaced by a newly created one
		assertThat(savedCaptor.getValue()).isSameAs(revoked);
		assertThat(savedCaptor.getValue().getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result).isEqualTo(reactivatedModel);
	}

	@Test
	void shouldThrowWhenTargetUserIsUnknownTest() {
		// Given:
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.create();
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.create();
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(roleAssignmentValidator.validate(command)).thenReturn(new ResolvedAssignment(role, scopeType));
		when(hubUserService.existingByIdForUpdate(USER_ID))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_014, USER_ID));

		// When-Then:
		assertThatThrownBy(() -> service.assignRole(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_014.getCode())
				.hasMessageContaining("Unknown user");
		verify(hubRoleAssignmentService, never()).save(assignmentCaptor.capture());
	}

	@Test
	void shouldCallRevokeWhenActiveAssignmentExistsTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getId), ASSIGNMENT_ID)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		RevokeRoleModel command = Instancio.of(RevokeRoleModel.class)
				.set(field(RevokeRoleModel::assignmentId), ASSIGNMENT_ID)
				.create();
		when(hubRoleAssignmentService.findByIdForUpdate(ASSIGNMENT_ID)).thenReturn(Optional.of(assignment));
		doNothing().when(service).revoke(assignment);

		// When:
		service.revokeRole(command);

		// Then:
		verify(service).revoke(assignment);
	}

	@Test
	void shouldRevokeAssignmentTest() {
		// Given:
		HubRoleAssignment assignment = Instancio.of(HubRoleAssignment.class)
				.set(field(HubRoleAssignment::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(hubRoleAssignmentService.save(assignmentCaptor.capture())).thenReturn(assignment);

		// When:
		service.revoke(assignment);

		// Then:
		assertThat(assignmentCaptor.getValue()).isEqualTo(assignment);
		assertThat(assignmentCaptor.getValue().getStatus()).isEqualTo(HubStatus.REVOKED.getCode());
	}

	@Test
	void shouldNotRevokeWhenAssignmentMissingTest() {
		// Given:
		RevokeRoleModel command = Instancio.of(RevokeRoleModel.class)
				.set(field(RevokeRoleModel::assignmentId), ASSIGNMENT_ID)
				.create();
		ArgumentCaptor<HubRoleAssignment> assignmentCaptor = ArgumentCaptor.forClass(HubRoleAssignment.class);
		when(hubRoleAssignmentService.findByIdForUpdate(ASSIGNMENT_ID)).thenReturn(Optional.empty());

		// When:
		service.revokeRole(command);

		// Then:
		verify(hubRoleAssignmentService, never()).save(assignmentCaptor.capture());
	}

	@Test
	void shouldThrowWhenAssignmentIdIsNullTest() {
		// Given:
		RevokeRoleModel command = Instancio.of(RevokeRoleModel.class)
				.set(field(RevokeRoleModel::assignmentId), null)
				.create();

		// When-Then:
		assertThatThrownBy(() -> service.revokeRole(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_013.getCode())
				.hasMessageContaining("assignmentId");
	}
}
