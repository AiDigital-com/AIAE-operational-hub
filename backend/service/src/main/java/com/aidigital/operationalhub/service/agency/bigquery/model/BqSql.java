package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Assembles quoted BigQuery SQL fragments from whitelisted column names, centralising backtick
 * quoting and aggregate-function wrapping for {@link BqRequest} and its callers.
 *
 * <p>Column names passed to every method here are always compile-time constants from fixed
 * whitelists defined by the calling service, never user input. Keeping every backtick and every
 * literal escape in this one class is what makes that claim auditable in a single read.
 *
 * <p>The public half is the vocabulary services and enums compose expressions from - including places
 * that have no builder to call, like {@code ReportRowSortField}'s constants and
 * {@link ReportRowMetricSql}, which are static and resolved at class load. The package-private half is
 * used only by {@link BqRequest.Builder}, whose own methods are the intended way to reach it.
 */
public final class BqSql {

	/**
	 * Quotes a column name.
	 *
	 * @param column the unquoted column name
	 * @return the backtick-quoted column, e.g. {@code `col`}
	 */
	public static String col(String column) {
		return "`" + column + "`";
	}

	/**
	 * Escapes and quotes a string literal. Used by services that build a trusted SQL fragment for a
	 * search term; the value is user input but is properly escaped here, and the column it is tested
	 * against is always a fixed whitelist constant.
	 *
	 * @param value the raw value
	 * @return the quoted BigQuery string literal, e.g. {@code 'O\\'Brien'}
	 */
	public static String literal(String value) {
		return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
	}

	/**
	 * Wraps a column in {@code ANY_VALUE(...)}, picking an arbitrary value per group.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code ANY_VALUE(`col`)}
	 */
	public static String anyValue(String column) {
		return "ANY_VALUE(" + col(column) + ")";
	}

	/**
	 * Wraps a column in {@code LOWER(ANY_VALUE(...))}, the canonical case-insensitive name sort
	 * expression used across the search services.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code LOWER(ANY_VALUE(`col`))}
	 */
	public static String lowerAnyValue(String column) {
		return "LOWER(" + anyValue(column) + ")";
	}

	/**
	 * Wraps a column in {@code CONTAINS_SUBSTR(...)} against an escaped, quoted string literal.
	 *
	 * @param column the unquoted column name
	 * @param term   the raw search term - escaped and quoted internally, never pre-escaped by the caller
	 * @return the wrapped expression, e.g. {@code CONTAINS_SUBSTR(`col`, 'term')}
	 */
	static String containsSubstr(String column, String term) {
		return "CONTAINS_SUBSTR(" + col(column) + ", " + literal(term) + ")";
	}

	/**
	 * Wraps a column in {@code COUNT(DISTINCT ...)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code COUNT(DISTINCT `col`)}
	 */
	public static String countDistinct(String column) {
		return "COUNT(DISTINCT " + col(column) + ")";
	}

	/**
	 * Wraps a column in {@code MIN(...)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code MIN(`col`)}
	 */
	static String min(String column) {
		return "MIN(" + col(column) + ")";
	}

	/**
	 * Wraps a column in {@code MAX(...)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code MAX(`col`)}
	 */
	static String max(String column) {
		return "MAX(" + col(column) + ")";
	}

	/**
	 * Renders {@code CURRENT_DATE()} - today, as BigQuery reckons it.
	 *
	 * @return the rendered expression
	 */
	static String currentDate() {
		return "CURRENT_DATE()";
	}

	/**
	 * Reads an expression as a date, yielding {@code NULL} rather than failing the query when it does not
	 * parse as one.
	 *
	 * <p>For dates arriving from a source whose column type is not ours to guarantee. A cast that returns
	 * {@code NULL} costs one row its place in the order; a hard cast costs the whole query.
	 *
	 * @param expression the expression to read
	 * @return the rendered {@code SAFE_CAST(expression AS DATE)}
	 */
	static String safeCastDate(String expression) {
		return "SAFE_CAST(" + expression + " AS DATE)";
	}

	/**
	 * Whole days from {@code from} to {@code to}, negative when {@code to} is the earlier of the two.
	 *
	 * @param to   the later expression
	 * @param from the earlier expression
	 * @return the rendered {@code DATE_DIFF(to, from, DAY)}
	 */
	static String daysBetween(String to, String from) {
		return "DATE_DIFF(" + to + ", " + from + ", DAY)";
	}

	/**
	 * Wraps a column in {@code SUM(...)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code SUM(`col`)}
	 */
	public static String sum(String column) {
		return "SUM(" + col(column) + ")";
	}

	/**
	 * Wraps a column in {@code AVG(...)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code AVG(`col`)}
	 */
	public static String avg(String column) {
		return "AVG(" + col(column) + ")";
	}

	/**
	 * Wraps an already-built expression in {@code SUM(...)} - the expression-level counterpart of
	 * {@link #sum(String)}, for summing something that is not a bare column (a {@code CASE}, a product).
	 *
	 * @param expression the expression to sum, built from this class
	 * @return the {@code SUM(expression)} SQL
	 */
	public static String sumOf(String expression) {
		return "SUM(" + expression + ")";
	}

	/**
	 * Builds {@code SAFE_DIVIDE(numerator, denominator)} - null rather than an error when the
	 * denominator is zero, which is how every derived ratio in the report avoids blowing up on an
	 * undelivered row.
	 *
	 * @param numerator   the numerator expression
	 * @param denominator the denominator expression
	 * @return the {@code SAFE_DIVIDE} SQL
	 */
	public static String safeDivide(String numerator, String denominator) {
		return "SAFE_DIVIDE(" + numerator + ", " + denominator + ")";
	}

	/**
	 * Builds {@code (left * right)}, parenthesised so it composes safely inside a larger expression.
	 *
	 * @param left  the left operand expression
	 * @param right the right operand expression
	 * @return the product SQL
	 */
	public static String multiply(String left, String right) {
		return "(" + left + " * " + right + ")";
	}

	/**
	 * Builds {@code (left / right)} - plain division, for a divisor that is a constant and so cannot be
	 * zero. Use {@link #safeDivide(String, String)} whenever the divisor comes from the data.
	 *
	 * @param left  the numerator expression
	 * @param right the denominator expression
	 * @return the quotient SQL
	 */
	public static String divide(String left, String right) {
		return "(" + left + " / " + right + ")";
	}

	/**
	 * Builds {@code `column` IN ('a', 'b', ...)}, each value escaped as a string literal.
	 *
	 * @param column the unquoted column name
	 * @param values the values to match
	 * @return the {@code IN} predicate SQL
	 */
	public static String in(String column, Collection<String> values) {
		return col(column) + " IN (" + values.stream().map(BqSql::literal).collect(Collectors.joining(", ")) + ")";
	}

	/**
	 * Builds {@code expression <= value}.
	 *
	 * @param expression the left-hand expression
	 * @param value      the right-hand expression
	 * @return the comparison SQL
	 */
	public static String atMost(String expression, String value) {
		return expression + " <= " + value;
	}

	/**
	 * Builds {@code expression > value}.
	 *
	 * @param expression the left-hand expression
	 * @param value      the right-hand expression
	 * @return the comparison SQL
	 */
	public static String greaterThan(String expression, String value) {
		return expression + " > " + value;
	}

	/**
	 * Builds {@code `column` = 'value'}, the value escaped as a string literal.
	 *
	 * @param column the unquoted column name
	 * @param value  the value to match
	 * @return the equality predicate SQL
	 */
	public static String equalsLiteral(String column, String value) {
		return col(column) + " = " + literal(value);
	}

	/**
	 * Lower-cases and trims an expression for comparison.
	 *
	 * <p>The one definition of what "the same name" means across the marts, which are filled by different
	 * pipelines and disagree about capitalisation and stray spaces. Both sides of any name comparison go
	 * through this - a comparison normalized on one side only silently matches nothing.
	 *
	 * @param expression the expression to normalize
	 * @return the normalized expression SQL
	 */
	public static String normalized(String expression) {
		return "LOWER(TRIM(" + expression + "))";
	}

	/**
	 * Builds {@code COALESCE(expression, 'fallback')}, the fallback escaped as a string literal - how an
	 * absent value is given one of its own so that two absent values compare equal, which
	 * {@code NULL = NULL} does not.
	 *
	 * @param expression the expression that may be null
	 * @param fallback   the value standing in for absent
	 * @return the coalesce SQL
	 */
	public static String coalesce(String expression, String fallback) {
		return "COALESCE(" + expression + ", " + literal(fallback) + ")";
	}

	/**
	 * Builds {@code (a OR b OR ...)}, parenthesised so it composes safely inside a larger predicate.
	 *
	 * @param conditions the conditions to disjoin
	 * @return the {@code OR} predicate SQL
	 */
	public static String anyOf(String... conditions) {
		return "(" + String.join(" OR ", conditions) + ")";
	}

	/**
	 * Builds {@code (a AND b AND ...)}, parenthesised so it composes safely inside a larger predicate.
	 *
	 * @param conditions the conditions to conjoin
	 * @return the {@code AND} predicate SQL
	 */
	public static String allOf(String... conditions) {
		return "(" + String.join(" AND ", conditions) + ")";
	}

	/**
	 * Builds {@code NOT (condition)}.
	 *
	 * @param condition the condition to negate
	 * @return the negated predicate SQL
	 */
	public static String not(String condition) {
		return "NOT (" + condition + ")";
	}

	/**
	 * Builds {@code MOD(`column`, divisor)}.
	 *
	 * @param column  the unquoted column name
	 * @param divisor the divisor
	 * @return the {@code MOD} SQL
	 */
	public static String mod(String column, int divisor) {
		return "MOD(" + col(column) + ", " + divisor + ")";
	}

	/**
	 * Builds {@code ROUND(expression, digits)}.
	 *
	 * @param expression the expression to round
	 * @param digits     the number of decimal places
	 * @return the {@code ROUND} SQL
	 */
	public static String round(String expression, int digits) {
		return "ROUND(" + expression + ", " + digits + ")";
	}

	/**
	 * Builds a searched {@code CASE WHEN condition THEN result ... ELSE fallback END}, in the map's
	 * iteration order - pass a {@link java.util.LinkedHashMap}, since a searched {@code CASE} takes the
	 * first matching branch and order is therefore part of the meaning.
	 *
	 * @param resultsByCondition each condition, mapped to the expression it yields
	 * @param fallback           the {@code ELSE} expression, or {@code null} to omit it (yielding NULL)
	 * @return the {@code CASE} SQL
	 */
	public static String caseWhen(Map<String, String> resultsByCondition, String fallback) {
		StringBuilder sql = new StringBuilder("CASE");
		resultsByCondition.forEach((condition, result) ->
				sql.append(" WHEN ").append(condition).append(" THEN ").append(result));
		if (fallback != null) {
			sql.append(" ELSE ").append(fallback);
		}
		return sql.append(" END").toString();
	}

	/**
	 * Builds a {@code CASE subject WHEN 0 THEN ... END} over numeric keys - the counterpart of
	 * {@link #caseOf(String, Map)} for a subject that is a number, whose keys must not be quoted.
	 *
	 * @param subject         the expression being matched
	 * @param resultsByNumber each number the subject may equal, mapped to the expression it yields
	 * @return the {@code CASE} SQL
	 */
	public static String caseOfNumber(String subject, Map<Integer, String> resultsByNumber) {
		StringBuilder sql = new StringBuilder("CASE ").append(subject);
		resultsByNumber.forEach((value, result) ->
				sql.append(" WHEN ").append(value).append(" THEN ").append(result));
		return sql.append(" END").toString();
	}

	/**
	 * Builds a {@code CASE subject WHEN 'literal' THEN result ... END}, in the map's iteration order -
	 * pass a {@link java.util.LinkedHashMap} when the order matters. Keys are string literals (escaped
	 * via {@link #literal(String)}); values are expressions built from this class. A subject matching no
	 * key yields {@code NULL}, since no {@code ELSE} is emitted.
	 *
	 * @param subject          the expression being matched
	 * @param resultsByLiteral each literal the subject may equal, mapped to the expression it yields
	 * @return the {@code CASE} SQL
	 */
	public static String caseOf(String subject, Map<String, String> resultsByLiteral) {
		StringBuilder sql = new StringBuilder("CASE ").append(subject);
		resultsByLiteral.forEach((value, result) ->
				sql.append(" WHEN ").append(literal(value)).append(" THEN ").append(result));
		return sql.append(" END").toString();
	}

	/**
	 * Wraps a column in {@code ARRAY_AGG(DISTINCT ... IGNORE NULLS)}.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code ARRAY_AGG(DISTINCT `col` IGNORE NULLS)}
	 */
	static String arrayAggDistinct(String column) {
		return "ARRAY_AGG(DISTINCT " + col(column) + " IGNORE NULLS)";
	}

	/**
	 * Wraps an arbitrary expression in {@code ARRAY_AGG(DISTINCT ... IGNORE NULLS)} - the
	 * expression-level counterpart of {@link #arrayAggDistinct(String)}, for aggregating something that
	 * is not a bare column (a conditional {@code CASE}, in particular - the shape a folded per-level
	 * name-resolution read needs, one conditional aggregate per level over a single scan).
	 *
	 * @param expression the expression to aggregate, built from this class
	 * @return the wrapped expression
	 */
	public static String arrayAggDistinctExpression(String expression) {
		return "ARRAY_AGG(DISTINCT " + expression + " IGNORE NULLS)";
	}

	/**
	 * Wraps a boolean expression in {@code LOGICAL_OR(...)} - true when any row in the aggregated group
	 * satisfies it, used to fold an existence check ("does any row in scope match?") into the same
	 * conditional-aggregate scan as other per-row checks instead of a separate {@code LIMIT 1} read.
	 *
	 * @param condition the boolean expression to aggregate
	 * @return the wrapped expression
	 */
	public static String logicalOr(String condition) {
		return "LOGICAL_OR(" + condition + ")";
	}

	/**
	 * Builds {@code `column` IS NOT NULL} as a composable expression - the expression-level counterpart
	 * of {@link BqRequest.Builder#whereNotNull(String)}, for building a larger expression (a
	 * {@code CASE} condition inside an aggregate, say) rather than adding a standalone predicate.
	 *
	 * @param column the unquoted column name
	 * @return the rendered expression
	 */
	public static String isNotNull(String column) {
		return col(column) + " IS NOT NULL";
	}

	/**
	 * Wraps a column in {@code COUNT(DISTINCT ...) OVER ()}, a window function computing the total
	 * distinct-value count across the whole (post {@code GROUP BY}, pre {@code LIMIT}) result set, so a
	 * paged query can carry its own total without a separate count job.
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code COUNT(DISTINCT `col`) OVER ()}
	 */
	static String countDistinctOverAll(String column) {
		return countDistinct(column) + " OVER ()";
	}

	/**
	 * The whole result's row count as a window function, {@code COUNT(*) OVER ()} - for a query whose
	 * rows have no single distinct key to count, unlike {@link #countDistinctOverAll(String)}.
	 *
	 * <p>Evaluated after {@code GROUP BY} and before {@code LIMIT}, so on a grouped query it counts
	 * groups rather than source rows, and on any query it ignores the page window.
	 *
	 * @return {@code "COUNT(*) OVER ()"}
	 */
	static String countAllOverAll() {
		return "COUNT(*) OVER ()";
	}

	/**
	 * Wraps a column in a plain (non-aggregating) {@code LOWER(...)}, for a case-insensitive ordering
	 * over ungrouped rows — e.g. inside a {@link BqRequest.Builder#selectRowNumber} partition, where
	 * {@link #lowerAnyValue} would be wrong (there is no aggregation to pick an arbitrary value from).
	 *
	 * @param column the unquoted column name
	 * @return the wrapped expression, e.g. {@code LOWER(`col`)}
	 */
	public static String lower(String column) {
		return "LOWER(" + col(column) + ")";
	}

	/**
	 * Ranks rows within each partition, over several partition columns.
	 *
	 * @param partitionByColumns the unquoted columns to partition by, in order
	 * @param orderByExpression  the pre-rendered ordering expression within each partition, direction
	 *                           included
	 * @return the window-function expression
	 */
	public static String rowNumberOverPartitionBy(List<String> partitionByColumns, String orderByExpression) {
		String columns = partitionByColumns.stream().map(BqSql::col).collect(Collectors.joining(", "));
		return "ROW_NUMBER() OVER (PARTITION BY " + columns + " ORDER BY " + orderByExpression + ")";
	}

	/**
	 * Wraps a partition/order pair in {@code ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)}, ranking
	 * rows within each partition — used to cap or paginate a result per group entirely in BigQuery,
	 * instead of transferring every row per group and truncating in application code.
	 *
	 * @param partitionByColumn the unquoted column to partition by
	 * @param orderByExpression the pre-rendered {@code ORDER BY} expression within each partition
	 * @return the window-function expression
	 */
	public static String rowNumberOverPartitionBy(String partitionByColumn, String orderByExpression) {
		return "ROW_NUMBER() OVER (PARTITION BY " + col(partitionByColumn) + " ORDER BY " + orderByExpression + ")";
	}

	private BqSql() {
		// static SQL-fragment factory only
	}
}
