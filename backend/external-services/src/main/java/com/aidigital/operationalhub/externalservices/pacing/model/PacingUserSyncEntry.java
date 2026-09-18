package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One employee in a {@code POST /api/internal/users/sync} batch — the wire shape Pacing's
 * {@code validateUserSyncBody} expects, field for field.
 *
 * @param email        the employee's email address; Pacing upserts by this, matched
 *                     case-insensitively
 * @param name         display name
 * @param active       whether the Hub still considers this person an active employee; {@code false}
 *                     marks them inactive in Pacing without ever deleting their row (pacing
 *                     ownership, delegations and the journal all reference it)
 * @param slackUserId  serialized as {@code slack_user_id}; {@code null} when not known
 */
public record PacingUserSyncEntry(
		String email,
		String name,
		boolean active,
		@JsonProperty("slack_user_id") String slackUserId) {
}
