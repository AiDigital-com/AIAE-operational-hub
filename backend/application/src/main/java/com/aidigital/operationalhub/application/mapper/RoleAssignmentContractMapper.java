package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AssignRoleRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.RoleAssignmentV1;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link RoleAssignmentV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface RoleAssignmentContractMapper {

	/**
	 * Maps a {@link RoleAssignmentModel} to its generated DTO.
	 *
	 * @param view the role assignment view wrapping the entity and resolved codes
	 * @return the generated {@link RoleAssignmentV1}
	 */
	@Mapping(target = "id", source = "assignment.id")
	@Mapping(target = "userId", source = "assignment.userId")
	@Mapping(target = "scopeId", source = "assignment.scopeId")
	@Mapping(target = "status", source = "assignment.status")
	RoleAssignmentV1 toV1(RoleAssignmentModel view);

	/**
	 * Maps a list of {@link RoleAssignmentModel} to its generated DTO.
	 *
	 * @param assignments the role assignment views
	 * @return the generated list of {@link RoleAssignmentV1}
	 */
	List<RoleAssignmentV1> toV1(List<RoleAssignmentModel> assignments);

	/**
	 * Maps a {@link AssignRoleModel} from {@link AssignRoleRequestV1}.
	 *
	 * @param userId      the hub_users.id of the target user receiving the role assignment. (required)
	 * @param assignment  the role to assign
	 * @param currentUser the current user performing the assignment
	 * @return the generated {@link RoleAssignmentV1}
	 */
	@Mapping(target = "userId", source = "userId")
	@Mapping(target = "roleCode", source = "assignment.roleCode")
	@Mapping(target = "scopeCode", source = "assignment.scopeCode")
	@Mapping(target = "scopeId", source = "assignment.scopeId")
	@Mapping(target = "actingUserId", source = "currentUser.id")
	AssignRoleModel fromV1(Long userId, AssignRoleRequestV1 assignment, CurrentUserModel currentUser);
}
