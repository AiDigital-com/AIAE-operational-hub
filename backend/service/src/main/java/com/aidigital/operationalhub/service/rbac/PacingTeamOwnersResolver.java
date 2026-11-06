package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Resolves who counts as "my team" for the Overview's My team filter: the owners whose pacings that
 * view keeps.
 *
 * <p>A view filter, not a permission. It never widens what the user sees - the Overview applies it to
 * the list the user's {@link PacingScopeResolver} entitlement already returned. That is also why it
 * is resolved separately from the entitlement: an admin is entitled to everything, yet still has a
 * team to narrow to.
 */
public interface PacingTeamOwnersResolver {

	/**
	 * Resolves the Pacing {@code user_id}s ({@code hub_users.pacing_user_id}) of the given user's team.
	 *
	 * <ul>
	 *   <li>Admin → every user holding an active {@code ADMIN} assignment, the user included
	 *   (owner decision: admins are each other's team).</li>
	 *   <li>Holding {@code TEAM}-scoped assignments → the user plus every user holding an active
	 *   assignment scoped to any of those teams - a member's or Team Lead's one team, a Director's
	 *   every team of their stream.</li>
	 *   <li>Anyone else → the user alone.</li>
	 * </ul>
	 * Users with no {@code pacing_user_id} yet own no pacing in Pacing and are left out.
	 *
	 * @param user the current user
	 * @return the team's Pacing user ids, without repeats; empty when nobody in it is synced to Pacing
	 */
	List<String> resolveTeamOwnerIds(CurrentUserModel user);
}
