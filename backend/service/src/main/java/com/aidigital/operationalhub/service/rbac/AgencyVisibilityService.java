package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

/**
 * Resolves which IO Lines agencies a user may see, translating their RBAC role assignments into an
 * {@link AgencyVisibility} that the BigQuery search services apply as an {@code agency_id} filter.
 */
public interface AgencyVisibilityService {

	/**
	 * Name of the cache holding the resolved {@link AgencyVisibility} keyed by {@code hub_users.id}.
	 *
	 * <p>Entries are evicted when a user's roles change (assign/revoke) and wholesale when a sync
	 * remaps team↔agency ownership; a time-to-live bounds staleness as a backstop.
	 */
	String AGENCY_VISIBILITY_CACHE = "agencyVisibilityByUserId";

	/**
	 * Resolves the agency visibility for the given user: unrestricted for admins and ALL-scoped roles,
	 * restricted to the agencies of the user's teams for TEAM-scoped roles, and "sees nothing" when the
	 * user has no granting role.
	 *
	 * @param user the current user
	 * @return the user's agency visibility
	 */
	AgencyVisibility resolveForCurrentUser(CurrentUserModel user);
}
