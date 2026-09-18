package com.aidigital.operationalhub.service.pacingsync.model;

/**
 * Outcome of a Pacing user sync run (§2 of the migration plan).
 *
 * <p>{@code createdInPacing}, {@code activated}, {@code deactivated} and {@code unchanged} all come
 * straight from Pacing's own {@code PacingSyncStats} (see {@code PacingUserSyncReconciler}): only
 * Pacing sees a row's previous state, so only Pacing can tell "sent with active=false" apart from "was
 * active, is now not" — the Hub does not re-derive either from what it sent.
 *
 * @param usersSent       number of Hub employees included in the batch sent to Pacing
 * @param createdInPacing number of rows Pacing had never seen before this run
 * @param activated       number of rows Pacing flipped from inactive to active this run
 * @param deactivated     number of rows Pacing flipped from active to inactive this run
 * @param unchanged       number of rows that matched an existing Pacing row and did not change
 * @param idsWritten      number of {@code hub_users} rows whose {@code pacing_user_id} was created or
 *                        corrected this run
 */
public record PacingUserSyncSummary(
		int usersSent, int createdInPacing, int activated, int deactivated, int unchanged, int idsWritten) {
}
