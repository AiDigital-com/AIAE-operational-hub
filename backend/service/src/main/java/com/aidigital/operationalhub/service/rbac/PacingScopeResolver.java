package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;

/**
 * Resolves which pacings a user may see, translating their Hub RBAC role assignments into the
 * {@link PacingEntitlement} asserted on every call to the Pacing service.
 *
 * <p>This is the Hub-side half of the Hub→Pacing contract: Pacing does not resolve access itself, it
 * enforces a decision this resolver already made (see dash-gate's {@code verifyAssertion} /
 * {@code normalizeScope}). Getting this wrong in the direction of "sees more than it should" is the
 * worst possible failure mode here, so every non-admin path must resolve to {@code owners} (never
 * {@code all}), even when that means "entitled to nothing".
 */
public interface PacingScopeResolver {

	/**
	 * Resolves the given user's Hub RBAC access into a Pacing entitlement.
	 *
	 * <ul>
	 *   <li>Admin, or holding any {@code ALL}-scoped role assignment (how {@code DIRECTOR} is
	 *   provisioned) → unrestricted ({@code kind=all}).</li>
	 *   <li>Holding one or more {@code TEAM}-scoped assignments → {@code owners} restricted to the
	 *   Pacing {@code user_id} ({@code hub_users.pacing_user_id}) of every Hub user holding an active
	 *   assignment scoped to any of those teams, including the acting user's own id. A member whose
	 *   {@code pacing_user_id} is still {@code null} (the §2 sync has not reached them yet) is omitted
	 *   rather than included as a broken id — see the implementation for why that is logged, not
	 *   silent.</li>
	 *   <li>{@code CLIENT_SERVICES} → {@code owners} with an empty id list ("entitled to nothing"):
	 *   real Client Services scoping needs {@code pacings.campaign_ids}, not available yet.</li>
	 *   <li>No active role assignment at all → {@code owners} with an empty id list.</li>
	 * </ul>
	 *
	 * @param user the current user
	 * @return the user's resolved Pacing entitlement
	 */
	PacingEntitlement resolveForCurrentUser(CurrentUserModel user);
}
