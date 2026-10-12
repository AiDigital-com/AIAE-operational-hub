package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * What a re-read of a configured sheet source produced.
 *
 * <p>{@code rows} is lower than the sheet's own row count by design: rows are summed per day, line
 * item and dimension value, so several sheet rows become one stored row. {@code unboundRows} is the
 * number worth showing beside it - those rows named something that is not a line item of this
 * pacing and are left out of every figure.
 *
 * @param sourceId       the source that was read
 * @param rows           how many rows were stored
 * @param unboundRows    how many rows could not be attributed to a line item
 * @param unparsedCells  how many number cells could not be read as numbers
 * @param bytes          how large the stored file is
 * @param coverageHint   the last date the source carries data for, as {@code YYYY-MM-DD}, or null
 */
public record PacingDimSourceRead(
		@JsonProperty("source_id") String sourceId,
		int rows,
		@JsonProperty("unbound_rows") int unboundRows,
		@JsonProperty("unparsed_cells") int unparsedCells,
		long bytes,
		@JsonProperty("coverage_hint") String coverageHint) {
}
