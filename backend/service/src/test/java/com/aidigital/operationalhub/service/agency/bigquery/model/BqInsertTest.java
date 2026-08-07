package com.aidigital.operationalhub.service.agency.bigquery.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link BqInsert.Builder}, the write-side counterpart of {@link BqRequestTest}.
 */
class BqInsertTest {

	@Test
	void shouldBuildAnInsertStatementWithBacktickQuotedTableAndColumnsTest() {
		// Execution:
		String sql = new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date", "impressions"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10"), BqInsert.numberValue(5000L)))
				.build()
				.sql();

		// Verification:
		assertThat(sql).isEqualTo(
				"INSERT INTO `dataset.adjustments` (`date`, `impressions`) VALUES ('2026-03-10', 5000)");
	}

	@Test
	void shouldJoinMultipleRowsIntoOneMultiRowValuesClauseTest() {
		// Execution:
		String sql = new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.addRow(List.of(BqInsert.stringValue("2026-03-11")))
				.build()
				.sql();

		// Verification: one INSERT, two VALUES tuples
		assertThat(sql).isEqualTo(
				"INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-10'), ('2026-03-11')");
	}

	@Test
	void shouldEscapeAStringValueContainingAQuoteTest() {
		// Execution: a value containing a single quote must not break out of its literal
		String rendered = BqInsert.stringValue("O'Brien's Video");

		// Verification:
		assertThat(rendered).isEqualTo("'O\\'Brien\\'s Video'");
	}

	@Test
	void shouldRenderNullForANullStringValueTest() {
		// Execution + Verification:
		assertThat(BqInsert.stringValue(null)).isEqualTo("NULL");
	}

	@Test
	void shouldRenderNullForANullNumberValueTest() {
		// Execution + Verification:
		assertThat(BqInsert.numberValue(null)).isEqualTo("NULL");
	}

	@Test
	void shouldRenderTheCurrentTimestampExpressionTest() {
		// Execution + Verification: server-evaluated, never the application clock
		assertThat(BqInsert.currentTimestamp()).isEqualTo("CURRENT_DATETIME()");
	}

	@Test
	void shouldRequireATableTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> new BqInsert.Builder()
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("into(table)");
	}

	@Test
	void shouldRequireAtLeastOneColumnTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> new BqInsert.Builder()
				.into("dataset.adjustments")
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("columns(...)");
	}

	@Test
	void shouldRequireAtLeastOneRowTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date"))
				.build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("addRow(...)");
	}

	@Test
	void shouldBuildOneBatchWhenEverythingFitsUnderTheLimitTest() {
		// Execution:
		List<BqInsert> batches = new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.addRow(List.of(BqInsert.stringValue("2026-03-11")))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES);

		// Verification:
		assertThat(batches).hasSize(1);
		assertThat(batches.get(0).sql()).isEqualTo(
				"INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-10'), ('2026-03-11')");
	}

	@Test
	void shouldSplitIntoMultipleBatchesWhenARowWouldPushPastTheStatementLimitTest() {
		// Given: a limit small enough that only one of these two rows fits per statement
		int maxStatementBytes = "INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-10')".length() + 5;

		// Execution:
		List<BqInsert> batches = new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.addRow(List.of(BqInsert.stringValue("2026-03-11")))
				.addRow(List.of(BqInsert.stringValue("2026-03-12")))
				.buildBatches(maxStatementBytes);

		// Verification: three rows, one per statement, in the original order, table/columns repeated
		assertThat(batches).hasSize(3);
		assertThat(batches.get(0).sql())
				.isEqualTo("INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-10')");
		assertThat(batches.get(1).sql())
				.isEqualTo("INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-11')");
		assertThat(batches.get(2).sql())
				.isEqualTo("INSERT INTO `dataset.adjustments` (`date`) VALUES ('2026-03-12')");
	}

	@Test
	void shouldPackAsManyRowsAsFitBeforeStartingTheNextBatchTest() {
		// Given: a limit that fits exactly two short rows but not a third
		String prefix = "INSERT INTO `dataset.adjustments` (`date`) VALUES ";
		String row = "('2026-03-10')";
		int maxStatementBytes = prefix.length() + row.length() * 2 + 2;

		// Execution:
		List<BqInsert> batches = new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.buildBatches(maxStatementBytes);

		// Verification: first batch packs the two rows that fit, second batch holds the leftover
		assertThat(batches).hasSize(2);
		assertThat(batches.get(0).sql()).isEqualTo(prefix + row + ", " + row);
		assertThat(batches.get(1).sql()).isEqualTo(prefix + row);
	}

	@Test
	void shouldRequireATableWhenBuildingBatchesTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> new BqInsert.Builder()
				.columns(List.of("date"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.buildBatches(BqInsert.MAX_STATEMENT_BYTES))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("into(table)");
	}

	@Test
	void shouldRejectARowWhoseSizeDoesNotMatchTheColumnsTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> new BqInsert.Builder()
				.into("dataset.adjustments")
				.columns(List.of("date", "impressions"))
				.addRow(List.of(BqInsert.stringValue("2026-03-10")))
				.build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("one value per column");
	}
}
