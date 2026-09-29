package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Wire shape of {@code POST /api/internal/pacing-audience}'s response.
 *
 * <p>An unknown pacing id does not fail the batch on Pacing's side (its roster and the Hub's can
 * briefly disagree around a deletion); it is skipped there and reported back by name here so the
 * Hub can log the drift instead of mistaking a partial apply for a full one.
 *
 * @param stats            what the upsert actually did
 * @param unknownPacingIds serialized as {@code unknown_pacing_ids}; the pacing ids Pacing skipped
 *                         because it has no such pacing
 */
public record PacingAudiencePushResult(
		PacingAudiencePushStats stats,
		@JsonProperty("unknown_pacing_ids") List<String> unknownPacingIds) {
}
