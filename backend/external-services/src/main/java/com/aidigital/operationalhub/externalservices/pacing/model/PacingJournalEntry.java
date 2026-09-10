package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One free-text note on a pacing (§15 of the migration plan; read-only from §6's dashboard view).
 *
 * @param id       journal entry id
 * @param ts       the note's own timestamp string, as Pacing stored it
 * @param msg      the note text
 * @param uid      the author's email, or empty if unresolved
 * @param editedAt serialized as {@code edited_at}; null if never edited
 */
public record PacingJournalEntry(
		String id,
		String ts,
		String msg,
		String uid,
		@JsonProperty("edited_at") String editedAt) {
}
