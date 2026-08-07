package com.aidigital.operationalhub.service.netsuite.org;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Tokenizes a Rippling {@code teams} string (comma-separated) into its four kinds of token, per
 * {@code team-by-team-lead-PLAN.md} §2/§3 S1-S2: team-lead tokens ({@code "<department>: <name>"}),
 * geographic pod tokens, grade-cohort tokens, and noise (e.g. legal entity names).
 */
@Component
public class TeamsStringParser {

	/**
	 * Canonical, uppercase geographic pod codes recognized in the {@code teams} string.
	 */
	private static final Set<String> POD_CODES =
			Set.of("HOUSE", "EAST", "WEST", "MIDWEST", "CENTRAL", "SOUTHEAST");

	/**
	 * Canonical grade-cohort phrases recognized in the {@code teams} string, matched case-insensitively.
	 */
	private static final Set<String> GRADE_COHORT_TOKENS = Set.of(
			"MPO Seniors", "MPO Middles & Juniors", "MPO Team Leads",
			"MPO Directors", "MPO Senior Directors", "MPO Trainees");

	private static final char TEAM_TOKEN_SEPARATOR = ':';

	/**
	 * Parses the given {@code teams} string.
	 *
	 * @param teams the raw, comma-separated {@code teams} value, possibly {@code null} or blank
	 * @return the parsed tokens; all lists are empty when the input is {@code null}/blank
	 */
	public ParsedTeamsString parse(String teams) {
		List<String> teamLeadNameFragments = new ArrayList<>();
		List<String> podTokens = new ArrayList<>();
		List<String> gradeCohortTokens = new ArrayList<>();
		List<String> otherTokens = new ArrayList<>();
		if (teams != null && !teams.isBlank()) {
			for (String rawToken : teams.split(",")) {
				classifyToken(collapseWhitespace(rawToken.trim()), teamLeadNameFragments, podTokens,
						gradeCohortTokens, otherTokens);
			}
		}
		return new ParsedTeamsString(teamLeadNameFragments, podTokens, gradeCohortTokens, otherTokens);
	}

	/**
	 * Classifies a single trimmed, whitespace-collapsed token into the matching accumulator.
	 *
	 * @param token                 the normalized token; ignored when empty
	 * @param teamLeadNameFragments accumulator for team-lead name fragments
	 * @param podTokens             accumulator for pod codes
	 * @param gradeCohortTokens     accumulator for grade-cohort phrases
	 * @param otherTokens           accumulator for unrecognized (noise) tokens
	 */
	void classifyToken(String token, List<String> teamLeadNameFragments, List<String> podTokens,
	                   List<String> gradeCohortTokens, List<String> otherTokens) {
		if (token.isEmpty()) {
			return;
		}
		String upper = token.toUpperCase();
		if (POD_CODES.contains(upper)) {
			podTokens.add(upper);
			return;
		}
		String cohort = matchGradeCohort(token);
		if (cohort != null) {
			gradeCohortTokens.add(cohort);
			return;
		}
		int separatorIndex = token.indexOf(TEAM_TOKEN_SEPARATOR);
		if (separatorIndex >= 0) {
			teamLeadNameFragments.add(collapseWhitespace(token.substring(separatorIndex + 1).trim()));
			return;
		}
		otherTokens.add(token);
	}

	/**
	 * Matches a token against the known grade-cohort phrases, case-insensitively.
	 *
	 * @param token the normalized token
	 * @return the canonical cohort phrase, or {@code null} when the token matches none
	 */
	String matchGradeCohort(String token) {
		for (String cohort : GRADE_COHORT_TOKENS) {
			if (cohort.equalsIgnoreCase(token)) {
				return cohort;
			}
		}
		return null;
	}

	/**
	 * Collapses runs of internal whitespace to a single space.
	 *
	 * @param value the input string
	 * @return the whitespace-collapsed string
	 */
	String collapseWhitespace(String value) {
		return value.replaceAll("\\s+", " ");
	}
}
