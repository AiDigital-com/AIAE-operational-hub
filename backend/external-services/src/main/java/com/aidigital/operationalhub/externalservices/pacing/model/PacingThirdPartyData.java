package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * A pacing's published CM360 file, as {@code GET /api/dashboards/:slug/third-party/data} returns it
 * - the shape {@code Cm360Query.buildCm360FileContents} writes.
 *
 * <p>A record rather than a bare {@code Map}, like every other response in this client. That is not
 * only house style: {@code .body(Map.class)} hands Jackson a raw type with no element information
 * and the call failed with a transport-level exception rather than a usable body, which this
 * client's caller then reported as "Pacing is unreachable". Inside a record the generic types are
 * declared, so {@code rows} and {@code groups} convert the way {@code factsDaily} already does on
 * {@link PacingDashboardData}.
 *
 * <p>Rows stay opaque maps on purpose: they are ad-server columns that differ per report, and the
 * compare screens read them by name. Naming them here would mean this service holding an opinion
 * about a file it does not produce.
 *
 * @param fetchedAt    serialized as {@code fetched_at} - when the run that produced this file READ
 *                     the pacing's configuration, not when the file was written
 * @param campaigns    the flat union of every group's campaigns
 * @param groups       which report each campaign was pulled under; additive and diagnostic
 * @param status       Pacing's own marker, {@code ready} on a published file
 * @param droppedDupes serialized as {@code dropped_dupes} - main rows dropped because the audio
 *                     table carried the same key
 * @param rowCount     serialized as {@code row_count}; written before the rows so a reader that
 *                     needs only the small keys does not parse them
 * @param rows         the ad-server rows themselves
 */
public record PacingThirdPartyData(
		@JsonProperty("fetched_at") String fetchedAt,
		List<String> campaigns,
		List<Map<String, Object>> groups,
		String status,
		@JsonProperty("dropped_dupes") Integer droppedDupes,
		@JsonProperty("row_count") Integer rowCount,
		List<Map<String, Object>> rows) {
}
