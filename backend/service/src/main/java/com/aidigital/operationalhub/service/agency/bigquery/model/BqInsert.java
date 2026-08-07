package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * An immutable, ready-to-run BigQuery {@code INSERT} statement built fluently with {@link Builder} —
 * the write analogue of {@link BqRequest} (which is {@code SELECT}-only).
 *
 * <p>Injection safety: column names are supplied by the calling service from a fixed whitelist (never
 * user input, backtick-quoted via {@link BqSql#col}); row values must already be rendered by the caller
 * via {@link #stringValue}, {@link #numberValue}, or {@link #currentTimestamp} before being added as a
 * row, reusing {@link BqSql#literal}'s escaping for strings.
 *
 * @param sql the assembled SQL statement
 */
public record BqInsert(String sql) {

	/**
	 * Safe rendered-length ceiling (in UTF-16 code units, used as a byte-count stand-in) a
	 * {@link Builder#buildBatches(int)} statement is kept under, well below BigQuery's fixed 1&nbsp;MB
	 * query-length limit so encoding overhead and the column/table preamble never push a batch over it.
	 */
	public static final int MAX_STATEMENT_BYTES = 900_000;

	/**
	 * Fluent builder for a {@link BqInsert}.
	 */
	public static final class Builder {

		private String into;
		private final List<String> columns = new ArrayList<>();
		private final List<List<String>> rows = new ArrayList<>();

		/**
		 * Sets the (unquoted) table the statement inserts into.
		 *
		 * @param qualifiedTable the fully-qualified table name
		 * @return this builder
		 */
		public Builder into(String qualifiedTable) {
			this.into = qualifiedTable;
			return this;
		}

		/**
		 * Sets the whitelisted columns every row's values are positionally aligned to.
		 *
		 * @param whitelistedColumns the unquoted column names, in the order rows render their values
		 * @return this builder
		 */
		public Builder columns(List<String> whitelistedColumns) {
			this.columns.addAll(whitelistedColumns);
			return this;
		}

		/**
		 * Adds one row of already-rendered SQL value expressions, positionally aligned to
		 * {@link #columns(List)}.
		 *
		 * @param renderedValues the row's values, one per column, each already a valid SQL expression
		 *                       (see {@link #stringValue}, {@link #numberValue}, {@link #currentTimestamp})
		 * @return this builder
		 */
		public Builder addRow(List<String> renderedValues) {
			rows.add(renderedValues);
			return this;
		}

		/**
		 * Builds the {@code INSERT INTO ... (...) VALUES (...), (...)} statement.
		 *
		 * @return the {@link BqInsert}
		 */
		public BqInsert build() {
			require(into != null, "into(table) is required");
			require(!columns.isEmpty(), "columns(...) is required");
			require(!rows.isEmpty(), "at least one addRow(...) is required");
			for (List<String> row : rows) {
				require(row.size() == columns.size(), "each row must have exactly one value per column");
			}
			String columnList = columns.stream().map(BqSql::col).collect(Collectors.joining(", "));
			String valuesList = rows.stream()
					.map(row -> "(" + String.join(", ", row) + ")")
					.collect(Collectors.joining(", "));
			String sql = "INSERT INTO " + BqSql.col(into) + " (" + columnList + ") VALUES " + valuesList;
			return new BqInsert(sql);
		}

		/**
		 * Builds one or more {@code INSERT} statements, splitting the added rows across as many
		 * statements as needed to keep each one's rendered length under {@code maxStatementBytes} -
		 * BigQuery rejects any single query over its fixed 1&nbsp;MB statement-length limit, and a large
		 * adjustment batch can otherwise render past it in one shot.
		 *
		 * @param maxStatementBytes the maximum rendered length, in UTF-16 code units, any one statement
		 *                          may reach (see {@link #MAX_STATEMENT_BYTES})
		 * @return one or more {@link BqInsert}s, together covering every added row in the order given
		 */
		public List<BqInsert> buildBatches(int maxStatementBytes) {
			require(into != null, "into(table) is required");
			require(!columns.isEmpty(), "columns(...) is required");
			require(!rows.isEmpty(), "at least one addRow(...) is required");
			for (List<String> row : rows) {
				require(row.size() == columns.size(), "each row must have exactly one value per column");
			}
			String columnList = columns.stream().map(BqSql::col).collect(Collectors.joining(", "));
			String prefix = "INSERT INTO " + BqSql.col(into) + " (" + columnList + ") VALUES ";
			List<String> renderedRows = rows.stream()
					.map(row -> "(" + String.join(", ", row) + ")")
					.toList();

			List<BqInsert> batches = new ArrayList<>();
			List<String> batchRows = new ArrayList<>();
			int batchLength = prefix.length();
			for (String renderedRow : renderedRows) {
				int separatorLength = batchRows.isEmpty() ? 0 : 2;
				if (!batchRows.isEmpty() && batchLength + separatorLength + renderedRow.length() > maxStatementBytes) {
					batches.add(new BqInsert(prefix + String.join(", ", batchRows)));
					batchRows = new ArrayList<>();
					batchLength = prefix.length();
				}
				batchLength += (batchRows.isEmpty() ? 0 : 2) + renderedRow.length();
				batchRows.add(renderedRow);
			}
			batches.add(new BqInsert(prefix + String.join(", ", batchRows)));
			return batches;
		}

		private void require(boolean condition, String message) {
			if (!condition) {
				throw new IllegalStateException(message);
			}
		}
	}

	/**
	 * Renders a nullable string as an escaped, quoted BigQuery literal, or {@code NULL}.
	 *
	 * @param value the raw value, may be {@code null}
	 * @return the rendered SQL expression
	 */
	public static String stringValue(String value) {
		return value == null ? "NULL" : BqSql.literal(value);
	}

	/**
	 * Renders a nullable numeric value as its literal, or {@code NULL}.
	 *
	 * @param value the raw value, may be {@code null}
	 * @return the rendered SQL expression
	 */
	public static String numberValue(Number value) {
		return value == null ? "NULL" : value.toString();
	}

	/**
	 * The server-authoritative timestamp expression stamped into {@code created_at}/{@code
	 * last_modified_at} — evaluated by BigQuery at write time, never the application clock.
	 *
	 * <p>The adjustments write table's audit columns are {@code DATETIME}, so this returns
	 * {@code CURRENT_DATETIME()} rather than a {@code TIMESTAMP} expression: BigQuery will not coerce a
	 * {@code TIMESTAMP} into a {@code DATETIME} column on INSERT, and a write that supplies one fails
	 * with {@code "Value has type TIMESTAMP which cannot be inserted into column … which has type
	 * DATETIME"}.
	 *
	 * @return {@code "CURRENT_DATETIME()"}
	 */
	public static String currentTimestamp() {
		return "CURRENT_DATETIME()";
	}
}
