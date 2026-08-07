package com.aidigital.operationalhub.service.rbac.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Clerk JWT claim names consumed by the service layer.
 */
@Getter
@RequiredArgsConstructor
public enum ClerkJwtClaim {

	/**
	 * Stable Clerk user id claim supplied by the {@code aidigital-api} JWT template.
	 */
	USER_ID("user_id"),

	/**
	 * User primary email claim.
	 */
	EMAIL("email"),

	/**
	 * User full display name claim supplied by the {@code aidigital-api} JWT template.
	 */
	FULL_NAME("full_name");

	private final String claimName;
}
