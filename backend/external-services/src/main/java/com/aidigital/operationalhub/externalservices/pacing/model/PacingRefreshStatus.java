package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Whether/when a pacing's last data refresh landed, as {@code GET /api/dashboards/:slug/refresh-status}
 * returns it (US-119). A completion read, not an in-progress flag - a caller detects completion by
 * polling until {@code refreshId} changes from a baseline captured before triggering.
 *
 * @param exists     whether any data has ever been built for this pacing
 * @param refreshId  serialized as {@code refresh_id}; null if {@code exists} is false
 * @param rowCount   serialized as {@code row_count}
 * @param latestDate serialized as {@code latest_date}; null if {@code exists} is false
 */
public record PacingRefreshStatus(
		boolean exists,
		@JsonProperty("refresh_id") String refreshId,
		@JsonProperty("row_count") Integer rowCount,
		@JsonProperty("latest_date") String latestDate) {
}
