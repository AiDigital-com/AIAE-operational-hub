package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * One distinct value - or combination of values, when several columns were asked for - and how much
 * of the file carries it.
 *
 * @param values the cell values, in the same order as the requested columns
 * @param rows   how many rows carry this combination
 */
public record PacingDimSourceValue(
		List<String> values,
		int rows) {
}
