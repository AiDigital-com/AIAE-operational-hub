package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The other side of a delegation as Pacing decorates an Overview row with it (§12, US-135): a row's
 * {@code delegated_from} carries the delegator, each {@code delegated_to} entry a delegate. Display
 * metadata only — granting/extending/revoking delegations goes through {@code PacingDelegation}.
 *
 * @param name      the other person's display name
 * @param expiresAt serialized as {@code expires_at} — the {@code YYYY-MM-DD} day the grant lapses
 */
public record PacingDelegationRef(
		String name,
		@JsonProperty("expires_at") String expiresAt) {
}
