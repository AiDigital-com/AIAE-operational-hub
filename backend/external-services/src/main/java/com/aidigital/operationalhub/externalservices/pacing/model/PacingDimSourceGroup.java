package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * One proposed grouping - a name, and the spellings that would read as it.
 *
 * @param label   what the group would be called
 * @param members the values it would absorb
 */
public record PacingDimSourceGroup(
		String label,
		List<String> members) {
}
