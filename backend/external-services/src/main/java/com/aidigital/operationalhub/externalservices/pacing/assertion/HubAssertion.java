package com.aidigital.operationalhub.externalservices.pacing.assertion;

import java.util.List;

/**
 * Everything needed to build and sign one {@code X-Hub-Assertion} header for a call to Pacing: who is
 * calling, what they may see, and whether they may create a pacing.
 *
 * <p>A transport-level value only — it carries no RBAC domain knowledge of its own, it is simply what
 * {@code PacingScope}/{@code PacingEntitlement} (service module) get translated into at the boundary.
 *
 * @param email      the asserted user's email address; Pacing resolves the ACTING user via
 *                   {@code lower(email)} against its own {@code access.users} — the header keeps this
 *                   field for that purpose even though {@code scopeIds} no longer carries emails
 * @param scopeKind  the scope kind: {@value #KIND_ALL}, {@value #KIND_OWNERS}, or
 *                   {@value #KIND_CAMPAIGNS}
 * @param scopeIds   owner Pacing user_ids, UUIDs as text ({@value #KIND_OWNERS}) or NetSuite campaign
 *                   ids ({@value #KIND_CAMPAIGNS}) the scope is restricted to; ignored for
 *                   {@value #KIND_ALL}
 * @param canCreate  whether the user may create a pacing
 * @since 1.0
 */
public record HubAssertion(String email, String scopeKind, List<String> scopeIds, boolean canCreate) {

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

	public HubAssertion {
		scopeIds = scopeIds == null ? List.of() : List.copyOf(scopeIds);
	}
}
