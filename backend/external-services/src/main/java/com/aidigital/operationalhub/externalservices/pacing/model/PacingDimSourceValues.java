package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * The distinct values of up to three columns of a sheet tab.
 *
 * <p>This is what spares a person retyping a spelling: a mapping offers what is actually in the
 * file, and a typo typed by hand would drop rows silently at refresh time rather than announce
 * itself.
 *
 * @param columns      the headers that were read, in the order the values follow
 * @param values       one entry per distinct combination, most rows first
 * @param truncated    true when there were more distinct values than the service returns
 * @param scannedRows  how many rows were looked at
 */
public record PacingDimSourceValues(
		List<String> columns,
		List<PacingDimSourceValue> values,
		boolean truncated,
		@JsonProperty("scanned_rows") int scannedRows) {
}
