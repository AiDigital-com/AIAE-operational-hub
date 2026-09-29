package com.aidigital.operationalhub.service.pacingsync.model;

/**
 * Outcome of a Pacing audience push run.
 *
 * <p>{@code created}, {@code replaced} and {@code unknown} come straight from Pacing's own response
 * stats: only Pacing sees whether a pacing already had a stored audience row, so the Hub does not
 * re-derive them from what it sent (the same division of knowledge as
 * {@link PacingUserSyncSummary}).
 *
 * @param pacingsSent      number of pacings included in the push
 * @param created          pacings that received their first-ever audience row
 * @param replaced         pacings whose stored list was replaced (the routine daily case)
 * @param unknown          entries Pacing skipped as unknown pacing ids (roster drift; logged)
 * @param ownersUnresolved pacings whose owner id matched no Hub employee's {@code pacing_user_id} —
 *                         they were still pushed with a globals-only audience, but the gap is worth
 *                         logging because it usually means the §2 user sync is behind
 */
public record PacingAudienceSyncSummary(
		int pacingsSent, int created, int replaced, int unknown, int ownersUnresolved) {
}
