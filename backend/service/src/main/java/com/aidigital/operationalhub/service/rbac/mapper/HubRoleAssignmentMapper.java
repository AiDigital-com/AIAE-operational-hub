package com.aidigital.operationalhub.service.rbac.mapper;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;

/**
 * Service-layer mapper between {@link HubRoleAssignment} entities and RBAC service models.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface HubRoleAssignmentMapper {

	/**
	 * Builds a new {@link HubRoleAssignment} entity from a validated assignment command.
	 *
	 * <p>Identity and audit timestamps are left unset; they are assigned by the persistence/service
	 * layer on save.
	 *
	 * @param command  the assignment command
	 * @param resolved the resolved role and scope-type rows
	 * @param userId   the target user's {@code hub_users.id}
	 * @param status   the initial status code
	 * @return the new, unsaved assignment entity
	 */
	@Mapping(target = "id", ignore = true)
	@Mapping(target = "userId", source = "userId")
	@Mapping(target = "role", source = "resolved.role")
	@Mapping(target = "scopeType", source = "resolved.scopeType")
	@Mapping(target = "scopeId", source = "command.scopeId")
	@Mapping(target = "status", source = "status")
	@Mapping(target = "createdByUserId", source = "command.actingUserId")
	@Mapping(target = "createdAt", ignore = true)
	@Mapping(target = "updatedAt", ignore = true)
	HubRoleAssignment toNewAssignment(
			AssignRoleModel command, ResolvedAssignment resolved, Long userId, String status);

	/**
	 * Wraps an assignment entity into a {@link RoleAssignmentModel}, deriving the dictionary codes
	 * from its {@code role} and {@code scopeType} associations.
	 *
	 * @param assignment the assignment entity to wrap
	 * @return the enriched assignment model
	 */
	@Mapping(target = "assignment", source = "assignment")
	@Mapping(target = "roleCode", source = "role.roleCode")
	@Mapping(target = "scopeCode", source = "scopeType.scopeCode")
	RoleAssignmentModel toModel(HubRoleAssignment assignment);
}
