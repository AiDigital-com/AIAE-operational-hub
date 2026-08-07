package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ReportRowConversionsSql}.
 */
class ReportRowConversionsSqlTest {

	@Test
	void shouldCountOnlyPrimaryConversionsByDefaultTest() {
		// Given + When: a report that did not ask for Google Ads' "all conversions"
		String sql = ReportRowConversionsSql.conversionValue(false);

		// Then: the plain column, with no per-platform branching to pay for
		assertThat(sql).isEqualTo("`conversions`");
	}

	@Test
	void shouldSwapInAllConversionsForGoogleAdsAloneWhenAskedTest() {
		// Given + When: a report that asked for every tracked action
		String sql = ReportRowConversionsSql.conversionValue(true);

		// Then: only Google Ads changes column - no other platform fills all_conversions
		assertThat(sql).isEqualTo(
				"CASE WHEN `platform` = 'Google Ads' THEN `all_conversions` ELSE `conversions` END");
	}

	@Test
	void shouldMatchLevelOneLooselyAndLevelThreeStrictlyTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.joinCondition(
				"date", "constructed_name", "constructed_name_lvl3", "CNB_channel");

		// Then: the date exactly, the names lower-cased and trimmed - the two marts are filled by
		// different pipelines and disagree about capitalisation and stray spaces. Every joined column is
		// read under its conv_ alias: the delivery side is an unaliased table, so a name both sides expose
		// would leave BigQuery with two candidate sources and it rejects the query rather than choose.
		assertThat(sql).contains("`date` = conv.`conv_date`");
		assertThat(sql).contains("LOWER(TRIM(`constructed_name`)) = LOWER(TRIM(conv.`conv_constructed_name`))");
		// And absent level 3 compares as a value of its own, so two rows without one match each other
		// rather than both failing the way NULL = NULL would
		assertThat(sql).contains(
				"LOWER(TRIM(COALESCE(`constructed_name_lvl3`, 'empty'))) "
						+ "= LOWER(TRIM(COALESCE(conv.`conv_constructed_name_lvl3`, 'empty')))");
	}

	@Test
	void shouldReadNoJoinedColumnUnderANameTheDeliverySideAlsoHasTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.joinCondition(
				"date", "constructed_name", "constructed_name_lvl3", "CNB_channel");

		// Then: qualifying with the alias is not enough on its own - BigQuery resolves conv.`date` fine, but
		// the same query reads `date` unqualified in its window, its filters and its select list, and there
		// it has two sources. Nothing the subquery exposes may share a delivery column's name.
		assertThat(sql).doesNotContain("conv.`date`");
		assertThat(sql).doesNotContain("conv.`constructed_name`");
		assertThat(sql).doesNotContain("conv.`constructed_name_lvl3`");
	}

	@Test
	void shouldDropLevelThreeFromTheConditionOnCampaignLevelChannelsTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.joinCondition(
				"date", "constructed_name", "constructed_name_lvl3", "CNB_channel");

		// Then: search and YouTube report conversions against the campaign, so there is no level-3 value
		// on the conversions side to match - the level-3 comparison is an alternative to them, not an
		// additional requirement
		assertThat(sql).contains("`CNB_channel` IN ('Google SEM', 'Google Search', 'YouTube') OR ");
	}

	@Test
	void shouldStateACampaignLevelChannelsConversionsOnItsTopRowOnlyTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.reportedConversions("CNB_channel", "date", "constructed_name", "impressions");

		// Then: dropping level 3 from the join means every creative's row matches the one conversions
		// row, so all but the highest-delivering read blank - otherwise the campaign's total would be
		// multiplied by the number of creatives that ran
		// The rank is inlined rather than selected as a column: a window function may sit inside a
		// select-list expression, but a select-list alias cannot be read by a sibling expression, so
		// naming it would cost an extra subquery
		assertThat(sql).isEqualTo(
				"CASE WHEN (`CNB_channel` IN ('Google SEM', 'Google Search', 'YouTube') "
						+ "AND ROW_NUMBER() OVER (PARTITION BY `date`, `constructed_name` "
						+ "ORDER BY `impressions` DESC) > 1) THEN NULL ELSE conv.`conv_conversions` END");
	}

	@Test
	void shouldLeaveEveryOtherChannelsConversionsOnEveryMatchingRowTest() {
		// Given: a channel that reports conversions against the creative
		String sql = ReportRowConversionsSql.reportedConversions("CNB_channel", "date", "constructed_name", "impressions");

		// When-Then: the rank gate is conditional on the channel, so a display row keeps its own
		// conversions whatever its rank within the day
		assertThat(sql).contains("ELSE conv.`conv_conversions`");
		assertThat(sql).doesNotContain("`conv_row_rank` > 1) THEN NULL WHEN");
	}

	@Test
	void shouldGuardConversionSideMetadataTheSameWayAsConversionsTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.reportedJoinedValue(
				"conv_created_at", "CNB_channel", "date", "constructed_name", "impressions");

		// Then: metadata follows the same top-row-only rule as conversions on campaign-level channels
		assertThat(sql).isEqualTo(
				"CASE WHEN (`CNB_channel` IN ('Google SEM', 'Google Search', 'YouTube') "
						+ "AND ROW_NUMBER() OVER (PARTITION BY `date`, `constructed_name` "
						+ "ORDER BY `impressions` DESC) > 1) THEN NULL ELSE conv.`conv_created_at` END");
	}

	@Test
	void shouldPickLatestConversionAuditValueInsideTheAggregatedConversionRowsTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.latestAuditValue("created_by");

		// Then: the conversion action rows are already being grouped away, so the audit value comes from
		// the latest adjusted action in that joined grain
		assertThat(sql).isEqualTo(
				"ARRAY_AGG(`created_by` IGNORE NULLS ORDER BY `last_modified_at` DESC LIMIT 1)[SAFE_OFFSET(0)]");
	}

	@Test
	void shouldMergeDeliveryAndConversionAdjustedMetricMarkersTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.mergedAdjustedMetrics("`adjusted_metrics`", "conv.`conv_adjusted_metrics`");

		// Then: ordinary delivery adjustments remain visible, conversion adjustments become visible, and
		// a row adjusted in both marts lists both markers
		assertThat(sql).contains("NULLIF(TRIM(`adjusted_metrics`), '') IS NULL");
		assertThat(sql).contains("NULLIF(TRIM(conv.`conv_adjusted_metrics`), '') IS NULL");
		assertThat(sql).contains("CONCAT(NULLIF(TRIM(`adjusted_metrics`), ''), ',', "
				+ "NULLIF(TRIM(conv.`conv_adjusted_metrics`), ''))");
	}

	@Test
	void shouldDropConversionsViewNonExistentDataSentinelFromAdjustedMetricMarkersTest() {
		// Given + When:
		String sql = ReportRowConversionsSql.adjustedMetricsAggregate();

		// Then: unmatched conversion-adjustment rows should not leak the view's data-quality sentinel into
		// the report's adjusted-metrics column.
		assertThat(sql).isEqualTo(
				"STRING_AGG(DISTINCT NULLIF(NULLIF(TRIM(`adjusted_metrics`), ''), 'Non-existent data'), ',')");
	}
}
