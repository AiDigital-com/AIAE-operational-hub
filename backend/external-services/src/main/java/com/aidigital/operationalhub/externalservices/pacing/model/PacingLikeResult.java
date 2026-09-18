package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The outcome of liking/unliking a library entry (US-118) - {@code POST}/{@code DELETE}
 * {@code /api/library/:id/like}. Both directions are idempotent on the Pacing side.
 *
 * @param liked whether the calling user now likes this entry
 * @param likes the entry's total like count after the change
 */
public record PacingLikeResult(boolean liked, int likes) {
}
