package com.aidigital.operationalhub.service.netsuite.org;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link TeamsStringParser}.
 */
class TeamsStringParserTest {

	private final TeamsStringParser parser = new TeamsStringParser();

	@Test
	void shouldParsePodAndCohortTokensForATeamLeadTest() {
		// Given:
		String teams = "HOUSE , MPO Team Leads";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).containsExactly("HOUSE");
		assertThat(result.gradeCohortTokens()).containsExactly("MPO Team Leads");
		assertThat(result.teamLeadNameFragments()).isEmpty();
		assertThat(result.otherTokens()).isEmpty();
	}

	@Test
	void shouldExtractTeamLeadNameFragmentFromTeamTokenTest() {
		// Given:
		String teams = "SOUTHEAST, Media Optimization: Dima, MPO Middles & Juniors";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.teamLeadNameFragments()).containsExactly("Dima");
		assertThat(result.podTokens()).containsExactly("SOUTHEAST");
		assertThat(result.gradeCohortTokens()).containsExactly("MPO Middles & Juniors");
	}

	@Test
	void shouldIgnoreNoiseTokenTest() {
		// Given:
		String teams = "HOUSE , Dream Wave Cyprus, Media Optimization: Galina, MPO Seniors";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.otherTokens()).containsExactly("Dream Wave Cyprus");
		assertThat(result.podTokens()).containsExactly("HOUSE");
		assertThat(result.teamLeadNameFragments()).containsExactly("Galina");
		assertThat(result.gradeCohortTokens()).containsExactly("MPO Seniors");
	}

	@Test
	void shouldParseMultiplePodTokensTest() {
		// Given:
		String teams = "MIDWEST, EAST";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).containsExactly("MIDWEST", "EAST");
	}

	@Test
	void shouldTrimAndUppercaseWhitespacePaddedPodTokenTest() {
		// Given:
		String teams = "HOUSE ";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).containsExactly("HOUSE");
	}

	@Test
	void shouldMatchGradeCohortCaseInsensitivelyTest() {
		// Given:
		String teams = "mpo seniors";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.gradeCohortTokens()).containsExactly("MPO Seniors");
	}

	@Test
	void shouldReturnEmptyResultForBlankTeamsStringTest() {
		// Given:
		String teams = "   ";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).isEmpty();
		assertThat(result.gradeCohortTokens()).isEmpty();
		assertThat(result.teamLeadNameFragments()).isEmpty();
		assertThat(result.otherTokens()).isEmpty();
	}

	@Test
	void shouldReturnEmptyResultForNullTeamsStringTest() {
		// Given:
		String teams = null;

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).isEmpty();
		assertThat(result.gradeCohortTokens()).isEmpty();
		assertThat(result.teamLeadNameFragments()).isEmpty();
		assertThat(result.otherTokens()).isEmpty();
	}

	@Test
	void shouldTokenizeSingleTokenWithOnlyAPodTest() {
		// Given:
		String teams = "HOUSE";

		// When:
		ParsedTeamsString result = parser.parse(teams);

		// Then:
		assertThat(result.podTokens()).containsExactly("HOUSE");
		assertThat(result.teamLeadNameFragments()).isEmpty();
		assertThat(result.gradeCohortTokens()).isEmpty();
		assertThat(result.otherTokens()).isEmpty();
	}
}
