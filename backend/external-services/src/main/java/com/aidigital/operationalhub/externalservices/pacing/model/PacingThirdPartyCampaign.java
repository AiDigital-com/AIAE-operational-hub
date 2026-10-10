package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One CM360 campaign in the picker list.
 *
 * @param name     the campaign name exactly as the ad-server export spells it - a saved source
 *                 stores this string, so it must not be normalised on the way through
 * @param report   the report it was pulled under; the same campaign legitimately appears under
 *                 several, which is why a source names both
 * @param lastSeen serialized as {@code last_seen} - the most recent date the export has a row for
 * @param imp      impressions across the whole export, which is how the list is ranked
 */
public record PacingThirdPartyCampaign(
		String name,
		String report,
		@JsonProperty("last_seen") String lastSeen,
		Long imp) {
}
