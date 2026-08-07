package com.aidigital.operationalhub.service.rbac.model;

/**
 * Read model backing the user-management listing: a Hub user plus its single active role code.
 *
 * <p>The schema permits multiple active assignments, but the single-active-role rule enforced on
 * assignment means {@code roleCode} carries the user's one current role, or {@code null} when the
 * user has none.
 *
 * @param hubUserId the {@code hub_users.id}
 * @param fullName  the user's display name, may be {@code null}
 * @param email     the user's email
 * @param status    the user's lifecycle status
 * @param roleCode  the user's current active role code, or {@code null} when unassigned
 * @param teamId    the team scoped by the active role, or {@code null} when the role is not TEAM-scoped
 */
public record HubUserSummaryModel(
		Long hubUserId, String fullName, String email, String status, String roleCode, Long teamId) {

}
