package com.aidigital.operationalhub.service.rbac.model;

/**
 * Immutable command describing a role assignment to create.
 *
 * @param userId       the target user's {@code hub_users.id}
 * @param roleCode     the role code to assign (e.g. {@code TL})
 * @param scopeCode    the scope code (e.g. {@code TEAM})
 * @param scopeId      the scoped entity id, or {@code null} for unscoped scopes such as {@code ALL}
 * @param actingUserId the {@code hub_users.id} of the user performing the assignment
 * @since 1.0
 */
public record AssignRoleModel(
		Long userId, String roleCode, String scopeCode, Long scopeId, Long actingUserId) {

}
