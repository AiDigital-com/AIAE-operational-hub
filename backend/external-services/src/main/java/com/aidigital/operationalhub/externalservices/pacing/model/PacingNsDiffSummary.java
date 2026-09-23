package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The small nightly-summary shape Pacing rides along on each {@code GET /api/pacings} row's
 * {@code ns_diff} key (§13 of the migration plan, US-136), as opposed to the full live report
 * ({@link PacingNsDiffReport}) a caller fetches on demand for one pacing.
 *
 * <p>Written by a nightly job that only walks {@code Live} pacings, and never clears or invalidates
 * this stored value when a pacing later leaves {@code Live} (Complete/Archived). On a non-Live
 * pacing this is therefore a FROZEN reading from its last night as Live, not a live figure — treat
 * {@code computedAt} as "checked on this date", never as "current as of now". Can be entirely
 * {@code null} on a pacing the nightly job has never covered.
 *
 * @param counts   how many differences of each class, as of {@code computedAt}
 * @param inSync   serialized as {@code in_sync}; whether every class's count was zero at that time
 * @param computedAt serialized as {@code computed_at}; an ISO-8601 instant naming when the nightly
 *                   job last computed this summary — see the class-level frozen-value caveat above
 */
public record PacingNsDiffSummary(
		PacingNsDiffCounts counts,
		@JsonProperty("in_sync") boolean inSync,
		@JsonProperty("computed_at") String computedAt) {
}
