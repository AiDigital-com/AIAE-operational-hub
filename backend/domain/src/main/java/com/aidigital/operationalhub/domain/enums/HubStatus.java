package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Canonical status dictionary codes used across Operational Hub RBAC tables.
 *
 * <p>Values are persisted as TEXT columns; this enum centralizes the code and display label without
 * using PostgreSQL enum types.
 */
@Getter
@RequiredArgsConstructor
public enum HubStatus {

	/**
	 * Entity is active and effective.
	 */
	ACTIVE("ACTIVE", "Active"),

	/**
	 * Entity is inactive and not effective.
	 */
	INACTIVE("INACTIVE", "Inactive"),

	/**
	 * Entity is disabled.
	 */
	DISABLED("DISABLED", "Disabled"),

	/**
	 * Role assignment has been revoked and is no longer effective.
	 */
	REVOKED("REVOKED", "Revoked");

	private final String code;
	private final String displayName;
}
