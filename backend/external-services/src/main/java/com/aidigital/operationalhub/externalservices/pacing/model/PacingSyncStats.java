package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Pacing's own account of what a {@code POST /api/internal/users/sync} call actually did, keyed by
 * transition rather than by what was merely sent.
 *
 * <p>This is why the Hub no longer computes {@code deactivated} itself: only Pacing sees a row's
 * previous state (it holds the table), so only Pacing can tell "sent with active=false" apart from
 * "was active, is now not" — the first is true on every re-run forever, the second is a real event.
 * See {@code PacingUserSyncReconciler} for how these feed {@code PacingUserSyncSummary}.
 *
 * @param created     rows that did not exist in Pacing before this call
 * @param activated   rows that were {@code active = false} and are now {@code true}
 * @param deactivated rows that were {@code active = true} and are now {@code false}
 * @param unchanged   rows that matched an existing row and whose active flag did not change
 */
public record PacingSyncStats(int created, int activated, int deactivated, int unchanged) {
}
