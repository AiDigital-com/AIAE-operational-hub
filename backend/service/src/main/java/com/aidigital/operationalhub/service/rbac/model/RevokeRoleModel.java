package com.aidigital.operationalhub.service.rbac.model;

/**
 * Immutable command describing a role assignment to revoke.
 *
 * @param userId       the target user's {@code hub_users.id}
 * @param assignmentId the {@code hub_role_assignments.id} to revoke
 * @param actingUserId the {@code hub_users.id} of the user performing the revocation
 * @since 1.0
 */
public record RevokeRoleModel(Long userId, Long assignmentId, Long actingUserId) {

}
