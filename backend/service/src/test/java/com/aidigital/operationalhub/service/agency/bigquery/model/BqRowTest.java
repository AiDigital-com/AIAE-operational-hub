package com.aidigital.operationalhub.service.agency.bigquery.model;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link BqRow}, the typed accessor over a BigQuery result row.
 */
class BqRowTest {

	private BqRow row(String column, Object value) {
		Map<String, Object> values = new HashMap<>();
		values.put(column, value);
		return new BqRow(values);
	}

	@Test
	void shouldReadLongFromNumberStringAndHandleMissingOrInvalidTest() {
		// Execution + Verification
		assertThat(row("id", 5L).getLong("id")).isEqualTo(5L);
		assertThat(row("id", "7").getLong("id")).isEqualTo(7L);
		assertThat(row("id", null).getLong("id")).isNull();
		assertThat(row("id", "abc").getLong("id")).isNull();
		assertThat(new BqRow(Map.of()).getLong("id")).isNull();
	}

	@Test
	void shouldReadDoubleFromNumberStringAndHandleMissingOrInvalidTest() {
		// Execution + Verification
		assertThat(row("budget", 12.5).getDouble("budget")).isEqualTo(12.5);
		assertThat(row("budget", "3.25").getDouble("budget")).isEqualTo(3.25);
		assertThat(row("budget", null).getDouble("budget")).isNull();
		assertThat(row("budget", "nope").getDouble("budget")).isNull();
	}

	@Test
	void shouldReadStringAndHandleMissingTest() {
		// Execution + Verification
		assertThat(row("name", "Acme").getString("name")).isEqualTo("Acme");
		assertThat(row("name", 1L).getString("name")).isEqualTo("1");
		assertThat(row("name", null).getString("name")).isNull();
	}

	@Test
	void shouldReadStringListAndDefaultToEmptyTest() {
		// Execution + Verification
		assertThat(row("channels", List.of("Display", "Video")).getStringList("channels"))
				.containsExactly("Display", "Video");
		assertThat(row("channels", null).getStringList("channels")).isEmpty();
		assertThat(row("channels", "not-a-list").getStringList("channels")).isEmpty();
	}
}
