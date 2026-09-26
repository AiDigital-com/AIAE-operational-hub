package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * The signed JSON payload shape, field order matching dash-gate's assertion payload exactly.
 *
 * @param email     the asserted user's email
 * @param scope     the scope map ({@code kind}, then {@code ids} when present)
 * @param canCreate serialized as {@code can_create}
 * @param exp       expiry, epoch milliseconds
 */
record Payload(
		String email,
		Map<String, Object> scope,
		@JsonProperty("can_create") boolean canCreate,
		long exp) {
}
