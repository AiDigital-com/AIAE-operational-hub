package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One line item Pacing has that current NetSuite data does not (§13 of the migration plan, US-136,
 * the {@code missing_in_netsuite} class of {@link PacingNsDiffReport}).
 *
 * @param lineItemId       serialized as {@code line_item_id}
 * @param channel          delivery channel / media tactic, as stored on the Pacing side
 * @param targetSpend      serialized as {@code target_spend}; the plan's target spend, as stored on
 *                         the Pacing side
 * @param targetImpressions serialized as {@code target_impressions}; the plan's target impressions,
 *                          as stored on the Pacing side
 */
public record PacingNsDiffMissingInNetsuite(
		@JsonProperty("line_item_id") String lineItemId,
		String channel,
		@JsonProperty("target_spend") Double targetSpend,
		@JsonProperty("target_impressions") Double targetImpressions) {
}
