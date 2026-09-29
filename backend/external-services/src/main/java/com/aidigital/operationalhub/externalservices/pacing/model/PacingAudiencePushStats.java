package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The {@code stats} half of {@code POST /api/internal/pacing-audience}'s response: what Pacing's
 * upsert actually did, computed on its side from the previous row state.
 *
 * @param created  pacings that received their first-ever audience row
 * @param replaced pacings whose stored audience list was replaced (the routine daily case)
 * @param unknown  entries Pacing skipped because it has no such pacing (see
 *                 {@link PacingAudiencePushResult#unknownPacingIds()})
 */
public record PacingAudiencePushStats(int created, int replaced, int unknown) {
}
