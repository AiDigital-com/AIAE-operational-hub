package com.aidigital.operationalhub.service.rbac.model;

import java.util.List;

/**
 * The Pacing-service scope asserted on every call to Pacing: exactly one of {@value #KIND_ALL} (no
 * filtering), {@value #KIND_OWNERS} (a set of Pacing {@code user_id} UUIDs), or {@value
 * #KIND_CAMPAIGNS} (a set of NetSuite campaign ids) — matching the contract enforced by dash-gate's
 * {@code normalizeScope}.
 *
 * <p>{@code ids} holds Pacing {@code user_id}s (as text) for {@value #KIND_OWNERS} and NetSuite
 * campaign ids for {@value #KIND_CAMPAIGNS}; it is always empty for {@value #KIND_ALL}. An empty
 * {@code ids} list under {@value #KIND_OWNERS} or {@value #KIND_CAMPAIGNS} is legal and means
 * "entitled to nothing" — Pacing answers with an empty list, not an error.
 *
 * <p>{@value #KIND_OWNERS} carried email addresses until the §1→§2 follow-up: UUIDs need {@code
 * hub_users.pacing_user_id} to exist, which only §2 (the employee sync) populates — see {@link
 * com.aidigital.operationalhub.service.rbac.impl.PacingScopeResolverImpl} for the full reasoning and
 * the resulting deploy-order dependency.
 *
 * @param kind the scope kind
 * @param ids  the owner Pacing user_ids or campaign ids the scope is restricted to; empty for
 *             {@code all}
 * @since 1.0
 */
public record PacingScope(String kind, List<String> ids) {

	/**
	 * No filtering: sees every pacing.
	 */
	public static final String KIND_ALL = "all";

	/**
	 * Restricted to pacings owned by a set of Pacing user_ids (UUIDs, as text).
	 */
	public static final String KIND_OWNERS = "owners";

	/**
	 * Restricted to pacings under a set of NetSuite campaign ids.
	 */
	public static final String KIND_CAMPAIGNS = "campaigns";

	public PacingScope {
		ids = ids == null ? List.of() : List.copyOf(ids);
	}

	/**
	 * Builds an unrestricted, {@value #KIND_ALL} scope.
	 *
	 * @return the unrestricted scope
	 */
	public static PacingScope all() {
		return new PacingScope(KIND_ALL, List.of());
	}

	/**
	 * Builds a {@value #KIND_OWNERS} scope restricted to the given owner Pacing user_ids.
	 *
	 * @param ownerUserIds the Pacing user_ids (UUIDs, as text) the scope is restricted to; may be empty
	 *                     ("entitled to nothing")
	 * @return the owners scope
	 */
	public static PacingScope owners(List<String> ownerUserIds) {
		return new PacingScope(KIND_OWNERS, ownerUserIds);
	}

	/**
	 * Builds a {@value #KIND_CAMPAIGNS} scope restricted to the given NetSuite campaign ids.
	 *
	 * <p>Not produced by {@code PacingScopeResolver} yet: real Client Services scoping needs
	 * {@code pacings.campaign_ids}, which is not available on the Hub side until §3 of the migration
	 * plan lands. Kept here for the contract's symmetry with dash-gate's {@code normalizeScope}.
	 *
	 * @param campaignIds the NetSuite campaign ids the scope is restricted to
	 * @return the campaigns scope
	 */
	public static PacingScope campaigns(List<String> campaignIds) {
		return new PacingScope(KIND_CAMPAIGNS, campaignIds);
	}
}
