package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * A set of proposed mapping dimensions, as
 * {@code POST /api/dashboards/:slug/mapping/suggest-library} returns it.
 *
 * <p>DRAFTS. Pacing persists nothing here - the proposal exists only to be shown, and becomes real
 * only if someone accepts it and saves the mapping.
 *
 * <p>An empty list with a {@code notice} is a success, not a failure: today it means no model is
 * connected yet, and a caller should show those words rather than an error.
 *
 * @param ok          Pacing's own envelope flag
 * @param dimensions  the proposed dimensions, empty when there is nothing to propose
 * @param notice      why the proposal is empty, in words meant for a person; null when it is not
 */
public record PacingMappingSuggestions(
		boolean ok,
		List<PacingMappingSuggestedDimension> dimensions,
		String notice) {
}
