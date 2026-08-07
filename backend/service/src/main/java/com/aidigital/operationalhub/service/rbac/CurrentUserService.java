package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

/**
 * Resolves the current Hub user from the active Clerk JWT and provisions Hub user rows on demand.
 */
public interface CurrentUserService {

	/**
	 * Resolves the current Hub user from the active Spring Security context.
	 *
	 * <p>Reads the Clerk subject ({@code sub} claim) from the authenticated JWT, then finds or
	 * creates the corresponding {@code hub_users} row. Role claims from the token are never trusted.
	 *
	 * @return the resolved current Hub user
	 */
	CurrentUserModel resolveCurrentUser();

	/**
	 * Finds the Hub user for the given Clerk identifier, creating an active row if none exists.
	 *
	 * @param clerkUserId the Clerk {@code sub} identifier; must not be {@code null} or blank
	 * @param email       the user's email from the token claims, used when creating a new row
	 * @param displayName the optional display name from the token claims, may be {@code null}
	 * @return the existing or newly created Hub user
	 */
	CurrentUserModel findOrCreateByClerkUserId(String clerkUserId, String email, String displayName);
}
