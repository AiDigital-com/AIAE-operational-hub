package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AssignRoleRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.RoleAssignmentV1;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link RoleAssignmentContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class RoleAssignmentContractMapperTest {

	@InjectMocks
	private RoleAssignmentContractMapperImpl mapper;

	@Test
	void shouldMapModelToV1Test() {
		// Given:
		RoleAssignmentModel model = Instancio.create(RoleAssignmentModel.class);

		// When:
		RoleAssignmentV1 result = mapper.toV1(model);

		// Then:
		assertThat(result.getId()).isEqualTo(model.assignment().getId());
		assertThat(result.getUserId()).isEqualTo(model.assignment().getUserId());
		assertThat(result.getScopeId()).isEqualTo(model.assignment().getScopeId());
		assertThat(result.getStatus()).isEqualTo(model.assignment().getStatus());
		assertThat(result.getRoleCode()).isEqualTo(model.roleCode());
		assertThat(result.getScopeCode()).isEqualTo(model.scopeCode());
	}

	@Test
	void shouldMapRequestToModelTest() {
		// Given:
		Long userId = Instancio.create(Long.class);
		AssignRoleRequestV1 request = Instancio.create(AssignRoleRequestV1.class);
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);

		// When:
		AssignRoleModel result = mapper.fromV1(userId, request, currentUser);

		// Then:
		assertThat(result.userId()).isEqualTo(userId);
		assertThat(result.roleCode()).isEqualTo(request.getRoleCode());
		assertThat(result.scopeCode()).isEqualTo(request.getScopeCode());
		assertThat(result.scopeId()).isEqualTo(request.getScopeId());
		assertThat(result.actingUserId()).isEqualTo(currentUser.id());
	}
}
