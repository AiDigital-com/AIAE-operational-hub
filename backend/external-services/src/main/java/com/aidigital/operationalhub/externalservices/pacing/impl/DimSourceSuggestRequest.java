package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceUnboundName;
import java.util.List;

/**
 * The body of {@code POST /api/dashboards/:slug/dim-source/:id/suggest}.
 *
 * <p>One record for all three kinds, mirroring the endpoint: Pacing reads only the fields its kind
 * needs and ignores the rest, so splitting this into three would be three shapes for one request.
 *
 * @param kind       bindings, aliases or groups
 * @param dim        the breakdown's key, for aliases and groups
 * @param label      the canonical value being extended, for aliases
 * @param unbound    the names that matched no line item, for bindings
 * @param candidates groupings the screen already guessed, so the model does not repeat them
 */
public record DimSourceSuggestRequest(
		String kind,
		String dim,
		String label,
		List<PacingDimSourceUnboundName> unbound,
		List<String> candidates) {
}
