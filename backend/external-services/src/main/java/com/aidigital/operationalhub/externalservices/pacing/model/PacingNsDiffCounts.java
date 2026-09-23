package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * How many differences of each class Pacing's NetSuite diff found for one pacing (§13 of the
 * migration plan, US-136). The same six counters appear both on the full live report
 * ({@link PacingNsDiffReport#counts()}) and on the nightly-summary shape carried on each
 * {@code GET /api/pacings} row ({@link PacingNsDiffSummary#counts()}) — named fields, not a generic
 * map, matching how a small fixed key set is modeled elsewhere in this package (e.g.
 * {@link PacingCampaignRef}).
 *
 * @param missingInNetsuite serialized as {@code missing_in_netsuite} — line items Pacing has that
 *                          NetSuite does not
 * @param missingInPacing   serialized as {@code missing_in_pacing} — NetSuite line items not yet on
 *                          this pacing
 * @param fieldDiff         serialized as {@code field_diff} — line items present on both sides with a
 *                          mismatched descriptive/flight field
 * @param planDiff          serialized as {@code plan_diff} — line items present on both sides with a
 *                          mismatched plan figure (target impressions/spend)
 * @param foreignCampaign   serialized as {@code foreign_campaign} — line items whose NetSuite campaign
 *                          does not match this pacing's own campaign set
 * @param ownerDiff         serialized as {@code owner_diff} — campaigns whose pacing owner does not
 *                          match NetSuite's recorded team lead
 */
public record PacingNsDiffCounts(
		@JsonProperty("missing_in_netsuite") int missingInNetsuite,
		@JsonProperty("missing_in_pacing") int missingInPacing,
		@JsonProperty("field_diff") int fieldDiff,
		@JsonProperty("plan_diff") int planDiff,
		@JsonProperty("foreign_campaign") int foreignCampaign,
		@JsonProperty("owner_diff") int ownerDiff) {
}
