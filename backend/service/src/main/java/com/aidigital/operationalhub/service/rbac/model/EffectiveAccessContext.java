package com.aidigital.operationalhub.service.rbac.model;

import java.util.List;
import java.util.Set;

/**
 * Immutable, cacheable snapshot of a user's effective RBAC access.
 *
 * <p>This is the value stored in the {@code rbacEffectiveAccessByClerkUserId} cache. Its collections
 * are immutable (defensive copies taken in the compact constructor). The {@link RoleAssignmentModel}
 * elements wrap detached {@code HubRoleAssignment} entities read in a read-only transaction; callers
 * treat the context as a read-only snapshot and must not mutate the wrapped entities.
 *
 * @param clerkUserId    the Clerk {@code sub} identifier
 * @param userId         the {@code hub_users.id}
 * @param roleCodes      the distinct active role codes held by the user
 * @param assignments    the active role assignment views backing this context
 * @param admin          whether the user holds an active {@code ADMIN} assignment
 * @param canManageRoles whether the user may manage role assignments
 * @since 1.0
 */
public record EffectiveAccessContext(
		String clerkUserId,
		Long userId,
		Set<String> roleCodes,
		List<RoleAssignmentModel> assignments,
		boolean admin,
		boolean canManageRoles) {

	/**
	 * Canonical constructor taking defensive, immutable copies of the collection components so the
	 * cached context cannot be mutated by callers after construction.
	 */
	public EffectiveAccessContext {
		roleCodes = roleCodes == null ? Set.of() : Set.copyOf(roleCodes);
		assignments = assignments == null ? List.of() : List.copyOf(assignments);
	}
}
