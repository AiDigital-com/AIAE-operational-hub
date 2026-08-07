package com.aidigital.operationalhub.service.rbac.mapper;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;
import static org.springframework.test.util.ReflectionTestUtils.setField;

/**
 * Unit tests for {@link HubRoleAssignmentMapperImpl}.
 */
class HubRoleAssignmentMapperImplTest {

	private static final Long USER_ID = 42L;
	private static final Long ROLE_ID = 4L;
	private static final Long SCOPE_TYPE_ID = 3L;
	private static final Long SCOPE_ID = 7L;

	@Test
	void shouldMapToNewAssignmentTest() {
		// Given:
		HubRoleAssignmentMapperImpl mapper = new HubRoleAssignmentMapperImpl();
		AssignRoleModel command = Instancio.of(AssignRoleModel.class)
				.set(field(AssignRoleModel::userId), USER_ID)
				.set(field(AssignRoleModel::scopeId), SCOPE_ID)
				.create();
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getId), ROLE_ID)
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getId), SCOPE_TYPE_ID)
				.create();
		ResolvedAssignment resolvedAssignment = new ResolvedAssignment(role, scopeType);

		// When:
		HubRoleAssignment result = mapper.toNewAssignment(
				command, resolvedAssignment, USER_ID, HubStatus.ACTIVE.getCode());

		// Then:
		assertThat(result.getId()).isNull();
		assertThat(result.getUserId()).isEqualTo(USER_ID);
		assertThat(result.getScopeId()).isEqualTo(SCOPE_ID);
		assertThat(result.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result.getCreatedByUserId()).isEqualTo(command.actingUserId());
	}

	@Test
	void shouldMapToModelTest() {
		// Given:
		HubRoleAssignmentMapperImpl mapper = new HubRoleAssignmentMapperImpl();
		HubRole role = Instancio.of(HubRole.class)
				.set(field(HubRole::getRoleCode), RbacRoleCode.ADMIN.getCode())
				.create();
		HubScopeType scopeType = Instancio.of(HubScopeType.class)
				.set(field(HubScopeType::getScopeCode), RbacScopeCode.ALL.getCode())
				.create();
		HubRoleAssignment assignment = Instancio.create(HubRoleAssignment.class);
		setField(assignment, "role", role);
		setField(assignment, "scopeType", scopeType);

		// When:
		RoleAssignmentModel result = mapper.toModel(assignment);

		// Then:
		assertThat(result.assignment()).isEqualTo(assignment);
		assertThat(result.roleCode()).isEqualTo(RbacRoleCode.ADMIN.getCode());
		assertThat(result.scopeCode()).isEqualTo(RbacScopeCode.ALL.getCode());
	}
}
