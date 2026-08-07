package com.aidigital.operationalhub.service.netsuite.org;

import java.util.List;

/**
 * Result of {@link TeamsStringParser#parse(String)}: the four kinds of token found in a Rippling
 * {@code teams} string.
 *
 * @param teamLeadNameFragments the Team Lead first-name-or-nickname fragments extracted from team tokens
 *                              (e.g. {@code "Daria"} from {@code "Media Optimization: Daria"})
 * @param podTokens             the recognized geographic pod codes (e.g. {@code "HOUSE"}), uppercased
 * @param gradeCohortTokens     the recognized grade-cohort phrases (e.g. {@code "MPO Seniors"}), in their
 *                              canonical form
 * @param otherTokens           tokens matching none of the above (noise, e.g. legal entity names)
 */
public record ParsedTeamsString(
		List<String> teamLeadNameFragments,
		List<String> podTokens,
		List<String> gradeCohortTokens,
		List<String> otherTokens) {

}
