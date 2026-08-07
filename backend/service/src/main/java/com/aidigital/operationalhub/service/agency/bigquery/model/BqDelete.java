package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * An immutable, ready-to-run BigQuery {@code DELETE} statement built fluently with {@link Builder} —
 * the third member of the write family beside {@link BqInsert}, and the half of an upsert BigQuery has
 * no {@code ON CONFLICT} for.
 *
 * <p>Rows are named by key, never by scope: the statement deletes exactly the keys handed to it and
 * nothing adjacent. That is the difference between replacing one person's edit and quietly discarding
 * everyone else's for the same campaign and day, and it is why there is no "delete everything matching
 * this campaign" form here.
 *
 * <p>Injection safety: key column names are supplied by the calling service from a fixed whitelist
 * (never user input, backtick-quoted via {@link BqSql#col}), and key values are escaped here through
 * {@link BqSql#literal} rather than by the caller.
 *
 * <p>Matching an absent value is the subtle part, and {@link Builder#absentAs} is how a caller says what
 * its store does about it. Left alone, a {@code null} renders as {@code IS NULL} - correct for a table that
 * stores nulls. But a store may keep a placeholder instead, or a reader may substitute one: the marts these
 * adjustments live in are read through views that emit {@code COALESCE(col, 'not set')}, so a value read
 * back as {@code 'not set'} may be a {@code NULL} in the table it came from. Then {@code col = 'not set'}
 * matches nothing, the delete misses the row it meant to replace, and the insert that follows adds a second
 * one - which is the exact outcome delete-then-insert exists to prevent. Declaring the placeholder makes
 * both forms match, the way the view's own join does.
 *
 * <p>A placeholder is text, so it can only stand in for a text column - which is why {@link Builder#absentAs}
 * takes the columns it applies to rather than covering the whole key. Wrapping a {@code DATE} column in
 * {@code COALESCE(col, 'not set')} is not merely useless: BigQuery has no common supertype for the two and
 * cannot read {@code 'not set'} as a date, so it rejects the statement outright and the whole write fails.
 * The views draw the same distinction, comparing their date column through a date sentinel
 * ({@code COALESCE(pm.date, DATE '1970-01-01')}) and every text column through {@code 'not set'}.
 *
 * @param sql the assembled SQL statement
 */
public record BqDelete(String sql) {

	/**
	 * How the per-key predicates are joined - each key is one alternative, and a row matching any of them
	 * goes.
	 */
	private static final String SEPARATOR = " OR ";

	/**
	 * Fluent builder for a {@link BqDelete}.
	 */
	public static final class Builder {

		private String from;
		private String absentPlaceholder;
		private final Set<String> absentPlaceholderColumns = new HashSet<>();
		private final List<String> keyColumns = new ArrayList<>();
		private final List<List<String>> keys = new ArrayList<>();

		/**
		 * Sets the (unquoted) table the statement deletes from.
		 *
		 * @param qualifiedTable the fully-qualified table name
		 * @return this builder
		 */
		public Builder from(String qualifiedTable) {
			this.from = qualifiedTable;
			return this;
		}

		/**
		 * Sets the whitelisted columns every key's values are positionally aligned to - together, the
		 * natural key identifying one row.
		 *
		 * @param whitelistedColumns the unquoted column names, in the order keys render their values
		 * @return this builder
		 */
		public Builder keyColumns(List<String> whitelistedColumns) {
			this.keyColumns.addAll(whitelistedColumns);
			return this;
		}

		/**
		 * Adds one key's raw values, positionally aligned to {@link #keyColumns(List)}. Values are escaped
		 * by this class; a {@code null} becomes an {@code IS NULL} test rather than an equality against
		 * {@code NULL}, which would match no row at all.
		 *
		 * @param keyValues the key's values, one per key column, each may be {@code null}
		 * @return this builder
		 */
		public Builder addKey(List<String> keyValues) {
			keys.add(keyValues);
			return this;
		}

		/**
		 * Declares what a stored {@code NULL} means in the named text columns, so a key value equal to that
		 * placeholder matches a stored null as well as a stored placeholder.
		 *
		 * <p>Those columns' comparisons become {@code COALESCE(col, placeholder) = value}, which is how the
		 * views over these marts compare identity columns themselves
		 * ({@code COALESCE(pm.constructed_id, 'not set') = COALESCE(ma.constructed_id, 'not set')}). Without
		 * it, a row whose identity is stored as {@code NULL} but read back as the placeholder cannot be
		 * found again.
		 *
		 * <p>Only the named columns are wrapped, and they must all be text ones. A placeholder like
		 * {@code 'not set'} has no reading as a {@code DATE} or a number, so BigQuery cannot find a common
		 * type for the {@code COALESCE} and rejects the whole statement rather than the one comparison -
		 * a key column left out here is compared directly, and a {@code null} in it still renders as
		 * {@code IS NULL}.
		 *
		 * <p>The cost is that a {@code COALESCE} in the predicate gives up any pruning on that column. These
		 * deletes are keyed and small, so that is not a real price here; it would be on a large scan.
		 *
		 * @param placeholder what an absent value reads as, e.g. {@code "not set"}
		 * @param textColumns the text key columns the placeholder stands in for
		 * @return this builder
		 */
		public Builder absentAs(String placeholder, Collection<String> textColumns) {
			this.absentPlaceholder = placeholder;
			this.absentPlaceholderColumns.addAll(textColumns);
			return this;
		}

		/**
		 * Indicates whether any key has been added, so a caller can skip the statement entirely rather
		 * than build one that deletes nothing.
		 *
		 * @return {@code true} when at least one key was added
		 */
		public boolean isEmpty() {
			return keys.isEmpty();
		}

		/**
		 * Builds one or more {@code DELETE} statements, splitting the added keys across as many statements
		 * as needed to keep each one's rendered length under {@code maxStatementBytes}.
		 *
		 * <p>Twelve columns per key make this predicate far bulkier per row than the matching
		 * {@code INSERT}'s values, so a batch of keys renders past BigQuery's fixed 1&nbsp;MB
		 * statement-length limit sooner than the batch of rows replacing them - the same split, reached
		 * with fewer rows.
		 *
		 * @param maxStatementBytes the maximum rendered length, in UTF-16 code units, any one statement
		 *                          may reach (see {@link BqInsert#MAX_STATEMENT_BYTES})
		 * @return one or more {@link BqDelete}s, together covering every added key in the order given
		 */
		public List<BqDelete> buildBatches(int maxStatementBytes) {
			require(from != null, "from(table) is required");
			require(!keyColumns.isEmpty(), "keyColumns(...) is required");
			require(!keys.isEmpty(), "at least one addKey(...) is required");
			for (List<String> key : keys) {
				require(key.size() == keyColumns.size(), "each key must have exactly one value per key column");
			}
			String prefix = "DELETE FROM " + BqSql.col(from) + " WHERE ";
			List<String> renderedKeys = keys.stream().map(this::renderKey).toList();

			List<BqDelete> batches = new ArrayList<>();
			List<String> batchKeys = new ArrayList<>();
			int batchLength = prefix.length();
			for (String renderedKey : renderedKeys) {
				int separatorLength = batchKeys.isEmpty() ? 0 : SEPARATOR.length();
				if (!batchKeys.isEmpty() && batchLength + separatorLength + renderedKey.length() > maxStatementBytes) {
					batches.add(new BqDelete(prefix + String.join(SEPARATOR, batchKeys)));
					batchKeys = new ArrayList<>();
					batchLength = prefix.length();
				}
				batchLength += (batchKeys.isEmpty() ? 0 : SEPARATOR.length()) + renderedKey.length();
				batchKeys.add(renderedKey);
			}
			batches.add(new BqDelete(prefix + String.join(SEPARATOR, batchKeys)));
			return batches;
		}

		/**
		 * Renders one key as a parenthesised conjunction over every key column, so the disjunction joining
		 * the keys cannot bind more loosely than the comparisons inside them.
		 *
		 * @param keyValues the key's values, aligned to {@link #keyColumns(List)}
		 * @return the rendered predicate for that one key
		 */
		private String renderKey(List<String> keyValues) {
			List<String> comparisons = new ArrayList<>();
			for (int index = 0; index < keyColumns.size(); index++) {
				comparisons.add(comparison(keyColumns.get(index), keyValues.get(index)));
			}
			return "(" + String.join(" AND ", comparisons) + ")";
		}

		/**
		 * Renders one column's comparison, honouring {@link #absentAs} for the columns it names.
		 *
		 * @param column the unquoted column name
		 * @param value  the key value, may be {@code null}
		 * @return the rendered comparison
		 */
		private String comparison(String column, String value) {
			String quotedColumn = BqSql.col(column);
			if (absentPlaceholder == null || !absentPlaceholderColumns.contains(column)) {
				return value == null
						? quotedColumn + " IS NULL"
						: quotedColumn + " = " + BqSql.literal(value);
			}
			String stored = "COALESCE(" + quotedColumn + ", " + BqSql.literal(absentPlaceholder) + ")";
			return stored + " = " + BqSql.literal(value == null ? absentPlaceholder : value);
		}

		private void require(boolean condition, String message) {
			if (!condition) {
				throw new IllegalStateException(message);
			}
		}
	}
}
