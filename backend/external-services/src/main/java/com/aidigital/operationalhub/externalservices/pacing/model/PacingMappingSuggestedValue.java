package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * One proposed value, and the other spellings that should match it.
 *
 * @param value    the value's own name
 * @param aliases  spellings that should also match it; may be empty
 */
public record PacingMappingSuggestedValue(
		String value,
		List<String> aliases) {
}
