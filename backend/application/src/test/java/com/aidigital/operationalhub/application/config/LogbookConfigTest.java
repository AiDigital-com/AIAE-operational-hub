package com.aidigital.operationalhub.application.config;

import org.junit.jupiter.api.Test;
import org.zalando.logbook.BodyFilter;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link LogbookConfig}.
 */
class LogbookConfigTest {

	private final LogbookConfig config = new LogbookConfig();

	@Test
	void shouldReplaceASpreadsheetBodyWithAPlaceholderTest() {
		// Given:
		BodyFilter filter = config.binaryBodyFilter();

		// When:
		String filtered = filter.filter(
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "<raw binary bytes>");

		// Then:
		assertThat(filtered).isEqualTo("<binary spreadsheet body omitted>");
	}

	@Test
	void shouldLeaveANonSpreadsheetBodyUnchangedTest() {
		// Given:
		BodyFilter filter = config.binaryBodyFilter();

		// When-Then:
		assertThat(filter.filter("application/json", "{\"a\":1}")).isEqualTo("{\"a\":1}");
	}

	@Test
	void shouldLeaveTheBodyUnchangedWhenContentTypeIsAbsentTest() {
		// Given:
		BodyFilter filter = config.binaryBodyFilter();

		// When-Then:
		assertThat(filter.filter(null, "some body")).isEqualTo("some body");
	}

	@Test
	void shouldDefaultToATenThousandCharacterBodyTruncationLimitTest() {
		// Execution + Verification:
		assertThat(new LogbookConfig.LogbookProperties().getMaxLoggedBodyChars()).isEqualTo(10_000);
	}

	@Test
	void shouldExcludeReportRowPathsFromLoggingByDefaultTest() {
		// Execution:
		Map<String, List<String>> excluded = new LogbookConfig.LogbookProperties().getExcluded();

		// Verification: the report/export/upload/adjustment paths are never logged
		assertThat(excluded).containsEntry("/**/report-rows/**", List.of("GET", "POST"));
	}
}
