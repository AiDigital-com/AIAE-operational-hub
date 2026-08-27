package com.aidigital.operationalhub.application.config;

import org.junit.jupiter.api.Test;
import org.zalando.logbook.BodyFilter;
import org.zalando.logbook.HttpRequest;
import org.zalando.logbook.core.Conditions;

import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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

	@Test
	void shouldExcludeActuatorPathsFromLoggingByDefaultTest() {
		// Given:
		Map<String, List<String>> excluded = new LogbookConfig.LogbookProperties().getExcluded();
		HttpRequest request = mock(HttpRequest.class);
		when(request.getPath()).thenReturn("/actuator/health/readiness");
		when(request.getMethod()).thenReturn("GET");

		// When:
		Predicate<HttpRequest> actuatorExclusion = Conditions.requestTo("/actuator/**")
				.and(Conditions.requestWithMethod("GET"));

		// Then: load-balancer and Kubernetes health probes are never logged
		assertThat(excluded).containsEntry("/actuator/**", List.of("GET"));
		assertThat(actuatorExclusion).accepts(request);
	}
}
