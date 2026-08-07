package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Collaborator that validates {@link AssignRoleModel} requests and resolves dictionary rows.
 */
@Component
@RequiredArgsConstructor
public class RoleAssignmentValidator {

	private final HubRoleService hubRoleService;
	private final HubTeamService hubTeamService;
	private final HubScopeTypeService hubScopeTypeService;

	/**
	 * Validates the command and resolves the referenced dictionary rows.
	 *
	 * @param command the assignment command to validate
	 * @return the resolved role and scope-type rows
	 * @throws BusinessException if the command is invalid or references unknown dictionaries
	 */
	public ResolvedAssignment validate(AssignRoleModel command) {
		if (command == null) {
			throw new BusinessException(OperationalHubErrorReason.OPH_001);
		}
		if (command.userId() == null) {
			throw new BusinessException(OperationalHubErrorReason.OPH_002);
		}
		HubRole role = hubRoleService.existingByRoleCode(command.roleCode());
		HubScopeType scopeType = hubScopeTypeService.existingByScopeCode(command.scopeCode());
		validateScope(command, scopeType.getScopeCode());
		return new ResolvedAssignment(role, scopeType);
	}

	/**
	 * Validates the command's scope id against the rules of the resolved scope code.
	 *
	 * @param command        the assignment command being validated
	 * @param scopeCodeValue the resolved scope code value
	 * @throws BusinessException if the scope code is unknown or the scope id is invalid for it
	 */
	void validateScope(AssignRoleModel command, String scopeCodeValue) {
		RbacScopeCode scopeCode;
		try {
			scopeCode = RbacScopeCode.valueOf(scopeCodeValue);
		} catch (IllegalArgumentException ex) {
			throw new BusinessException(OperationalHubErrorReason.OPH_007, scopeCodeValue);
		}
		switch (scopeCode) {
			case ALL -> requireNullScopeId(command);
			case OWN -> requireScopeIdEqualsUser(command);
			case TEAM -> requireExistingTeam(command);
			case AGENCY, CLIENT -> throw new BusinessException(
					OperationalHubErrorReason.OPH_012, scopeCode.getCode());
			default -> throw new AppException("Unhandled scope code: %s", scopeCode.getCode());
		}
	}

	/**
	 * Requires the command to carry no scope id, as mandated by global scopes such as {@code ALL}.
	 *
	 * @param command the assignment command being validated
	 * @throws BusinessException if a scope id is present
	 */
	void requireNullScopeId(AssignRoleModel command) {
		if (command.scopeId() != null) {
			throw new BusinessException(OperationalHubErrorReason.OPH_008);
		}
	}

	/**
	 * Requires the command's scope id to equal its target user id, as mandated by the {@code OWN} scope.
	 *
	 * @param command the assignment command being validated
	 * @throws BusinessException if the scope id does not match the user id
	 */
	void requireScopeIdEqualsUser(AssignRoleModel command) {
		if (!command.userId().equals(command.scopeId())) {
			throw new BusinessException(OperationalHubErrorReason.OPH_009);
		}
	}

	/**
	 * Requires the command's scope id to reference an existing team, as mandated by the {@code TEAM} scope.
	 *
	 * @param command the assignment command being validated
	 * @throws BusinessException if the scope id is missing or references an unknown team
	 */
	void requireExistingTeam(AssignRoleModel command) {
		Long scopeId = command.scopeId();
		if (scopeId == null) {
			throw new BusinessException(OperationalHubErrorReason.OPH_010);
		}
		if (!hubTeamService.existsById(scopeId)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_011, scopeId);
		}
	}
}
