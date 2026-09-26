package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One free-text note on a pacing (§15 of the migration plan, US-139).
 *
 * @param id       journal entry id
 * @param ts       the note's own timestamp string, as Pacing stored it
 * @param msg      the note text
 * @param uid      the author's email, or empty if unresolved
 * @param userId   the author's Pacing user id (UUID, as text), serialized as {@code user_id}; null if
 *                 unresolved. Never forwarded to the browser as-is - the Hub uses it only to compute
 *                 {@code canEdit} on the generated contract shape.
 * @param editedAt serialized as {@code edited_at}; null if never edited
 */
public record PacingJournalEntry(
		String id,
		String ts,
		String msg,
		String uid,
		@JsonProperty("user_id") String userId,
		@JsonProperty("edited_at") String editedAt) {
}
