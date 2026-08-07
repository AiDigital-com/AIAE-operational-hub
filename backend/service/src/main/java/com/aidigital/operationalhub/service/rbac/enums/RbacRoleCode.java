package com.aidigital.operationalhub.service.rbac.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Canonical RBAC role dictionary codes.
 */
@Getter
@RequiredArgsConstructor
public enum RbacRoleCode {

	/**
	 * Media Planning and Operations manager role.
	 */
	MPO_MANAGER("MPO_MANAGER", "MPO Manager", false),

	/**
	 * Team Lead role.
	 */
	TL("TL", "Team Lead", false),

	/**
	 * Director role.
	 */
	DIRECTOR("DIRECTOR", "Director", false),

	/**
	 * Administrator role; grants role management and full visibility.
	 */
	ADMIN("ADMIN", "Administrator", false),

	/**
	 * Client Services role, seeded for future workflows.
	 */
	CLIENT_SERVICES("CLIENT_SERVICES", "Client Services", true);

	private final String code;
	private final String displayName;
	private final boolean future;
}
