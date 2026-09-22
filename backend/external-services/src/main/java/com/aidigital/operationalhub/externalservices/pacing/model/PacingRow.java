package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * One row of Pacing's {@code GET /api/pacings} response, restricted to the fields the Overview
 * screen (§4 of the migration plan, US-109/110/111) and the pacing administration screen need.
 * Pacing's actual row also carries {@code owner_id}, {@code client}, {@code agency},
 * {@code delegated_to}/{@code delegated_from}, {@code liNames}/{@code liDesc} and
 * {@code heatmapMode}; none of those are read here because neither screen uses them yet — see
 * {@code PacingContractMapper} for the public (Hub-facing) shape this is mapped to.
 *
 * @param pacingId       serialized as {@code pacing_id}
 * @param pacingName     serialized as {@code pacing_name}
 * @param status         administrative lifecycle status: {@code Live} | {@code Paused} |
 *                       {@code Complete} | {@code Archive}
 * @param flightStart    serialized as {@code flight_start}; null if unresolved
 * @param flightEnd      serialized as {@code flight_end}; null if unresolved
 * @param ownerName      serialized as {@code owner_name}
 * @param lineItemCount  serialized as {@code line_item_count}
 * @param campaigns      ordered campaigns this pacing belongs to (§3); null when campaign
 *                       resolution has not run for this pacing yet
 * @param health         health figures computed by {@code computeHealthBatch}; null only if Pacing
 *                       was asked to skip health computation, which the Hub never does
 * @param dashSlug       serialized as {@code dash_slug} - Pacing's own routing key for this pacing's
 *                       dashboard (§6 of the migration plan); read here so the Overview/campaign-tab
 *                       row can carry it through to a click that opens the dashboard
 * @param createdAt      serialized as {@code created_at} - an ISO-8601 timestamp string, straight off
 *                       Pacing's own row; used only by the pacing administration screen (not in the
 *                       migration plan), which is the one place this project shows when a pacing was
 *                       created
 * @param nsDiffSummary  serialized as {@code ns_diff} (§13 of the migration plan, US-136); the
 *                       nightly job's frozen NetSuite-diff summary — see {@link PacingNsDiffSummary}'s
 *                       own javadoc for why it is not "current as of now". Null on a pacing the
 *                       nightly job has never covered.
 */
public record PacingRow(
		@JsonProperty("pacing_id") String pacingId,
		@JsonProperty("pacing_name") String pacingName,
		String status,
		@JsonProperty("flight_start") String flightStart,
		@JsonProperty("flight_end") String flightEnd,
		@JsonProperty("owner_name") String ownerName,
		@JsonProperty("line_item_count") Integer lineItemCount,
		List<PacingCampaignRef> campaigns,
		PacingHealth health,
		@JsonProperty("dash_slug") String dashSlug,
		@JsonProperty("created_at") String createdAt,
		@JsonProperty("ns_diff") PacingNsDiffSummary nsDiffSummary) {
}
