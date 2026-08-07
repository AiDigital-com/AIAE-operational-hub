package com.aidigital.operationalhub.service.agency.bigquery.model;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link BqDelete.Builder}, the statement that makes a conversions write a replacement
 * rather than an addition.
 */
class BqDeleteTest {

	@Test
	void shouldBuildADeleteMatchingOneKeyAcrossEveryKeyColumnTest() {
		// Execution:
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "conversion_action"))
				.addKey(List.of("2026-03-10", "Purchase"))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Verification:
		assertThat(sql).isEqualTo(
				"DELETE FROM `dataset.conversion_adjustments` "
						+ "WHERE (`date` = '2026-03-10' AND `conversion_action` = 'Purchase')");
	}

	@Test
	void shouldOrTheKeysTogetherSoEachStaysItsOwnConjunctionTest() {
		// Execution:
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "conversion_action"))
				.addKey(List.of("2026-03-10", "Purchase"))
				.addKey(List.of("2026-03-11", "Lead"))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Verification: each key is parenthesised, so the OR cannot bind more loosely than the ANDs inside
		assertThat(sql).isEqualTo(
				"DELETE FROM `dataset.conversion_adjustments` "
						+ "WHERE (`date` = '2026-03-10' AND `conversion_action` = 'Purchase') "
						+ "OR (`date` = '2026-03-11' AND `conversion_action` = 'Lead')");
	}

	@Test
	void shouldTestAnAbsentKeyValueForNullRatherThanEqualityTest() {
		// Given: a key whose level-3 name is absent - a legitimate key value, not a missing one
		List<String> key = Arrays.asList("2026-03-10", null);

		// Execution:
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "constructed_name_lvl3"))
				.addKey(key)
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Verification: `= NULL` would match no row at all, leaving the old adjustment behind
		assertThat(sql).contains("`constructed_name_lvl3` IS NULL");
		assertThat(sql).doesNotContain("= NULL");
	}

	@Test
	void shouldMatchAStoredNullThroughTheDeclaredAbsentPlaceholderTest() {
		// Given: a key whose level-3 name reads as the marts' placeholder, because the view emitted
		// COALESCE(col, 'not set') over a column that may hold NULL
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "constructed_name_lvl3"))
				.absentAs("not set", List.of("constructed_name_lvl3"))
				.addKey(List.of("2026-03-10", "not set"))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Then: both a stored NULL and a stored 'not set' match. An exact `= 'not set'` would miss the NULL
		// row, the delete would replace nothing, and the insert would add a second row for one key.
		assertThat(sql).contains("COALESCE(`constructed_name_lvl3`, 'not set') = 'not set'");
	}

	@Test
	void shouldLeaveAColumnOutsideTheDeclaredTextColumnsComparedDirectlyTest() {
		// Given: a DATE key column alongside a text one, with the placeholder declared only for the text one
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "constructed_name_lvl3"))
				.absentAs("not set", List.of("constructed_name_lvl3"))
				.addKey(List.of("2026-03-10", "not set"))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Then: the date is compared as itself. COALESCE(`date`, 'not set') has no common type in BigQuery -
		// it rejects the statement outright, so the delete never runs and the whole write path fails.
		assertThat(sql).contains("`date` = '2026-03-10'");
		assertThat(sql).doesNotContain("COALESCE(`date`");
	}

	@Test
	void shouldTreatANullKeyValueAsThePlaceholderWhenOneIsDeclaredTest() {
		// Given: the value we hold is null rather than the placeholder text
		List<String> key = Arrays.asList("2026-03-10", null);

		// When:
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "constructed_name_lvl3"))
				.absentAs("not set", List.of("constructed_name_lvl3"))
				.addKey(key)
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Then: the same predicate either way - null and the placeholder are one value once a placeholder is
		// declared, so a row written from either reads back as the other and is still found
		assertThat(sql).contains("COALESCE(`constructed_name_lvl3`, 'not set') = 'not set'");
		assertThat(sql).doesNotContain("IS NULL");
	}

	@Test
	void shouldStillTestForNullInAColumnThePlaceholderDoesNotCoverTest() {
		// Given: a null in a column left out of the declared text columns
		List<String> key = Arrays.asList(null, "not set");

		// When:
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "constructed_name_lvl3"))
				.absentAs("not set", List.of("constructed_name_lvl3"))
				.addKey(key)
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Then: declaring a placeholder for other columns does not change this one - `= NULL` would still
		// match no row, so the uncovered column keeps its IS NULL form
		assertThat(sql).contains("`date` IS NULL");
	}

	@Test
	void shouldEscapeAKeyValueContainingAQuoteTest() {
		// Execution: a conversion action named by the advertiser can contain anything
		String sql = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("conversion_action"))
				.addKey(List.of("O'Brien's Purchase"))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES)
				.get(0)
				.sql();

		// Verification:
		assertThat(sql).isEqualTo(
				"DELETE FROM `dataset.conversion_adjustments` "
						+ "WHERE (`conversion_action` = 'O\\'Brien\\'s Purchase')");
	}

	@Test
	void shouldSplitTheKeysAcrossStatementsWhenOneWouldExceedTheLengthLimitTest() {
		// Given: a ceiling that fits one key but not two
		BqDelete.Builder builder = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date"))
				.addKey(List.of("2026-03-10"))
				.addKey(List.of("2026-03-11"))
				.addKey(List.of("2026-03-12"));
		int maxStatementBytes =
				"DELETE FROM `dataset.conversion_adjustments` WHERE (`date` = '2026-03-10')".length() + 3;

		// Execution:
		List<BqDelete> batches = builder.buildBatches(maxStatementBytes);

		// Verification: every key still deleted, none merged into an over-long statement
		assertThat(batches).hasSize(3);
		assertThat(batches.get(0).sql()).endsWith("WHERE (`date` = '2026-03-10')");
		assertThat(batches.get(1).sql()).endsWith("WHERE (`date` = '2026-03-11')");
		assertThat(batches.get(2).sql()).endsWith("WHERE (`date` = '2026-03-12')");
	}

	@Test
	void shouldReportAnEmptyBuilderSoACallerCanSkipTheStatementTest() {
		// Given:
		BqDelete.Builder builder = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date"));

		// Execution + Verification:
		assertThat(builder.isEmpty()).isTrue();
		assertThat(builder.addKey(List.of("2026-03-10")).isEmpty()).isFalse();
	}

	@Test
	void shouldRejectAKeyWhoseValueCountDiffersFromTheKeyColumnsTest() {
		// Given: two key columns but one value - the predicate would silently match too many rows
		BqDelete.Builder builder = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date", "conversion_action"))
				.addKey(List.of("2026-03-10"));

		// Execution + Verification:
		assertThatThrownBy(() -> builder.buildBatches(BqInsert.MAX_STATEMENT_BYTES))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("one value per key column");
	}

	@Test
	void shouldRejectADeleteWithNoKeysAtAllTest() {
		// Given: no key added - an unbounded delete is exactly what this class must never emit
		BqDelete.Builder builder = new BqDelete.Builder()
				.from("dataset.conversion_adjustments")
				.keyColumns(List.of("date"));

		// Execution + Verification:
		assertThatThrownBy(() -> builder.buildBatches(BqInsert.MAX_STATEMENT_BYTES))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("at least one addKey");
	}
}
