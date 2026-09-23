package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * The full response of Pacing's {@code GET /api/pacings/:id/ns-diff} (§13 of the migration plan,
 * US-136 "NetSuite Diff and Data Health") — a read-only, on-demand, LIVE comparison of one pacing
 * against current NetSuite data, computed fresh on every call, never cached on the Pacing side.
 *
 * <p>Unlike {@code /revalidate}, this endpoint is not admin-only: any caller with ordinary dashboard
 * access to the pacing may call it. See {@link PacingNsDiffSummary} for the small nightly-computed
 * counterpart carried on each {@code GET /api/pacings} row.
 *
 * @param ok                  whether Pacing could compute the diff
 * @param pacingId            serialized as {@code pacing_id}
 * @param dashSlug            serialized as {@code dash_slug}
 * @param classes             every diff class Pacing evaluated, e.g. {@code missing_in_netsuite},
 *                            {@code field_diff} — the same six names {@link #counts()}'s fields cover
 * @param counts              how many differences of each class were found
 * @param inSync              serialized as {@code in_sync}; whether every class's count is zero
 * @param notCheckedLineItems serialized as {@code not_checked_line_items}; line item ids this run
 *                            could not evaluate (e.g. a manually-added id with no NetSuite
 *                            counterpart to compare against); may be null
 * @param missingInNetsuite   serialized as {@code missing_in_netsuite}
 * @param missingInPacing     serialized as {@code missing_in_pacing}
 * @param fieldDiff           serialized as {@code field_diff}
 * @param planDiff            serialized as {@code plan_diff}
 * @param foreignCampaign     serialized as {@code foreign_campaign}
 * @param ownerDiff           serialized as {@code owner_diff}
 */
public record PacingNsDiffReport(
		boolean ok,
		@JsonProperty("pacing_id") String pacingId,
		@JsonProperty("dash_slug") String dashSlug,
		List<String> classes,
		PacingNsDiffCounts counts,
		@JsonProperty("in_sync") boolean inSync,
		@JsonProperty("not_checked_line_items") List<String> notCheckedLineItems,
		@JsonProperty("missing_in_netsuite") List<PacingNsDiffMissingInNetsuite> missingInNetsuite,
		@JsonProperty("missing_in_pacing") List<PacingNsDiffMissingInPacing> missingInPacing,
		@JsonProperty("field_diff") List<PacingNsDiffLineItemFields> fieldDiff,
		@JsonProperty("plan_diff") List<PacingNsDiffLineItemFields> planDiff,
		@JsonProperty("foreign_campaign") List<PacingNsDiffForeignCampaign> foreignCampaign,
		@JsonProperty("owner_diff") List<PacingNsDiffOwnerMismatch> ownerDiff) {
}
