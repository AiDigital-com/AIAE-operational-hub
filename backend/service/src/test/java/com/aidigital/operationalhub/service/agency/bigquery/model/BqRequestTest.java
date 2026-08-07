package com.aidigital.operationalhub.service.agency.bigquery.model;

import com.aidigital.operationalhub.service.agency.search.AgencyField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link BqRequest.Builder}, the reusable BigQuery statement builder.
 */
class BqRequestTest {

	private FilterCriterion<AgencyField> filter(String value, FilterOperation operation, boolean caseSensitive) {
		return new FilterCriterion<>(AgencyField.NAME, value, operation, caseSensitive);
	}

	@Test
	void shouldBuildPagedDataQueryTest() {
		// Execution
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id", "id")
				.selectAnyValue("agency", "name")
				.whereNotNull("agency_id")
				.groupBy("agency_id")
				.orderBy("LOWER(ANY_VALUE(`agency`))")
				.sortBy(new SortCriterion<>(AgencyField.NAME, SortDirection.ASC))
				.page(2, 16)
				.build()
				.sql();

		// Verification
		assertThat(sql).isEqualTo("SELECT `agency_id` AS id, ANY_VALUE(`agency`) AS name "
				+ "FROM `io_lines` WHERE `agency_id` IS NOT NULL GROUP BY `agency_id` "
				+ "ORDER BY LOWER(ANY_VALUE(`agency`)) ASC NULLS LAST LIMIT 16 OFFSET 16");
	}

	@Test
	void shouldGroupByEveryRequestedColumnInCallOrderTest() {
		// Given: a report grouped by the several dimensions a user picked, aggregating its metrics
		BqRequest.Builder builder = new BqRequest.Builder()
				.from("adjustments_view")
				.select("date")
				.select("channel")
				.selectSum("impressions", "impressions")
				.groupBy("date")
				.groupBy("channel");

		// When:
		String sql = builder.build().sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `date` AS date, `channel` AS channel, "
				+ "SUM(`impressions`) AS impressions FROM `adjustments_view` GROUP BY `date`, `channel`");
	}

	@Test
	void shouldOmitTheGroupByClauseWhenNoColumnIsGroupedTest() {
		// Given: the ungrouped, raw-row form of the same read
		BqRequest.Builder builder = new BqRequest.Builder().from("adjustments_view").select("date");

		// When:
		String sql = builder.build().sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `date` AS date FROM `adjustments_view`");
	}

	@Test
	void shouldBuildCountQueryOverTheSameWhereClauseTest() {
		// Execution
		BqRequest.Builder builder = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id", "id")
				.countDistinct("agency_id")
				.whereNotNull("agency_id")
				.filter("agency", false, filter("acme", FilterOperation.CONTAINS, false));

		// Verification: the same builder yields a count and a data query sharing the WHERE clause
		assertThat(builder.buildCount().sql()).isEqualTo(
				"SELECT COUNT(DISTINCT `agency_id`) AS total FROM `io_lines` "
						+ "WHERE `agency_id` IS NOT NULL AND CONTAINS_SUBSTR(`agency`, 'acme')");
		assertThat(builder.build().sql()).contains("WHERE `agency_id` IS NOT NULL AND CONTAINS_SUBSTR(`agency`, " +
				"'acme')");
	}

	@Test
	void shouldBuildEveryFilterPredicateShapeTest() {
		// Execution + Verification
		assertThat(predicate("id", true, filter("42", FilterOperation.EQUALS, false)))
				.contains("`id` = 42");
		assertThat(predicate("agency", false, filter("Acme", FilterOperation.CONTAINS, true)))
				.contains("STRPOS(`agency`, 'Acme') > 0");
		assertThat(predicate("agency", false, filter("Acme", FilterOperation.EQUALS, false)))
				.contains("LOWER(`agency`) = LOWER('Acme')");
		assertThat(predicate("agency", false, filter("Acme", FilterOperation.EQUALS, true)))
				.contains("`agency` = 'Acme'");
		assertThat(predicate("agency", false, filter("O'Hara", FilterOperation.CONTAINS, false)))
				.contains("CONTAINS_SUBSTR(`agency`, 'O\\'Hara')");
	}

	@Test
	void shouldSkipUnapplicableFiltersTest() {
		// Given: an invalid numeric value and a null value produce no predicate
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.whereNotNull("agency_id")
				.filter("agency_id", true, filter("not-a-number", FilterOperation.EQUALS, false))
				.filter("agency", false, filter(null, FilterOperation.CONTAINS, false))
				.build()
				.sql();

		// Verification: only the base predicate remains
		assertThat(sql).contains("WHERE `agency_id` IS NOT NULL");
		assertThat(sql).doesNotContain("AND");
	}

	@Test
	void shouldBuildInClauseAndDescendingOrderTest() {
		// Execution
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.whereIn("agency_id", List.of(1L, 2L, 3L))
				.orderBy("`agency_id`")
				.sortBy(new SortCriterion<>(AgencyField.ID, SortDirection.DESC))
				.build()
				.sql();

		// Verification
		assertThat(sql).contains("WHERE `agency_id` IN (1, 2, 3)");
		assertThat(sql).contains("ORDER BY `agency_id` DESC NULLS LAST");
	}

	@Test
	void shouldBindDirectionToThePrimaryExpressionNotTheTiebreakerTest() {
		// Execution: a DESC sort plus a tiebreaker - the direction must land on the primary column, not
		// on the fixed-ascending tiebreaker appended after it
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.orderBy("`spend`")
				.tiebreaker("constructed_id")
				.sortBy(new SortCriterion<>(AgencyField.ID, SortDirection.DESC))
				.build()
				.sql();

		// Verification
		assertThat(sql).contains("ORDER BY `spend` DESC NULLS LAST, `constructed_id` ASC");
	}

	@Test
	void shouldAppendMultipleTiebreakersOnceAndInOrderTest() {
		// Execution: callers can pass the whole deterministic chain without pre-deduplicating it.
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.orderBy("`date`")
				.tiebreaker("constructed_id")
				.tiebreakers(List.of("platform", "constructed_id", "account"))
				.build()
				.sql();

		// Verification
		assertThat(sql)
				.contains("ORDER BY `date` ASC NULLS LAST, `constructed_id` ASC, `platform` ASC, `account` ASC");
		assertThat(sql).doesNotContain("`constructed_id` ASC, `constructed_id` ASC");
	}

	@Test
	void shouldDefaultToAscendingWhenSortIsNullTest() {
		// Execution: a null sort still produces an ascending order-by
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.orderBy("`agency_id`")
				.sortBy(null)
				.build()
				.sql();

		// Verification
		assertThat(sql).contains("ORDER BY `agency_id` ASC NULLS LAST");
	}

	@Test
	void shouldOmitEmptyInClauseAndOptionalClausesTest() {
		// Execution: no predicates, no group by / order by / page
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.whereIn("agency_id", List.of())
				.build()
				.sql();

		// Verification
		assertThat(sql).isEqualTo("SELECT `x` AS x FROM `io_lines`");
	}

	@Test
	void shouldBuildAnInClauseOverEscapedStringLiteralsTest() {
		// Execution: a value containing a single quote must not break out of its literal
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.whereInStrings("channel", List.of("Display", "O'Brien's Video"))
				.build()
				.sql();

		// Verification
		assertThat(sql).contains("WHERE `channel` IN ('Display', 'O\\'Brien\\'s Video')");
	}

	@Test
	void shouldOmitEmptyStringInClauseTest() {
		// Execution
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.whereInStrings("channel", List.of())
				.build()
				.sql();

		// Verification
		assertThat(sql).isEqualTo("SELECT `x` AS x FROM `io_lines`");
	}

	@Test
	void shouldBuildInSubqueryPredicateTest() {
		// Given: a mart subquery selects campaign names that should constrain the outer IO query
		BqRequest subquery = new BqRequest.Builder()
				.from("adjustments_view")
				.distinct()
				.select("CNB_campaign_name")
				.whereEquals("CNB_client", "Sunland Park")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("campaign_id")
				.whereInSubquery("campaign", "CNB_campaign_name", subquery)
				.build()
				.sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `campaign_id` AS campaign_id FROM `io_lines` WHERE "
				+ "`campaign` IN (SELECT `CNB_campaign_name` FROM (SELECT DISTINCT "
				+ "`CNB_campaign_name` AS CNB_campaign_name FROM `adjustments_view` "
				+ "WHERE `CNB_client` = 'Sunland Park'))");
	}

	@Test
	void shouldBuildNotInSubqueryPredicateTest() {
		// Given: a mart subquery selects campaign names that should be excluded from the outer IO query
		BqRequest subquery = new BqRequest.Builder()
				.from("adjustments_view")
				.distinct()
				.select("CNB_campaign_name")
				.whereNotNull("CNB_campaign_name")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("campaign_id")
				.whereNotInSubquery("campaign", "CNB_campaign_name", subquery)
				.build()
				.sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `campaign_id` AS campaign_id FROM `io_lines` WHERE "
				+ "`campaign` NOT IN (SELECT `CNB_campaign_name` FROM (SELECT DISTINCT "
				+ "`CNB_campaign_name` AS CNB_campaign_name FROM `adjustments_view` "
				+ "WHERE `CNB_campaign_name` IS NOT NULL))");
	}

	@Test
	void shouldBuildBlankAndNormalizedNotInPredicatesTest() {
		// When:
		String sql = new BqRequest.Builder()
				.from("adjustments_view")
				.select("CNB_campaign_name")
				.whereNotBlank("CNB_client")
				.whereNormalizedNotInStrings("CNB_client", List.of("-", "Null", "Client without name"))
				.build()
				.sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `CNB_campaign_name` AS CNB_campaign_name "
				+ "FROM `adjustments_view` WHERE TRIM(`CNB_client`) != '' "
				+ "AND LOWER(TRIM(`CNB_client`)) NOT IN ('-', 'null', 'client without name')");
	}

	@Test
	void shouldValidateRequiredFieldsTest() {
		// Execution + Verification
		assertThatThrownBy(() -> new BqRequest.Builder().select("x").build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("from");
		assertThatThrownBy(() -> new BqRequest.Builder().from("t").build())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("select");
		assertThatThrownBy(() -> new BqRequest.Builder().from("t").buildCount())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("countDistinct");
	}

	@Test
	void shouldPrefixSelectListWithDistinctTest() {
		// Given: distinct() is set alongside a plain multi-column select list
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.distinct()
				.select("advertiser_id", "id")
				.select("advertiser", "name")
				.build()
				.sql();

		// Then
		assertThat(sql).isEqualTo("SELECT DISTINCT `advertiser_id` AS id, `advertiser` AS name FROM `io_lines`");
	}

	@Test
	void shouldBuildEverySelectHelperExpressionTest() {
		// Given: one select item per builder helper, in insertion order
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.select("advertiser_id", "client_id")
				.selectAnyValue("agency")
				.selectAnyValue("advertiser", "client_name")
				.selectCountDistinct("advertiser_id", "clients_count")
				.selectMin("order_start_date", "start_date")
				.selectMax("order_end_date", "end_date")
				.selectSum("order_budget", "budget")
				.selectArrayAggDistinct("media_tactic", "channels")
				.build()
				.sql();

		// Then: each helper wraps and aliases its column exactly, joined in insertion order
		assertThat(sql).isEqualTo("SELECT `agency_id` AS agency_id, `advertiser_id` AS client_id, "
				+ "ANY_VALUE(`agency`) AS agency, ANY_VALUE(`advertiser`) AS client_name, "
				+ "COUNT(DISTINCT `advertiser_id`) AS clients_count, MIN(`order_start_date`) AS start_date, "
				+ "MAX(`order_end_date`) AS end_date, SUM(`order_budget`) AS budget, "
				+ "ARRAY_AGG(DISTINCT `media_tactic` IGNORE NULLS) AS channels FROM `io_lines`");
	}

	@Test
	void shouldNestAPreviouslyBuiltRequestAsAParenthesizedFromSourceTest() {
		// Given: an inner request wrapped by an outer one via from(BqRequest)
		BqRequest inner = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.whereNotNull("agency_id")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from(inner)
				.select("agency_id")
				.build()
				.sql();

		// Then: the inner statement is embedded verbatim in parentheses, not backtick-quoted as a table
		assertThat(sql).isEqualTo(
				"SELECT `agency_id` AS agency_id FROM (SELECT `agency_id` AS agency_id FROM `io_lines` "
						+ "WHERE `agency_id` IS NOT NULL)");
	}

	@Test
	void shouldLeftJoinASubqueryUnderAnAliasBeforeTheWhereClauseTest() {
		// Given: a second mart to bring alongside the first, its metric aliased apart from the main
		// source's column of the same name
		BqRequest conversions = new BqRequest.Builder()
				.from("conversions_view")
				.selectExpression(BqSql.sum("conversions"), "conv_conversions")
				.select("date")
				.groupBy("date")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from("adjustments_view")
				.select("impressions")
				.select("conv_conversions")
				.leftJoin(conversions, "c", "`date` = c.date")
				.whereNotNull("impressions")
				.build()
				.sql();

		// Then: the join sits between FROM and WHERE, and the inner statement is embedded verbatim
		assertThat(sql).isEqualTo(
				"SELECT `impressions` AS impressions, `conv_conversions` AS conv_conversions "
						+ "FROM `adjustments_view` "
						+ "LEFT JOIN (SELECT SUM(`conversions`) AS conv_conversions, `date` AS date "
						+ "FROM `conversions_view` GROUP BY `date`) c ON `date` = c.date "
						+ "WHERE `impressions` IS NOT NULL");
	}

	@Test
	void shouldRenderNoJoinClauseWhenNoneWasAskedForTest() {
		// Given + When: every existing query, which joins nothing
		String sql = new BqRequest.Builder()
				.from("adjustments_view")
				.select("impressions")
				.build()
				.sql();

		// Then: byte-for-byte what it rendered before the join existed
		assertThat(sql).isEqualTo("SELECT `impressions` AS impressions FROM `adjustments_view`");
	}

	@Test
	void shouldBuildARowNumberWindowSelectItemTest() {
		// Given/When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.selectRowNumber("agency_id", "LOWER(`advertiser`)", "rn")
				.build()
				.sql();

		// Then:
		assertThat(sql).isEqualTo("SELECT `agency_id` AS agency_id, "
				+ "ROW_NUMBER() OVER (PARTITION BY `agency_id` ORDER BY LOWER(`advertiser`)) AS rn FROM `io_lines`");
	}

	@Test
	void shouldBuildALessThanOrEqualPredicateTest() {
		// Given/When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.whereLessThanOrEqual("rn", 16)
				.build()
				.sql();

		// Then:
		assertThat(sql).contains("WHERE `rn` <= 16");
	}

	@Test
	void shouldBuildAContainsSubstrPredicateWithEscapedTermTest() {
		// Given/When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.whereContainsSubstr("agency", "O'Brien")
				.build()
				.sql();

		// Then:
		assertThat(sql).contains("WHERE CONTAINS_SUBSTR(`agency`, 'O\\'Brien')");
	}

	@Test
	void shouldOrTheDirectMatchWithSubqueryMembershipWhenASubqueryIsGivenTest() {
		// Given:
		BqRequest subquery = new BqRequest.Builder()
				.from("io_lines")
				.distinct()
				.select("agency_id")
				.whereContainsSubstr("advertiser", "Ford")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.whereContainsSubstrOrInSubquery("agency", "Ford", "agency_id", subquery)
				.build()
				.sql();

		// Then:
		assertThat(sql).contains("WHERE (CONTAINS_SUBSTR(`agency`, 'Ford') OR `agency_id` IN (SELECT `agency_id` FROM (" + subquery.sql() + ")))");
	}

	@Test
	void shouldOrTheDirectMatchWithCompositeSubqueryMembershipTest() {
		// Given:
		BqRequest subquery = new BqRequest.Builder()
				.from("io_lines")
				.distinct()
				.select("agency_id")
				.select("advertiser_id")
				.build();

		// When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("advertiser_id")
				.whereContainsSubstrOrStructInSubquery(
						"advertiser", "Ford", List.of("agency_id", "advertiser_id"), subquery)
				.build()
				.sql();

		// Then:
		assertThat(sql).contains("WHERE (CONTAINS_SUBSTR(`advertiser`, 'Ford') "
				+ "OR STRUCT(`agency_id`, `advertiser_id`) IN (SELECT AS STRUCT "
				+ "`agency_id`, `advertiser_id` FROM (" + subquery.sql() + ")))");
	}

	@Test
	void shouldSkipTheSubqueryHalfWhenNoSubqueryIsGivenTest() {
		// Given/When:
		String sql = new BqRequest.Builder()
				.from("io_lines")
				.select("agency_id")
				.whereContainsSubstrOrInSubquery("agency", "Ford", "agency_id", null)
				.build()
				.sql();

		// Then:
		assertThat(sql).contains("WHERE CONTAINS_SUBSTR(`agency`, 'Ford')");
		assertThat(sql).doesNotContain(" OR ");
	}

	private String predicate(String column, boolean numeric, FilterCriterion<AgencyField> filter) {
		return new BqRequest.Builder()
				.from("io_lines")
				.select("x")
				.filter(column, numeric, filter)
				.build()
				.sql();
	}
}
