package com.aidigital.operationalhub.service.rbac.model;

/**
 * Immutable view of the resolved current Hub user.
 *
 * @param id          the {@code hub_users.id}
 * @param clerkUserId the Clerk {@code sub} identifier
 * @param email       the user's email
 * @param displayName the optional display name, may be {@code null}
 * @param status      the user status (e.g. {@code ACTIVE})
 * @since 1.0
 */
public record CurrentUserModel(Long id, String clerkUserId, String email, String displayName, String status) {

}
