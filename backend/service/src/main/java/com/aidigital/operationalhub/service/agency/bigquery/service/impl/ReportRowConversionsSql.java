package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.ADJUSTED_METRICS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.ALL_CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.LAST_MODIFIED_AT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.NON_EXISTENT_DATA;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.PLATFORM;

/**
 * How a report's conversions are read out of the conversions mart and attached to its delivery rows -
 * the reporting tool's {@code convs} CTE and the {@code j_1} join, in our own vocabulary.
 *
 * <p>Conversions live in a mart of their own at a grain the delivery mart does not share: per day, per
 * level-1 name, per <em>conversion action</em>. The report has no action column, so the actions are
 * summed away first and the result is joined back on what both sides do share.
 *
 * <p>Three things about that join are not obvious and all three are load-bearing.
 *
 * <p><strong>Level 1 matches loosely, level 3 matches strictly - except on search.</strong> Names are
 * compared lower-cased and trimmed, because the two marts are populated by different pipelines and
 * disagree about capitalisation and stray spaces. Level 3 has to agree too, or a campaign's conversions
 * would land on every creative in it. On Google Search, Google SEM and YouTube, level 3 is dropped from
 * the condition entirely: those platforms report conversions against the campaign, not the creative, so
 * there is no level-3 value on the conversions side to match.
 *
 * <p><strong>On those same three channels the conversions land on one row only.</strong> Dropping level
 * 3 from the condition means every level-3 delivery row of that campaign matches the one conversions
 * row, and the total would be multiplied by however many creatives ran. So the delivery rows are ranked
 * within their day and level-1 name by impressions, and only the first takes the conversions; the rest
 * read blank. A user looking at the raw grain sees conversions on one line of a search campaign and
 * nothing on its siblings - which looks odd and is what makes the campaign's total correct.
 *
 * <p><strong>Google Ads is asked for a different column.</strong> Its "all conversions" figure counts
 * every action the account tracks, not only the primary ones; the tool makes this a per-report choice
 * and applies it to Google Ads alone, since no other platform has the column filled.
 */
public final class ReportRowConversionsSql {

	/**
	 * The alias the joined conversions subquery is given, and the qualifier its columns are read through.
	 */
	public static final String ALIAS = "conv";

	/**
	 * The joined conversions total, aliased apart from the delivery mart's own {@code conversions}
	 * column so that neither is ambiguous in a select list holding both.
	 */
	public static final String CONVERSIONS_ALIAS = "conv_conversions";

	/**
	 * Conversion-side adjustment metadata aliases, renamed apart from the delivery mart columns of the
	 * same names so the outer report query can decide which source should populate the report row.
	 */
	public static final String ADJUSTED_METRICS_ALIAS = "conv_adjusted_metrics";
	public static final String CREATED_AT_ALIAS = "conv_created_at";
	public static final String CREATED_BY_ALIAS = "conv_created_by";
	public static final String LAST_MODIFIED_AT_ALIAS = "conv_last_modified_at";
	public static final String LAST_MODIFIED_BY_ALIAS = "conv_last_modified_by";

	/**
	 * The joined date, and below it the two joined names - each aliased apart from the delivery column of
	 * the same name, for the same reason {@link #CONVERSIONS_ALIAS} is.
	 *
	 * <p>Not cosmetic. The delivery side of this join is a bare table with no alias of its own, so a column
	 * name the subquery also exposes has two candidate sources and BigQuery refuses the query outright -
	 * {@code Column name date is ambiguous} - rather than picking one. It refuses everywhere the name
	 * appears unqualified, which here is the join condition, the campaign's date window, the
	 * {@code ROW_NUMBER()} partition and the select list. Renaming the subquery's three join keys leaves
	 * exactly one source for each name and keeps every one of those readable.
	 */
	public static final String DATE_ALIAS = "conv_date";

	/**
	 * The joined level-1 name, aliased apart from the delivery column of the same name. See
	 * {@link #DATE_ALIAS}.
	 */
	public static final String LEVEL_ONE_NAME_ALIAS = "conv_constructed_name";

	/**
	 * The joined level-3 name, aliased apart from the delivery column of the same name. See
	 * {@link #DATE_ALIAS}.
	 */
	public static final String LEVEL_THREE_NAME_ALIAS = "conv_constructed_name_lvl3";

	/**
	 * Channels whose conversions are reported against the campaign rather than the creative. Level 3 is
	 * dropped from the join for these, and the highest-delivering row takes the figure instead.
	 *
	 * <p>Read through {@link #isCampaignLevelChannel(String)} rather than directly: the list is immutable
	 * and a delivery row's channel is frequently absent, which {@code List.contains} answers with a
	 * {@link NullPointerException}.
	 */
	private static final List<String> CAMPAIGN_LEVEL_CONVERSION_CHANNELS =
			List.of("Google SEM", "Google Search", "YouTube");

	/**
	 * The value an absent level-3 name compares as, on both sides of the join - and in the per-action
	 * breakdown read behind a report row, which has to select exactly the rows this join matched.
	 */
	static final String MISSING_LEVEL_3 = "empty";

	private static final String NULL = "NULL";

	/**
	 * The conversions figure to sum, per the report's choice of Google Ads column.
	 *
	 * <p>{@code SAFE_CAST} as the tool has it: the mart types these as FLOAT already, but a cast that
	 * yields NULL on bad data is cheaper than a query that fails on one row.
	 *
	 * @param allConversionsOnGoogleAds whether Google Ads rows should count every tracked action rather
	 *                                  than only the primary ones
	 * @return the per-row conversions expression
	 */
	public static String conversionValue(boolean allConversionsOnGoogleAds) {
		if (!allConversionsOnGoogleAds) {
			return BqSql.col(CONVERSIONS);
		}
		Map<String, String> byPlatform = new LinkedHashMap<>();
		byPlatform.put(BqSql.equalsLiteral(PLATFORM, "Google Ads"), BqSql.col(ALL_CONVERSIONS));
		return BqSql.caseWhen(byPlatform, BqSql.col(CONVERSIONS));
	}

	/**
	 * The conversion-side adjusted-metrics rollup at the joined grain. Conversion rows are summed over
	 * actions before joining to delivery, so their adjustment markers have to be collapsed too.
	 *
	 * @return comma-joined distinct conversion adjustment markers
	 */
	public static String adjustedMetricsAggregate() {
		String marker = "NULLIF(NULLIF(TRIM(" + BqSql.col(ADJUSTED_METRICS) + "), ''), "
				+ BqSql.literal(NON_EXISTENT_DATA) + ")";
		return "STRING_AGG(DISTINCT " + marker + ", ',')";
	}

	/**
	 * Picks a conversion-side audit field from the most recently modified conversion action in the group.
	 *
	 * @param column the conversion view column to read
	 * @return latest non-null value ordered by conversion adjustment modification time
	 */
	public static String latestAuditValue(String column) {
		return "ARRAY_AGG(" + BqSql.col(column) + " IGNORE NULLS ORDER BY "
				+ BqSql.col(LAST_MODIFIED_AT) + " DESC LIMIT 1)[SAFE_OFFSET(0)]";
	}

	/**
	 * The {@code ON} condition tying a delivery row to its conversions row.
	 *
	 * @param dateColumn            the delivery side's date column
	 * @param levelOneNameColumn    the delivery side's level-1 name column
	 * @param levelThreeNameColumn  the delivery side's level-3 name column
	 * @param channelColumn         the delivery side's channel column
	 * @return the rendered join condition
	 */
	public static String joinCondition(
			String dateColumn, String levelOneNameColumn, String levelThreeNameColumn, String channelColumn) {
		return BqSql.allOf(
				BqSql.col(dateColumn) + " = " + qualified(DATE_ALIAS),
				normalized(BqSql.col(levelOneNameColumn)) + " = " + normalized(qualified(LEVEL_ONE_NAME_ALIAS)),
				BqSql.anyOf(
						BqSql.in(channelColumn, CAMPAIGN_LEVEL_CONVERSION_CHANNELS),
						levelThreeMatches(levelThreeNameColumn)));
	}

	/**
	 * The joined conversions value as the report should show it: blank on every row but the
	 * highest-delivering one when the channel reports conversions at campaign level, so a campaign's
	 * total is stated once rather than once per creative.
	 *
	 * <p>The rank is computed inline rather than selected as a column of its own. A window function may
	 * appear inside an expression in the select list, but a select-list alias cannot be referenced by a
	 * sibling expression - naming the rank would force the whole read into an extra subquery for nothing.
	 *
	 * @param channelColumn        the delivery side's channel column
	 * @param dateColumn           the delivery side's date column
	 * @param levelOneNameColumn   the delivery side's level-1 name column
	 * @param impressionsColumn    the column deciding which row of a campaign-level channel takes the
	 *                             conversions - the tool ranks by delivery, so the busiest row wins
	 * @return the rendered conversions expression
	 */
	public static String reportedConversions(
			String channelColumn, String dateColumn, String levelOneNameColumn, String impressionsColumn) {
		return reportedJoinedValue(CONVERSIONS_ALIAS, channelColumn, dateColumn, levelOneNameColumn, impressionsColumn);
	}

	/**
	 * A conversion-side value as the report should show it, applying the same campaign-level channel guard
	 * that conversions themselves use.
	 *
	 * @param alias              the conversion subquery alias to read
	 * @param channelColumn      the delivery side's channel column
	 * @param dateColumn         the delivery side's date column
	 * @param levelOneNameColumn the delivery side's level-1 name column
	 * @param impressionsColumn  the delivery side's impressions column used to pick the top row
	 * @return the guarded conversion-side value expression
	 */
	public static String reportedJoinedValue(
			String alias, String channelColumn, String dateColumn,
			String levelOneNameColumn, String impressionsColumn) {
		String rank = BqSql.rowNumberOverPartitionBy(
				List.of(dateColumn, levelOneNameColumn), BqSql.col(impressionsColumn) + " DESC");
		Map<String, String> gated = new LinkedHashMap<>();
		gated.put(
				BqSql.allOf(
						BqSql.in(channelColumn, CAMPAIGN_LEVEL_CONVERSION_CHANNELS),
						BqSql.greaterThan(rank, "1")),
				NULL);
		return BqSql.caseWhen(gated, qualified(alias));
	}

	/**
	 * Merges delivery and conversion adjustment markers into the one report-row field the UI already has.
	 *
	 * @param deliveryExpression   the delivery mart adjusted-metrics expression
	 * @param conversionExpression the guarded conversion mart adjusted-metrics expression
	 * @return merged adjusted-metrics expression
	 */
	public static String mergedAdjustedMetrics(String deliveryExpression, String conversionExpression) {
		String delivery = nullIfBlank(deliveryExpression);
		String conversion = nullIfBlank(conversionExpression);
		Map<String, String> branches = new LinkedHashMap<>();
		branches.put(delivery + " IS NULL", conversion);
		branches.put(conversion + " IS NULL", delivery);
		return BqSql.caseWhen(branches, "CONCAT(" + delivery + ", ',', " + conversion + ")");
	}

	/**
	 * Uses conversion-side audit metadata when a conversion adjustment is the visible change on the row,
	 * falling back to delivery metadata for ordinary delivery adjustments.
	 *
	 * @param deliveryExpression   the delivery mart audit expression
	 * @param conversionExpression the guarded conversion mart audit expression
	 * @return preferred audit value
	 */
	public static String preferredAuditValue(String deliveryExpression, String conversionExpression) {
		return "COALESCE(" + conversionExpression + ", " + deliveryExpression + ")";
	}

	private static String nullIfBlank(String expression) {
		return "NULLIF(TRIM(" + expression + "), '')";
	}

	/**
	 * Whether a channel reports its conversions against the campaign rather than the creative, and so
	 * matches without level 3.
	 *
	 * <p>An absent channel is not one of them, and that is the join's own answer rather than a convenience:
	 * the condition asks {@code channel IN (...)}, which SQL resolves to unknown - not true - against NULL,
	 * so the row falls through to the level-3 comparison. The per-action breakdown read behind a report row
	 * has to decide it the same way or it would select different rows than the cell it was opened from.
	 *
	 * <p>Absent is an ordinary state here, not a broken row: the channel comes from the name-builder
	 * mapping, and a line item the mapping does not cover reaches the report with no channel at all.
	 *
	 * @param channel the delivery row's channel, possibly absent
	 * @return whether level 3 is dropped from the match for this channel
	 */
	static boolean isCampaignLevelChannel(String channel) {
		return channel != null && CAMPAIGN_LEVEL_CONVERSION_CHANNELS.contains(channel);
	}

	/**
	 * Compares two level-3 names, treating absent as a value of its own so that two rows with no level 3
	 * match each other rather than both failing the comparison the way {@code NULL = NULL} would.
	 *
	 * @param column the delivery side's level-3 name column
	 * @return the rendered comparison
	 */
	static String levelThreeMatches(String column) {
		return normalized(BqSql.coalesce(BqSql.col(column), MISSING_LEVEL_3))
				+ " = "
				+ normalized(BqSql.coalesce(qualified(LEVEL_THREE_NAME_ALIAS), MISSING_LEVEL_3));
	}

	/**
	 * Lower-cases and trims a name for comparison - the two marts are filled by different pipelines and
	 * disagree about capitalisation and trailing spaces.
	 *
	 * <p>Delegates to {@link BqSql#normalized(String)} rather than spelling the same call out again: the
	 * per-action breakdown behind a report row is read with the same normalization, and a report whose
	 * cell and whose breakdown disagreed about what "the same name" means would be worse than either.
	 *
	 * @param expression the expression to normalize
	 * @return the rendered comparison form
	 */
	static String normalized(String expression) {
		return BqSql.normalized(expression);
	}

	/**
	 * Qualifies a column with the joined subquery's alias.
	 *
	 * @param column the column name
	 * @return {@code alias.column}
	 */
	static String qualified(String column) {
		return ALIAS + "." + BqSql.col(column);
	}

	private ReportRowConversionsSql() {
	}
}
