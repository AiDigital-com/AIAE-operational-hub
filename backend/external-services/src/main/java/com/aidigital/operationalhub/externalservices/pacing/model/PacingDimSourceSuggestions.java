package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * What {@code POST /api/dashboards/:slug/dim-source/:id/suggest} proposed.
 *
 * <p>Three questions share one answer shape because they share one endpoint, and only one list is
 * ever populated: `bindings` for routing names, `members` for extending a canonical value, `groups`
 * for clustering a column. The empty ones are empty, never null, so a caller can read the list its
 * own question produced without checking which question it asked.
 *
 * <p>{@code available} carries the two outcomes that are NOT failures: no model is connected, and
 * the source has not been read yet so there are no values to reason about. Both are sentences to
 * show, not errors to raise.
 *
 * @param available  false when there was nothing to ask
 * @param notice     why the proposal is empty, in words meant for a person
 * @param bindings   proposed routes, for the bindings kind
 * @param members    proposed spellings, for the aliases kind
 * @param groups     proposed groupings, for the groups kind
 * @param considered how many values the proposal was made from
 */
public record PacingDimSourceSuggestions(
		boolean available,
		String notice,
		List<PacingDimSourceBinding> bindings,
		List<String> members,
		List<PacingDimSourceGroup> groups,
		int considered) {

	/** The answer when no model is connected - the path works, there is simply nothing to ask. */
	public static PacingDimSourceSuggestions noModel() {
		return new PacingDimSourceSuggestions(
				false, "we need to add ai connection", List.of(), List.of(), List.of(), 0);
	}

	/** The answer when the source has not been read yet, or what it read is out of date. */
	public static PacingDimSourceSuggestions noData() {
		return new PacingDimSourceSuggestions(
				false,
				"This source has not been read yet - read it first, then ask again.",
				List.of(), List.of(), List.of(), 0);
	}
}
