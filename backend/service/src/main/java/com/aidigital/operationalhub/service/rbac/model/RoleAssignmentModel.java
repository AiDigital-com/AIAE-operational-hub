package com.aidigital.operationalhub.service.rbac.model;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;

/**
 * Read model of a single RBAC role assignment.
 *
 * <p>Wraps the {@link HubRoleAssignment} entity (composition) and surfaces the dictionary codes from
 * its {@code role}/{@code scopeType} associations as flat values for convenient contract mapping.
 *
 * @param assignment the underlying role assignment entity
 * @param roleCode   the assigned role code (e.g. {@code TL})
 * @param scopeCode  the scope code (e.g. {@code TEAM})
 * @since 1.0
 */
public record RoleAssignmentModel(HubRoleAssignment assignment, String roleCode, String scopeCode) {

}
