package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One live (non-archived) pacing that already covers a given line item, as Pacing's validate response
 * returns it under {@code inUse} (§8 of the migration plan, US-123). Already camelCase on the wire
 * (built by dash-gate's {@code findLineItemsInUse}) - no {@code @JsonProperty} translation needed.
 *
 * <p>Advisory, not a ban: a line item may legitimately belong to more than one pacing. This only
 * names the first one found (by creation order), so the create screen can mark and un-tick it by
 * default while still allowing it to be selected.
 *
 * @param pacingId   the other pacing's id
 * @param pacingName the other pacing's display name
 * @param dashSlug   the other pacing's dash_slug
 * @param status     the other pacing's administrative lifecycle status
 */
public record PacingInUseEntry(String pacingId, String pacingName, String dashSlug, String status) {
}
