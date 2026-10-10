package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * One proposed dimension - a question the comparison would ask of both sides, and the answers it
 * would accept.
 *
 * @param name    what the dimension would be called
 * @param values  the values it would accept
 */
public record PacingMappingSuggestedDimension(
		String name,
		List<PacingMappingSuggestedValue> values) {
}
