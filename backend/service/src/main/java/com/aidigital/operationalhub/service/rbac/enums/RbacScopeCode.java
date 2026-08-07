package com.aidigital.operationalhub.service.rbac.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Canonical RBAC scope dictionary codes.
 */
@Getter
@RequiredArgsConstructor
public enum RbacScopeCode {

	/**
	 * Scope points to the target user's own hub_users.id.
	 */
	OWN("OWN", "Own", true, true),

	/**
	 * Scope points to a hub_teams.id.
	 */
	TEAM("TEAM", "Team", true, true),

	/**
	 * Global scope; scope_id must be null.
	 */
	ALL("ALL", "All", false, true),

	/**
	 * Agency scope, seeded but not assignable yet.
	 */
	AGENCY("AGENCY", "Agency", true, false),

	/**
	 * Client scope, seeded but not assignable yet.
	 */
	CLIENT("CLIENT", "Client", true, false);

	private final String code;
	private final String displayName;
	private final boolean scoped;
	private final boolean assignable;
}
