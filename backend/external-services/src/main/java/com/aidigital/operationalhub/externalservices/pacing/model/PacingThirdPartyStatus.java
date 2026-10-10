package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Where a pacing's CM360 read stands, as {@code GET /api/dashboards/:slug/third-party/status}
 * returns it.
 *
 * <p>Pacing answers this off the HEAD of the published file rather than by parsing it, because a
 * widget polls this every few seconds while a fetch is in flight and a complete file runs to tens
 * of megabytes. That is why the row count and campaigns are here at all: they are the two facts
 * worth having without paying for the rows.
 *
 * @param ok         Pacing's own envelope flag; false never reaches here as a value, it arrives as
 *                   an HTTP error instead
 * @param state      one of {@code none}, {@code pending}, {@code ready}, {@code error}
 * @param fetchedAt  serialized as {@code fetched_at} - when the run that produced the file READ the
 *                   pacing's configuration, not when the file was written; a settings save newer
 *                   than this keeps the pacing pending
 * @param rowCount   serialized as {@code row_count}; null when no file is published
 * @param campaigns  the campaigns the file was fetched for; null when no file is published
 */
public record PacingThirdPartyStatus(
		boolean ok,
		String state,
		@JsonProperty("fetched_at") String fetchedAt,
		@JsonProperty("row_count") Integer rowCount,
		List<String> campaigns) {
}
