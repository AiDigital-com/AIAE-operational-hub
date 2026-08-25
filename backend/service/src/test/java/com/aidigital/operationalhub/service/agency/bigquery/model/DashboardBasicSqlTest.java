package com.aidigital.operationalhub.service.agency.bigquery.model;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link DashboardBasicSql}.
 *
 * <p>These pin the shape of the query, which is what the ClicData template depends on: the column names it
 * binds to, in the order it expects them, and the two switches a user may throw. They do not run the query.
 */
class DashboardBasicSqlTest {

	private static final String DELIVERY_VIEW = "p.operational_hub.platform_mart_adjustments_view_op_hub";
	private static final String CONVERSIONS_VIEW = "p.operational_hub.conversions_mart_adjustments_view_op_hub";
	private static final String PLANS_TABLE = "p.aidigital_database.elevate_plans_n_benches";

	@Test
	void shouldEmitTheTemplatesColumnsInItsOwnOrderTest() {
		// Given: the 51 columns the spreadsheet's Basic report produces, in its order, renamed to match the
		// ClicData template - see `backend/Clicdata matching (2).csv`
		List<String> expected = List.of(
				"Date", "week_start_date_monday", "Quarter", "Tactic", "Goal", "Channel", "Channel_Short_Name",
				"lvl1", "Campaign_Short_Name", "Creative", "CNB_audience", "CNB_geo", "CNB_language",
				"CNB_message", "CNB_creative_tag", "CNB_keyword_group", "CNB_flight_identifier", "CNB_other",
				"Impressions", "Clicks", "Cost", "Completions", "Conversions", "IVT", "CPC", "CPM", "CPV", "AVCR",
				"CTR", "IVT_Benchmark", "CPC_Benchmark", "CTR_Benchmark", "CPV_Benchmark", "CPC_Plan", "CPV_Plan",
				"CPM_Plan", "CTR_Impressions", "CPM_Impressions", "AVCR_Impressions", "CPA_Cost", "CPV_Cost",
				"CPM_Cost", "CPC_Cost", "CPC_Clicks", "CPA_Conversions", "CR_Benchmark", "CPA_Benchmark",
				"AVCR_Benchmark", "Line_Item_Description", "Revenue", "ROAS");

		// When:
		List<String> actual = DashboardBasicSql.outputColumns(true).stream()
				.map(DashboardBasicSqlTest::aliasOf)
				.toList();

		// Then:
		assertThat(actual).containsExactlyElementsOf(expected);
	}

	@Test
	void shouldExposeExactlyTheClicDataTemplatesNamesPlusTheHubsOwnUnmappedExtrasTest() {
		// Given: this output schema is a contract with ClicData, not a local naming choice - the 42 names
		// `backend/Clicdata matching (2).csv` binds to (source of truth for the rename), plus the 9 the Hub
		// keeps although the CSV does not mention them: `Channel`/`lvl1` by the analyst's explicit request,
		// `CPC`/`CPM`/`CPV`/`AVCR`/`CTR` because ClicData computes those itself, and `Revenue`/`ROAS` because
		// they were previously added by formula on the Google Sheet side
		Set<String> clicDataTemplateNames = Set.of(
				"Channel_Short_Name", "Date", "week_start_date_monday", "Quarter", "Tactic", "Creative", "IVT",
				"Goal", "Impressions", "Clicks", "CPC_Clicks", "CPM_Impressions", "CPM_Cost", "AVCR_Impressions",
				"CTR_Impressions", "CPA_Cost", "Cost", "Completions", "Conversions", "CPC_Cost",
				"CPA_Conversions", "CNB_creative_tag", "CNB_message", "CNB_language", "CNB_geo",
				"CNB_keyword_group", "CNB_flight_identifier", "CNB_audience", "CNB_other", "CPC_Benchmark",
				"CPV_Benchmark", "CTR_Benchmark", "IVT_Benchmark", "CPC_Plan", "CPV_Cost", "CPV_Plan", "CPM_Plan",
				"Campaign_Short_Name", "CR_Benchmark", "AVCR_Benchmark", "CPA_Benchmark", "Line_Item_Description");
		Set<String> deliberatelyUnmapped =
				Set.of("Channel", "lvl1", "CPC", "CPM", "CPV", "AVCR", "CTR", "Revenue", "ROAS");

		// When:
		List<String> actual = DashboardBasicSql.outputColumns(true).stream()
				.map(DashboardBasicSqlTest::aliasOf)
				.toList();

		// Then:
		assertThat(actual).hasSize(51);
		assertThat(actual).containsExactlyInAnyOrderElementsOf(
				Stream.concat(clicDataTemplateNames.stream(), deliberatelyUnmapped.stream()).toList());
	}

	@Test
	void shouldNameEveryColumnOnceTest() {
		// Given/When: the table's schema, which cannot carry the same name twice
		List<String> aliases = DashboardBasicSql.outputColumns(true).stream()
				.map(DashboardBasicSqlTest::aliasOf)
				.toList();

		// Then:
		assertThat(aliases).doesNotHaveDuplicates();
	}

	@Test
	void shouldBoundEverySourceReadByTheSavedDateWindowTest() {
		// Given/When: a dashboard defined over one quarter, not over the campaign's whole history
		String sql = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), true, true,
				"2026-04-01", "2026-06-30");

		// Then: the window sits inside the delivery read and both conversion grains, where it can prune
		// partitions - both marts are partitioned by date and clustered by nothing.
		assertThat(countOf(sql, "`date` >= DATE '2026-04-01'")).isEqualTo(3);
		assertThat(countOf(sql, "`date` <= DATE '2026-06-30'")).isEqualTo(3);
	}

	@Test
	void shouldLeaveTheSourceReadsOpenWhenNoWindowIsSavedTest() {
		// Given/When: a dashboard that reports the campaign's whole completed history, which is the default
		String sql = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), true, true, null, null);

		// Then: no bound beyond the exclusion of today
		assertThat(sql).doesNotContain(">= DATE").doesNotContain("<= DATE");
		assertThat(countOf(sql, "`date` < CURRENT_DATE()")).isEqualTo(3);
	}

	@Test
	void shouldBoundOnlyTheEndThatIsGivenTest() {
		// Given/When: a window open at the start
		String sql = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), true, true, null, "2026-06-30");

		// Then:
		assertThat(sql).doesNotContain(">= DATE");
		assertThat(countOf(sql, "`date` <= DATE '2026-06-30'")).isEqualTo(3);
	}

	@Test
	void shouldScopeEveryReadToTheCampaignConstructedNamesTest() {
		// Given/When:
		String sql = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), true, true, null, null);

		// Then: the delivery view, both conversions grains, and the plans lookup are narrowed the same way,
		// and today is excluded from the delivery and conversions reads as everywhere else in the Hub.
		assertThat(countOf(sql, "`constructed_name` IN (SELECT `constructed_name` FROM campaign_names)"))
				.isEqualTo(4);
		assertThat(countOf(sql, "`date` < CURRENT_DATE()")).isEqualTo(3);
		assertThat(sql).contains("FROM `" + DELIVERY_VIEW + "`").contains("FROM `" + CONVERSIONS_VIEW + "`");
	}

	@Test
	void shouldReadThePlanPerReportingDocumentTest() {
		// Given/When: the sheet narrows its plans read to the campaign list it was given; so does this
		String sql = DashboardBasicSql.plansCte(PLANS_TABLE);

		// Then: the newest row of each document, not the newest row overall. The spreadsheet reads this table
		// filtered to its own id, so picking across documents answers with a plan no report is built on
		assertThat(sql).contains("QUALIFY ROW_NUMBER() OVER (PARTITION BY `constructed_name`, `spreadsheet_id` "
				+ "ORDER BY `timestamp_utc` DESC) = 1");
		// And a row without an owning document is skipped: no spreadsheet can match its own id against it
		assertThat(sql).contains("`spreadsheet_id` IS NOT NULL");
		assertThat(sql).contains("TRIM(`spreadsheet_id`) != ''");
		// And the narrowing stays, which is also what makes the QUALIFY legal - BigQuery rejects a lone one
		assertThat(sql).contains("WHERE `constructed_name` IN (SELECT `constructed_name` FROM campaign_names)");
		assertThat(sql.indexOf("WHERE")).isLessThan(sql.indexOf("QUALIFY"));
	}

	@Test
	void shouldCarryAPlanFigureOnlyWhenEveryDocumentAgreesOnItTest() {
		// Given/When:
		String sql = DashboardBasicSql.plansCte(PLANS_TABLE);

		// Then: a figure the documents contradict each other on is left empty rather than picked between
		assertThat(sql).contains("IF(COUNT(DISTINCT COALESCE(CAST(`cpa_needed` AS STRING), '(none)')) = 1, "
				+ "ANY_VALUE(`cpa_needed`), NULL) AS cpa_needed");
		// And the stand-in for a missing value is what makes that test honest: COUNT(DISTINCT) skips nulls,
		// so a document that left the field empty would otherwise agree with one that filled it
		assertThat(sql).contains("COALESCE(CAST(`cpa_benchmark` AS STRING), '(none)')");
		// But a label takes the newest document's value - one of two campaign names beats none at all
		assertThat(sql).contains("ARRAY_AGG(`campaign_short_name` IGNORE NULLS ORDER BY `timestamp_utc` "
				+ "DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_short_name");
		assertThat(sql).contains("ARRAY_AGG(`goal` IGNORE NULLS ORDER BY `timestamp_utc` DESC LIMIT 1)");
		assertThat(sql).contains("GROUP BY `constructed_name`");
	}

	@Test
	void shouldJoinBothConversionGrainsOneToOneTest() {
		// Given/When:
		String sql = DashboardBasicSql.joinedCte();

		// Then: every join key is whole - a delivery row matches at most one row in each grain, so none of
		// them can be emitted twice however many creatives a day's conversions happen to be split across
		assertThat(sql).contains("LEFT JOIN conversions_by_creative");
		assertThat(sql).contains("conversions_by_creative.conv_lvl3");
		assertThat(sql).contains("LEFT JOIN conversions_by_campaign");
		assertThat(sql).doesNotContain("conversions_by_campaign.conv_lvl3");
	}

	@Test
	void shouldGroupTheCampaignGrainWithoutALevelThreeColumnTest() {
		// Given/When: the grain a campaign-level channel reads from carries no creative at all
		String creative = DashboardBasicSql.conversionsCte(CONVERSIONS_VIEW, "'-'", null, null);
		String campaign = DashboardBasicSql.conversionsCte(CONVERSIONS_VIEW, null, null, null);

		// Then:
		assertThat(creative).contains("GROUP BY conv_date, conv_lvl1, conv_lvl3");
		assertThat(campaign).contains("GROUP BY conv_date, conv_lvl1").doesNotContain("conv_lvl3");
	}

	@Test
	void shouldCollapseTheCreativeWhenItIsSwitchedOffTest() {
		// Given/When:
		String withCreative = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), true, true, null, null);
		String withoutCreative = DashboardBasicSql.build(
				DELIVERY_VIEW, CONVERSIONS_VIEW, PLANS_TABLE, campaignNames(), false, true, null, null);

		// Then: the column stays in the schema either way - the template's shape is fixed - but with the
		// creative off every row reads the same dash, so rows aggregate across creatives
		// Note: these fragments come from deliveryCte's internal level-three alias, which stays `lvl3` -
		// only the final SELECT's output alias becomes `Creative` (see shouldEmitTheTemplatesColumnsInItsOwnOrderTest)
		assertThat(withCreative).contains("IF(`constructed_name_lvl3` = '--', '-', `constructed_name_lvl3`) AS lvl3");
		assertThat(withoutCreative).contains("'-' AS lvl3").doesNotContain("`constructed_name_lvl3`");
		assertThat(withoutCreative).contains("`lvl3`");
	}

	@Test
	void shouldBlankBothCpaSidesWhenCpaIsSwitchedOffTest() {
		// Given/When:
		List<String> off = DashboardBasicSql.outputColumns(false);
		List<String> on = DashboardBasicSql.outputColumns(true);

		// Then: a blank numerator with a populated denominator would still divide into a figure, so both go
		assertThat(columnNamed(off, "CPA_Cost")).isEqualTo("NULL AS CPA_Cost");
		assertThat(columnNamed(off, "CPA_Conversions")).isEqualTo("NULL AS CPA_Conversions");
		assertThat(columnNamed(on, "CPA_Cost")).contains("`cpa_needed` = 'YES'");
		assertThat(columnNamed(on, "CPA_Conversions")).contains("`cpa_needed` = 'YES'");
	}

	@Test
	void shouldWriteRatesAsFractionsNotPercentagesTest() {
		// Given/When: the template applies its own percentage formatting
		List<String> columns = DashboardBasicSql.outputColumns(true);

		// Then:
		assertThat(columnNamed(columns, "CTR")).contains("SAFE_DIVIDE(`clicks`, `impressions`)").doesNotContain("100");
		assertThat(columnNamed(columns, "AVCR"))
				.contains("SAFE_DIVIDE(`completes`, `impressions`)")
				.doesNotContain("100");
	}

	@Test
	void shouldKeepACampaignLevelConversionOnOneRowPerDayTest() {
		// Given/When:
		String sql = DashboardBasicSql.joinedCte();

		// Then: the campaign grain matches every delivery row of the day, so without the rank guard the
		// conversion count itself would repeat across them
		assertThat(sql).contains("CASE WHEN `CNB_channel` IN ('YouTube', 'Google SEM', 'Google Search') "
				+ "THEN IF(`rn` = 1, conversions_by_campaign.`c_conversions`, NULL) "
				+ "ELSE conversions_by_creative.`c_conversions` END");
	}

	@Test
	void shouldCompareNamesCaseAndSpaceInsensitivelyTest() {
		// Given/When: the two marts disagree about capitalisation and stray spaces
		String sql = DashboardBasicSql.joinedCte();

		// Then:
		assertThat(sql).contains("ON delivery.`date` = conversions_by_creative.conv_date");
		assertThat(sql).contains("TRIM(LOWER(CAST(COALESCE(delivery.`lvl3`, 'empty') AS STRING)))");
	}

	/**
	 * The alias a rendered output column ends with.
	 *
	 * @param column the {@code expression AS alias} text, or a bare quoted column
	 * @return the column's name in the written table
	 */
	static String aliasOf(String column) {
		int alias = column.lastIndexOf(" AS ");
		return alias < 0 ? column.replace("`", "") : column.substring(alias + 4);
	}

	/**
	 * The one rendered column with the given alias.
	 *
	 * @param columns the rendered columns
	 * @param alias   the alias to find
	 * @return that column's text
	 */
	static String columnNamed(List<String> columns, String alias) {
		return columns.stream()
				.filter(column -> aliasOf(column).equals(alias))
				.collect(Collectors.joining());
	}

	/**
	 * How many times a fragment appears in the query.
	 *
	 * @param sql      the query
	 * @param fragment the literal fragment
	 * @return the occurrence count
	 */
	static int countOf(String sql, String fragment) {
		Matcher matcher = Pattern.compile(Pattern.quote(fragment)).matcher(sql);
		int count = 0;
		while (matcher.find()) {
			count++;
		}
		return count;
	}

	private static BqRequest campaignNames() {
		return new BqRequest("SELECT 'Acme - Summer' AS `constructed_name`");
	}
}
