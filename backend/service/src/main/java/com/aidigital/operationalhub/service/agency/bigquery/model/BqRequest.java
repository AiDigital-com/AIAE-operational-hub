package com.aidigital.operationalhub.service.agency.bigquery.model;

import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * An immutable, ready-to-run BigQuery statement built fluently with {@link Builder}.
 *
 * <p>One configured builder produces both queries the search services need: {@link Builder#build()}
 * assembles the paged {@code SELECT … GROUP BY … ORDER BY … LIMIT … OFFSET} statement, while
 * {@link Builder#buildCount()} assembles the matching {@code SELECT COUNT(DISTINCT …)} statement —
 * both over the same {@code WHERE} clause, so filtering, sorting, and paging run in the database.
 *
 * <p>Injection safety: numeric filter values are parsed to {@code long} (non-numeric values dropped),
 * string values are escaped as BigQuery string literals, and table names, columns, select items, and
 * order-by expressions are supplied by the services from fixed whitelists — never from user input.
 * Backtick quoting and aggregate-function wrapping are centralised in {@link BqSql}.
 *
 * @param sql the assembled SQL statement
 */
public record BqRequest(String sql) {

	/**
	 * The result alias the total row/group count is exposed under, both by
	 * {@link Builder#buildCount()} and by {@link Builder#withTotalCount(String)}'s window-function
	 * column, so {@link BigQuerySearchGateway} reads it the same way regardless of which query produced
	 * it.
	 */
	public static final String TOTAL_ALIAS = "total";

	/**
	 * Fluent builder for a {@link BqRequest}. Reusable across the agency, client, and campaign search
	 * services; the queries are assembled here rather than stored in external files.
	 */
	public static final class Builder {

		private String from;
		private String joinClause = "";
		private boolean fromIsSubquery;
		private final List<String> selectList = new ArrayList<>();
		private boolean distinct;
		private String countField;
		private final List<String> groupBy = new ArrayList<>();
		private String orderByExpression;
		private final List<String> tiebreakerColumns = new ArrayList<>();
		private SortDirection sortDirection;
		private Integer pageNumber;
		private Integer pageSize;
		private Integer explicitOffset;
		private final List<String> predicates = new ArrayList<>();

		/**
		 * Sets the (unquoted) table the statement reads from.
		 *
		 * @param table the qualified table name
		 * @return this builder
		 */
		public Builder from(String table) {
			this.from = table;
			this.fromIsSubquery = false;
			return this;
		}

		/**
		 * Sets a previously-built {@link BqRequest} as a nested {@code FROM} source (a derived table),
		 * e.g. to rank or filter over an inner query's output rather than the base table directly.
		 *
		 * @param subquery the inner request to read from
		 * @return this builder
		 */
		public Builder from(BqRequest subquery) {
			this.from = subquery.sql();
			this.fromIsSubquery = true;
			return this;
		}

		/**
		 * Adds a {@code LEFT JOIN (subquery) alias ON predicate} after the {@code FROM} source - a second
		 * mart brought alongside the first, keeping every row of the first whether or not it matches.
		 *
		 * <p>The subquery is expected to alias its output columns to names the main source does not use,
		 * and that is the whole convention: the two conversion marts share column names, so a joined
		 * {@code conversions} would be ambiguous in the select list. Aliased apart, every existing
		 * expression keeps resolving to the main source unqualified and needs no rewriting. The
		 * {@code ON} predicate is the one place that names both sides, so it is the one place that
		 * qualifies.
		 *
		 * @param subquery  the request to join, whose columns must be uniquely aliased
		 * @param alias     the joined source's alias, used by {@code onPredicate}
		 * @param predicate the rendered {@code ON} condition
		 * @return this builder
		 */
		public Builder leftJoin(BqRequest subquery, String alias, String predicate) {
			this.joinClause = " LEFT JOIN (" + subquery.sql() + ") " + alias + " ON " + predicate;
			return this;
		}

		/**
		 * Prefixes the {@code SELECT} list with {@code DISTINCT}.
		 *
		 * @return this builder
		 */
		public Builder distinct() {
			this.distinct = true;
			return this;
		}

		/**
		 * Adds {@code `column` AS column} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name, reused verbatim as the result alias
		 * @return this builder
		 */
		public Builder select(String column) {
			return select(column, column);
		}

		/**
		 * Adds {@code `column` AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder select(String column, String alias) {
			return addSelect(BqSql.col(column), alias);
		}

		/**
		 * Adds {@code ANY_VALUE(`column`) AS column} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name, reused verbatim as the result alias
		 * @return this builder
		 */
		public Builder selectAnyValue(String column) {
			return selectAnyValue(column, column);
		}

		/**
		 * Adds {@code ANY_VALUE(`column`) AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectAnyValue(String column, String alias) {
			return addSelect(BqSql.anyValue(column), alias);
		}

		/**
		 * Adds {@code COUNT(DISTINCT `column`) AS alias} to the {@code SELECT} list of the paged data
		 * query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectCountDistinct(String column, String alias) {
			return addSelect(BqSql.countDistinct(column), alias);
		}

		/**
		 * Adds {@code MIN(`column`) AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectMin(String column, String alias) {
			return addSelect(BqSql.min(column), alias);
		}

		/**
		 * Adds {@code MAX(`column`) AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectMax(String column, String alias) {
			return addSelect(BqSql.max(column), alias);
		}

		/**
		 * Adds {@code SUM(`column`) AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectSum(String column, String alias) {
			return addSelect(BqSql.sum(column), alias);
		}

		/**
		 * Adds {@code AVG(`column`) AS alias} to the {@code SELECT} list of the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectAvg(String column, String alias) {
			return addSelect(BqSql.avg(column), alias);
		}

		/**
		 * Adds {@code ARRAY_AGG(DISTINCT `column` IGNORE NULLS) AS alias} to the {@code SELECT} list of
		 * the paged data query.
		 *
		 * @param column the unquoted column name
		 * @param alias  the result alias
		 * @return this builder
		 */
		public Builder selectArrayAggDistinct(String column, String alias) {
			return addSelect(BqSql.arrayAggDistinct(column), alias);
		}

		/**
		 * Adds {@code expression AS alias} to the {@code SELECT} list, for a value no single-column
		 * helper above can express - a ratio over two aggregates, say. The caller owns the expression's
		 * quoting (build it from {@link BqSql}); nothing here inspects or escapes it, so it must never
		 * carry user input.
		 *
		 * @param expression the complete, already-quoted select expression
		 * @param alias      the result alias
		 * @return this builder
		 */
		public Builder selectExpression(String expression, String alias) {
			return addSelect(expression, alias);
		}

		/**
		 * Appends {@code expression AS alias} to the select list.
		 *
		 * @param expression the raw (already quoted/wrapped) select expression
		 * @param alias      the result alias
		 * @return this builder
		 */
		private Builder addSelect(String expression, String alias) {
			selectList.add(expression + " AS " + alias);
			return this;
		}

		/**
		 * Sets the column counted (as {@code COUNT(DISTINCT column)}) by {@link #buildCount()}.
		 *
		 * @param column the distinct-count column
		 * @return this builder
		 */
		public Builder countDistinct(String column) {
			this.countField = column;
			return this;
		}

		/**
		 * Adds {@code COUNT(DISTINCT `column`) OVER () AS total} to the {@code SELECT} list, so
		 * {@link #build()} carries its own total and a separate {@link #buildCount()} job is unnecessary
		 * on the common path (kept only as the empty-page fallback — see
		 * {@link BigQuerySearchGateway#fetchPage}).
		 *
		 * @param column the same column {@link #countDistinct(String)} would count
		 * @return this builder
		 */
		public Builder withTotalCount(String column) {
			return addSelect(BqSql.countDistinctOverAll(column), TOTAL_ALIAS);
		}

		/**
		 * Adds {@code COUNT(*) OVER () AS total} to the {@code SELECT} list — same purpose as
		 * {@link #withTotalCount(String)}, for a query whose rows have no one column that distinguishes
		 * them. A report row is identified by a couple of dozen columns together, and a grouped read is
		 * identified by whatever it grouped by, so there is nothing to count distinct values of.
		 *
		 * @return this builder
		 */
		public Builder withTotalRowCount() {
			return addSelect(BqSql.countAllOverAll(), TOTAL_ALIAS);
		}

		/**
		 * Adds {@code ROW_NUMBER() OVER (PARTITION BY partitionByColumn ORDER BY orderByExpression) AS
		 * alias} to the {@code SELECT} list, ranking rows within each partition — e.g. to cap a result
		 * per group (via a later {@link #whereLessThanOrEqual}) entirely in BigQuery.
		 *
		 * @param partitionByColumn the unquoted column to partition by
		 * @param orderByExpression the pre-rendered {@code ORDER BY} expression within each partition
		 * @param alias             the result alias
		 * @return this builder
		 */
		public Builder selectRowNumber(String partitionByColumn, String orderByExpression, String alias) {
			return addSelect(BqSql.rowNumberOverPartitionBy(partitionByColumn, orderByExpression), alias);
		}

		/**
		 * Adds a {@code `column` IS NOT NULL} predicate (the always-present base predicate).
		 *
		 * @param column the column
		 * @return this builder
		 */
		public Builder whereNotNull(String column) {
			predicates.add(BqSql.col(column) + " IS NOT NULL");
			return this;
		}

		/**
		 * Adds a literal {@code FALSE} predicate - matches no rows. Used when a candidate scope is known
		 * to be empty (e.g. a campaign with no known delivery yet), so the query still runs the correct
		 * shape but matches nothing, rather than omitting the predicate entirely - which would incorrectly
		 * widen the read to every row instead of scoping it to nothing.
		 *
		 * @return this builder
		 */
		public Builder whereFalse() {
			predicates.add("FALSE");
			return this;
		}

		/**
		 * Adds a {@code `column` IN (...)} predicate over the given numeric ids; a no-op when empty.
		 *
		 * @param column the column
		 * @param ids    the ids
		 * @return this builder
		 */
		public Builder whereIn(String column, List<Long> ids) {
			if (ids != null && !ids.isEmpty()) {
				String values = ids.stream().map(String::valueOf).collect(Collectors.joining(", "));
				predicates.add(BqSql.col(column) + " IN (" + values + ")");
			}
			return this;
		}

		/**
		 * Adds a {@code `column` IN ('v1', 'v2', ...)} predicate over the given string values (each
		 * escaped as a BigQuery string literal); a no-op when empty. Named distinctly from
		 * {@link #whereIn(String, List)} rather than overloaded onto it - {@code List<Long>} and
		 * {@code List<String>} erase to the same signature.
		 *
		 * @param column the column
		 * @param values the values
		 * @return this builder
		 */
		public Builder whereInStrings(String column, List<String> values) {
			if (values != null && !values.isEmpty()) {
				String literals = values.stream().map(value -> "'" + escapeLiteral(value) + "'")
						.collect(Collectors.joining(", "));
				predicates.add(BqSql.col(column) + " IN (" + literals + ")");
			}
			return this;
		}

		/**
		 * Adds a {@code LOWER(TRIM(`column`)) NOT IN (...)} predicate over normalized string values; a
		 * no-op when empty.
		 *
		 * @param column the column
		 * @param values the normalized values to exclude
		 * @return this builder
		 */
		public Builder whereNormalizedNotInStrings(String column, List<String> values) {
			if (values != null && !values.isEmpty()) {
				String literals = values.stream()
						.map(value -> "'" + escapeLiteral(value.trim().toLowerCase()) + "'")
						.collect(Collectors.joining(", "));
				predicates.add(BqSql.normalized(BqSql.col(column)) + " NOT IN (" + literals + ")");
			}
			return this;
		}

		/**
		 * Adds a {@code LOWER(TRIM(`column`)) IN (...)} predicate over normalized string values; a
		 * no-op when empty. The positive counterpart of {@link #whereNormalizedNotInStrings}, for a
		 * caller that already validated a requested name against a case-insensitively resolved scope
		 * (e.g. the MDA spreadsheet tool's own {@code LOWER(...)} matching) and now needs the same
		 * comparison in the read/delete predicate itself.
		 *
		 * @param column the column
		 * @param values the normalized values to match
		 * @return this builder
		 */
		public Builder whereNormalizedInStrings(String column, List<String> values) {
			if (values != null && !values.isEmpty()) {
				String literals = values.stream()
						.map(value -> "'" + escapeLiteral(value.trim().toLowerCase()) + "'")
						.collect(Collectors.joining(", "));
				predicates.add(BqSql.normalized(BqSql.col(column)) + " IN (" + literals + ")");
			}
			return this;
		}

		/**
		 * Adds a {@code TRIM(`column`) != ''} predicate, keeping rows whose string column has real
		 * content after whitespace is removed.
		 *
		 * @param column the column
		 * @return this builder
		 */
		public Builder whereNotBlank(String column) {
			predicates.add("TRIM(" + BqSql.col(column) + ") != ''");
			return this;
		}

		/**
		 * Adds a {@code `column` IN (SELECT `subqueryColumn` FROM (...))} predicate; a no-op when the
		 * subquery is absent. Used when a filter is sourced from a related BigQuery mart rather than the
		 * primary table, while still keeping the outer query grouped and paged by the primary table.
		 *
		 * @param column         the outer query column tested for membership
		 * @param subqueryColumn the column selected by the subquery
		 * @param subquery       the subquery whose selected values are allowed
		 * @return this builder
		 */
		public Builder whereInSubquery(String column, String subqueryColumn, BqRequest subquery) {
			if (subquery != null && subquery.sql() != null && !subquery.sql().isBlank()) {
				predicates.add(BqSql.col(column) + " IN (SELECT " + BqSql.col(subqueryColumn)
						+ " FROM (" + subquery.sql() + "))");
			}
			return this;
		}

		/**
		 * Adds a {@code `column` NOT IN (SELECT `subqueryColumn` FROM (...))} predicate; a no-op when the
		 * subquery is absent.
		 *
		 * @param column         the outer query column tested for non-membership
		 * @param subqueryColumn the column selected by the subquery
		 * @param subquery       the subquery whose selected values are excluded
		 * @return this builder
		 */
		public Builder whereNotInSubquery(String column, String subqueryColumn, BqRequest subquery) {
			if (subquery != null && subquery.sql() != null && !subquery.sql().isBlank()) {
				predicates.add(BqSql.col(column) + " NOT IN (SELECT " + BqSql.col(subqueryColumn)
						+ " FROM (" + subquery.sql() + "))");
			}
			return this;
		}

		/**
		 * Adds a closed-interval {@code `column` >= 'from' AND `column` <= 'to'} predicate over a DATE
		 * column, either bound optional; a no-op when both are {@code null}.
		 *
		 * <p>The bounds are ISO date strings compared against a DATE column, which BigQuery coerces — the
		 * same form the source view itself uses in its {@code pm.date >= '2026-03-03'} join guard.
		 * Callers must have validated them as dates already: this escapes the literal, so a bad value
		 * cannot break out of it, but an unparseable one would still reach BigQuery as a type error
		 * rather than a clear rejection.
		 *
		 * @param column the DATE column
		 * @param from   the inclusive lower bound as {@code yyyy-MM-dd}, or {@code null} for open-ended
		 * @param to     the inclusive upper bound as {@code yyyy-MM-dd}, or {@code null} for open-ended
		 * @return this builder
		 */
		public Builder whereDateBetween(String column, String from, String to) {
			if (from != null) {
				predicates.add(BqSql.col(column) + " >= '" + escapeLiteral(from) + "'");
			}
			if (to != null) {
				predicates.add(BqSql.col(column) + " <= '" + escapeLiteral(to) + "'");
			}
			return this;
		}

		/**
		 * Adds a {@code `column` < CURRENT_DATE()} predicate over a DATE column - everything strictly
		 * before today, in BigQuery's own clock.
		 *
		 * <p>{@code CURRENT_DATE()} rather than a date the caller computes, deliberately: the reporting
		 * tool this mirrors writes exactly that, and a server-side "today" would drift from BigQuery's the
		 * moment the two disagree about the timezone. Both are UTC by default, so both stay in step.
		 *
		 * @param column the DATE column
		 * @return this builder
		 */
		public Builder whereBeforeCurrentDate(String column) {
			predicates.add(BqSql.col(column) + " < CURRENT_DATE()");
			return this;
		}

		/**
		 * Adds a {@code `column` = 'value'} predicate over a fixed (non-user) string literal; a no-op when
		 * the value is {@code null}.
		 *
		 * @param column the column
		 * @param value  the string literal value
		 * @return this builder
		 */
		public Builder whereEquals(String column, String value) {
			if (value != null) {
				predicates.add(BqSql.col(column) + " = '" + escapeLiteral(value) + "'");
			}
			return this;
		}

		/**
		 * Adds a name-equality predicate that compares the way the marts require: lower-cased and trimmed
		 * on both sides ({@link BqSql#normalized(String)}), because the pipelines filling them disagree
		 * about capitalisation and stray spaces.
		 *
		 * <p>When {@code absentPlaceholder} is given, an absent stored value compares as that placeholder
		 * and so does an absent {@code value} - which is how two rows that both lack the name match each
		 * other, where {@code NULL = NULL} would match nothing. Without it, a {@code null} value adds no
		 * predicate at all.
		 *
		 * @param column            the column to match
		 * @param value             the value to match it against, may be {@code null}
		 * @param absentPlaceholder the value absent stands in as, or {@code null} to leave nulls alone
		 * @return this builder
		 */
		public Builder whereNameEquals(String column, String value, String absentPlaceholder) {
			if (absentPlaceholder == null) {
				if (value != null) {
					predicates.add(BqSql.normalized(BqSql.col(column)) + " = "
							+ BqSql.normalized(BqSql.literal(value)));
				}
				return this;
			}
			String stored = BqSql.normalized(BqSql.coalesce(BqSql.col(column), absentPlaceholder));
			String wanted = BqSql.normalized(BqSql.literal(value == null ? absentPlaceholder : value));
			predicates.add(stored + " = " + wanted);
			return this;
		}

		/**
		 * Adds a {@code `column` <= value} predicate over a fixed (non-user) integer literal — e.g.
		 * filtering a {@link #selectRowNumber} rank to cap results per partition.
		 *
		 * @param column the column
		 * @param value  the literal upper bound
		 * @return this builder
		 */
		public Builder whereLessThanOrEqual(String column, int value) {
			predicates.add(BqSql.col(column) + " <= " + value);
			return this;
		}

		/**
		 * Adds a predicate for the given filter against {@code column}. Skipped when the filter cannot
		 * be applied (no value, or a non-numeric value for a numeric column).
		 *
		 * @param column  the raw BigQuery column the filter targets
		 * @param numeric whether the column is numeric (equality on a parsed {@code long})
		 * @param filter  the filter directive
		 * @return this builder
		 */
		public Builder filter(String column, boolean numeric, FilterCriterion<?> filter) {
			String predicate = predicate(column, numeric, filter);
			if (predicate != null) {
				predicates.add(predicate);
			}
			return this;
		}

		/**
		 * Adds a {@code GROUP BY} column to the paged data query, keeping call order. Called once per
		 * grouping column - a report grouped by the dimensions a user picked needs several.
		 *
		 * @param column the group-by column
		 * @return this builder
		 */
		public Builder groupBy(String column) {
			this.groupBy.add(column);
			return this;
		}

		/**
		 * Sets the {@code ORDER BY} expression of the paged data query.
		 *
		 * @param expression the whitelisted order-by expression (e.g. {@code LOWER(ANY_VALUE(`agency`))})
		 * @return this builder
		 */
		public Builder orderBy(String expression) {
			this.orderByExpression = expression;
			return this;
		}

		/**
		 * Adds a fixed-ascending secondary {@code ORDER BY} key appended after the primary
		 * {@link #orderBy(String)} expression, so paging stays deterministic when many rows tie on the
		 * primary sort. Unlike the primary expression, this key's direction never flips with
		 * {@link #sortBy(SortCriterion)} - it exists only to break ties, not to express user-visible
		 * order, and it is rendered as its own {@code , `column` ASC} clause so the primary expression's
		 * direction/{@code NULLS LAST} bind only to itself, not to this tiebreaker.
		 *
		 * @param column the unquoted tiebreaker column
		 * @return this builder
		 */
		public Builder tiebreaker(String column) {
			if (!this.tiebreakerColumns.contains(column)) {
				this.tiebreakerColumns.add(column);
			}
			return this;
		}

		/**
		 * Adds fixed-ascending secondary {@code ORDER BY} keys in the supplied order. Duplicates are
		 * ignored so callers can pass a stable default chain without first subtracting every earlier key.
		 *
		 * @param columns the unquoted tiebreaker columns
		 * @return this builder
		 */
		public Builder tiebreakers(List<String> columns) {
			for (String column : columns) {
				tiebreaker(column);
			}
			return this;
		}

		/**
		 * Sets the sort direction applied to {@link #orderBy(String)} from the requested sort, defaulting
		 * to ascending when the sort or its direction is absent.
		 *
		 * @param sort the requested sort, may be {@code null}
		 * @return this builder
		 */
		public Builder sortBy(SortCriterion<?> sort) {
			this.sortDirection = sort == null || sort.direction() == null ? SortDirection.ASC : sort.direction();
			return this;
		}

		/**
		 * Sets the one-based page and its size for database-side paging.
		 *
		 * @param pageNumber the one-based page number
		 * @param pageSize   the page size
		 * @return this builder
		 */
		public Builder page(int pageNumber, int pageSize) {
			this.pageNumber = pageNumber;
			this.pageSize = pageSize;
			return this;
		}

		/**
		 * Sets a raw {@code LIMIT}/{@code OFFSET} pair directly, bypassing {@link #page(int, int)}'s
		 * page-number-derived offset math. Used to fetch one row past a page's own size (limit =
		 * pageSize + 1 at the page's own offset) so callers can detect whether more rows remain without
		 * a separate full-dataset {@code COUNT(*)}.
		 *
		 * @param limit  the raw {@code LIMIT}
		 * @param offset the raw {@code OFFSET}
		 * @return this builder
		 */
		public Builder limitOffset(int limit, int offset) {
			this.pageSize = limit;
			this.explicitOffset = offset;
			return this;
		}

		/**
		 * Builds the paged data statement.
		 *
		 * @return the data {@link BqRequest}
		 */
		public BqRequest build() {
			require(from != null, "from(table) is required");
			require(!selectList.isEmpty(), "select(...) is required for a data query");
			StringBuilder sql = new StringBuilder("SELECT ")
					.append(distinct ? "DISTINCT " : "")
					.append(String.join(", ", selectList))
					.append(" FROM ").append(fromClause())
					.append(joinClause)
					.append(whereClause());
			if (!groupBy.isEmpty()) {
				sql.append(" GROUP BY ")
						.append(groupBy.stream().map(BqSql::col).collect(Collectors.joining(", ")));
			}
			if (orderByExpression != null) {
				String dir = sortDirection == SortDirection.DESC ? "DESC" : "ASC";
				sql.append(" ORDER BY ").append(orderByExpression).append(" ").append(dir).append(" NULLS LAST");
				for (String tiebreakerColumn : tiebreakerColumns) {
					sql.append(", ").append(BqSql.col(tiebreakerColumn)).append(" ASC");
				}
			}
			if (pageSize != null) {
				int offset = explicitOffset != null ? explicitOffset
						: pageNumber == null ? 0 : Math.max((pageNumber - 1) * pageSize, 0);
				sql.append(" LIMIT ").append(pageSize).append(" OFFSET ").append(offset);
			}
			return new BqRequest(sql.toString());
		}

		/**
		 * Builds the matching count statement over the same {@code WHERE} clause.
		 *
		 * @return the count {@link BqRequest}
		 */
		public BqRequest buildCount() {
			require(from != null, "from(table) is required");
			require(countField != null, "countDistinct(column) is required for a count query");
			String sql = "SELECT " + BqSql.countDistinct(countField) + " AS " + TOTAL_ALIAS + " FROM "
					+ fromClause() + whereClause();
			return new BqRequest(sql);
		}

		/**
		 * Renders the {@code FROM} source: a backtick-quoted table name, or a parenthesized nested
		 * {@link BqRequest} when {@link #from(BqRequest)} was used.
		 *
		 * @return the rendered {@code FROM} source
		 */
		private String fromClause() {
			return fromIsSubquery ? "(" + from + ")" : BqSql.col(from);
		}

		private String whereClause() {
			return predicates.isEmpty() ? "" : " WHERE " + String.join(" AND ", predicates);
		}

		private String predicate(String column, boolean numeric, FilterCriterion<?> filter) {
			if (column == null || filter.value() == null) {
				return null;
			}
			String col = BqSql.col(column);
			if (numeric) {
				Long value = parseLong(filter.value());
				return value == null ? null : col + " = " + value;
			}
			String literal = "'" + escapeLiteral(filter.value()) + "'";
			if (filter.operation() == FilterOperation.CONTAINS) {
				return filter.caseSensitive()
						? "STRPOS(" + col + ", " + literal + ") > 0"
						: "CONTAINS_SUBSTR(" + col + ", " + literal + ")";
			}
			return filter.caseSensitive()
					? col + " = " + literal
					: "LOWER(" + col + ") = LOWER(" + literal + ")";
		}

		private String escapeLiteral(String value) {
			return value.replace("\\", "\\\\").replace("'", "\\'");
		}

		/**
		 * Adds a {@code CONTAINS_SUBSTR(column, term)} predicate. {@code term} is escaped internally
		 * ({@link BqSql#containsSubstr(String, String)}) — callers never build or pass a raw fragment.
		 *
		 * @param column the column to match
		 * @param term   the raw search term
		 * @return this builder
		 */
		public Builder whereContainsSubstr(String column, String term) {
			predicates.add(BqSql.containsSubstr(column, term));
			return this;
		}

		/**
		 * Adds a predicate matching either {@code CONTAINS_SUBSTR(directColumn, term)} directly, or
		 * {@code joinColumn} being a member of the given subquery's single selected column — "match this
		 * row's own name, or match via a related row surfaced by a differently-matched subquery" (e.g. an
		 * agency's own name, or a client name joined back to its agency id). Column names are whitelisted
		 * constants supplied by the calling service; {@code term} is escaped internally.
		 *
		 * @param directColumn the column {@code CONTAINS_SUBSTR}-matched directly against {@code term}
		 * @param term         the search term (escaped internally)
		 * @param joinColumn   the column tested for subquery membership (may equal {@code directColumn})
		 * @param subquery     a subquery selecting {@code joinColumn}'s matching values via a different
		 *                     match path; a {@code null} subquery (or one with blank SQL) skips the
		 *                     subquery half and keeps only the direct match
		 * @return this builder
		 */
		public Builder whereContainsSubstrOrInSubquery(
				String directColumn, String term, String joinColumn, BqRequest subquery) {
			String direct = BqSql.containsSubstr(directColumn, term);
			if (subquery == null || subquery.sql() == null || subquery.sql().isBlank()) {
				predicates.add(direct);
				return this;
			}
			String viaSubquery = BqSql.col(joinColumn) + " IN (SELECT "
					+ BqSql.col(joinColumn) + " FROM (" + subquery.sql() + "))";
			predicates.add("(" + direct + " OR " + viaSubquery + ")");
			return this;
		}

		/**
		 * Adds a predicate matching either {@code CONTAINS_SUBSTR(directColumn, term)} directly, or a
		 * composite key from the current row existing in a subquery.
		 *
		 * <p>Used where a single id is not enough to join safely. In the IO-lines client list,
		 * {@code advertiser_id = 0} appears under many agencies, so matching by advertiser id alone would
		 * leak mart-client search results across agencies. BigQuery's {@code STRUCT(...)} membership keeps
		 * the agency/client pair intact.
		 *
		 * @param directColumn the column {@code CONTAINS_SUBSTR}-matched directly against {@code term}
		 * @param term         the search term (escaped internally)
		 * @param joinColumns  the composite key columns, supplied as whitelisted constants
		 * @param subquery     a subquery selecting the same composite key columns
		 * @return this builder
		 */
		public Builder whereContainsSubstrOrStructInSubquery(
				String directColumn, String term, List<String> joinColumns, BqRequest subquery) {
			String direct = BqSql.containsSubstr(directColumn, term);
			if (subquery == null || subquery.sql() == null || subquery.sql().isBlank() || joinColumns.isEmpty()) {
				predicates.add(direct);
				return this;
			}
			String columns = joinColumns.stream().map(BqSql::col).collect(Collectors.joining(", "));
			String viaSubquery = "STRUCT(" + columns + ") IN (SELECT AS STRUCT " + columns
					+ " FROM (" + subquery.sql() + "))";
			predicates.add("(" + direct + " OR " + viaSubquery + ")");
			return this;
		}

		/**
		 * Adds one predicate matching {@code term} as a substring of <em>any</em> of the given columns -
		 * the shape a single search box needs, where the user knows one of several names and does not
		 * say which. ORed together and parenthesized, so the group still ANDs with every other
		 * predicate rather than widening the query past them.
		 *
		 * <p>A blank term adds nothing: an empty search means "no restriction", not "match rows whose
		 * name contains the empty string" - which is every row, but only after BigQuery has been asked.
		 *
		 * @param columns the columns to match, whitelisted constants supplied by the calling service
		 * @param term    the raw search term, escaped internally
		 * @return this builder
		 */
		public Builder whereContainsSubstrAnyOf(List<String> columns, String term) {
			if (term == null || term.isBlank() || columns.isEmpty()) {
				return this;
			}
			predicates.add(BqSql.anyOf(columns.stream()
					.map(column -> BqSql.containsSubstr(column, term))
					.toArray(String[]::new)));
			return this;
		}

		private Long parseLong(String value) {
			try {
				return Long.valueOf(value.trim());
			} catch (NumberFormatException ex) {
				return null;
			}
		}

		private void require(boolean condition, String message) {
			if (!condition) {
				throw new IllegalStateException(message);
			}
		}
	}
}
