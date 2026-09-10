package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The identifiers of a freshly created pacing, as {@code POST /api/pacings} returns them on success
 * (§8 of the migration plan, US-123).
 *
 * @param pacingId the new pacing's id (Pacing's own UUID primary key)
 * @param dashSlug the new pacing's dash_slug
 */
public record PacingCreateResult(String pacingId, String dashSlug) {
}
