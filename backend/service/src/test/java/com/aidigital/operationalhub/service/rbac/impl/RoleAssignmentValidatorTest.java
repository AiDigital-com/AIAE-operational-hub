package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link RoleAssignmentValidator} covering RBAC scope rules.
 */
@ExtendWith(MockitoExtension.class)
class RoleAssignmentValidatorTest {

	private static final Long USER_ID = 42L;
	private static final Long TEAM_ID = 7L;

	@Mock
	private HubRoleService hubRoleService;

	@Mock
	private HubScopeTypeService hubScopeTypeService;

	@Mock
	private HubTeamService hubTeamService;

	@Test
	void shouldValidateCommandTest() {
		// Given:
		RoleAssignmentValidator validator = spy(new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService));
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::roleCode), RbacRoleCode.ADMIN.getCode())
				.set(field(AssignRoleModel::scopeCode), RbacScopeCode.ALL.getCode())
				.create();
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getRoleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getScopeCode), RbacScopeCode.ALL.getCode())
				.create();
		when(hubRoleService.existingByRoleCode(RbacRoleCode.ADMIN.getCode())).thenReturn(role);
		when(hubScopeTypeService.existingByScopeCode(RbacScopeCode.ALL.getCode())).thenReturn(scopeType);
		doNothing().when(validator).validateScope(command, RbacScopeCode.ALL.getCode());

		// When:
		ResolvedAssignment result = validator.validate(command);

		// Then:
		assertThat(result.role()).isEqualTo(role);
		assertThat(result.scopeType()).isEqualTo(scopeType);
		verify(validator).validateScope(command, RbacScopeCode.ALL.getCode());
	}

	@Test
	void shouldThrowWhenCommandIsNullTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);

		// When-Then:
		assertThatThrownBy(() -> validator.validate(null))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_001.getCode());
	}

	@Test
	void shouldThrowWhenUserIdIsNullTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), null)
				.create();

		// When-Then:
		assertThatThrownBy(() -> validator.validate(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_002.getCode());
	}

	@Test
	void shouldValidateAllScopeTest() {
		// Given:
		RoleAssignmentValidator validator = spy(new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService));
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), null)
				.create();
		doNothing().when(validator).requireNullScopeId(command);

		// When:
		validator.validateScope(command, RbacScopeCode.ALL.getCode());

		// Then:
		verify(validator).requireNullScopeId(command);
	}

	@Test
	void shouldValidateOwnScopeTest() {
		// Given:
		RoleAssignmentValidator validator = spy(new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService));
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		doNothing().when(validator).requireScopeIdEqualsUser(command);

		// When:
		validator.validateScope(command, RbacScopeCode.OWN.getCode());

		// Then:
		verify(validator).requireScopeIdEqualsUser(command);
	}

	@Test
	void shouldValidateTeamScopeTest() {
		// Given:
		RoleAssignmentValidator validator = spy(new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService));
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		doNothing().when(validator).requireExistingTeam(command);

		// When:
		validator.validateScope(command, RbacScopeCode.TEAM.getCode());

		// Then:
		verify(validator).requireExistingTeam(command);
	}

	@Test
	void shouldThrowWhenScopeIsNotAssignableTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);

		// When-Then:
		assertThatThrownBy(() -> validator.validateScope(command, RbacScopeCode.AGENCY.getCode()))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_012.getCode())
				.hasMessageContaining("not yet assignable");
	}

	@Test
	void shouldThrowWhenAllScopeHasScopeIdTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), TEAM_ID)
				.create();

		// When-Then:
		assertThatThrownBy(() -> validator.requireNullScopeId(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_008.getCode());
	}

	@Test
	void shouldPassWhenAllScopeHasNoScopeIdTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), null)
				.create();

		// When-Then:
		assertThatCode(() -> validator.requireNullScopeId(command)).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenOwnScopeDoesNotMatchUserTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::scopeId), TEAM_ID)
				.create();

		// When-Then:
		assertThatThrownBy(() -> validator.requireScopeIdEqualsUser(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_009.getCode());
	}

	@Test
	void shouldPassWhenOwnScopeMatchesUserTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::scopeId), USER_ID)
				.create();

		// When-Then:
		assertThatCode(() -> validator.requireScopeIdEqualsUser(command)).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenTeamScopeIdIsNullTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), null)
				.create();

		// When-Then:
		assertThatThrownBy(() -> validator.requireExistingTeam(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_010.getCode());
	}

	@Test
	void shouldThrowWhenTeamDoesNotExistTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), TEAM_ID)
				.create();
		when(hubTeamService.existsById(TEAM_ID)).thenReturn(false);

		// When-Then:
		assertThatThrownBy(() -> validator.requireExistingTeam(command))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", OperationalHubErrorReason.OPH_011.getCode())
				.hasMessageContaining(String.valueOf(TEAM_ID));
	}

	@Test
	void shouldPassWhenTeamExistsTest() {
		// Given:
		RoleAssignmentValidator validator = new RoleAssignmentValidator(
				hubRoleService, hubTeamService, hubScopeTypeService);
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::scopeId), TEAM_ID)
				.create();
		when(hubTeamService.existsById(TEAM_ID)).thenReturn(true);

		// When-Then:
		assertThatCode(() -> validator.requireExistingTeam(command)).doesNotThrowAnyException();
	}
}
