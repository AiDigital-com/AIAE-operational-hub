package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_AUDIENCE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_BUYING_MODEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CHANNEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CREATIVE_TAG;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_FLIGHT_IDENTIFIER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_GEO;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_KEYWORD_GROUP;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_LANGUAGE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_MESSAGE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_OTHER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_TACTIC;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.COMPLETES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DYNAMIC_COST;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.IMPRESSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.LINE_ITEM_DESCRIPTION;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.STARTS;

/**
 * Builds the query behind a Basic dashboard's data source: one row per day and per delivery grain, carrying
 * the 18 dimensions and 12 metrics the ClicData Basic template reads, plus the helper columns that template
 * needs to average a rate correctly.
 *
 * <p>This is a transcription of the reporting spreadsheet's {@code runBasicReport_BQTable}, which is the
 * source of truth for what a Basic dashboard contains: the ClicData template binds to these column names, in
 * this shape, so the schema is a contract with a system outside this codebase and not a choice to be made
 * here.
 *
 * <p>The metric expressions themselves are not transcribed again - they come from {@link ReportRowMetricSql},
 * so a dashboard and the campaign's own report can never disagree about what CPM means. Two of them are
 * redefined below because the template's convention differs: see {@link #CTR_FRACTION}.
 *
 * <p><strong>The helper columns.</strong> Columns 37-45 of the output ({@code CPM_impressions},
 * {@code CPC_cost}, {@code CPA_conversions}…) look redundant next to the metrics, and are not. ClicData
 * aggregates by summing, and a rate cannot be summed: the CPM of a week is not the sum of seven daily CPMs.
 * The template therefore reads a rate as {@code SUM(numerator) / SUM(denominator)}, and each of these columns
 * carries one side of one rate, blanked on exactly the rows that rate does not apply to. Drop them and every
 * rate on the dashboard becomes wrong the moment a user widens the date range.
 *
 * <p><strong>Where this deviates from the spreadsheet, and why.</strong>
 * <ul>
 *   <li>The constructed-name list is derived from the campaign's NetSuite line items instead of typed into
 *       a spreadsheet cell by an operator.</li>
 *   <li>The date window is the campaign's whole completed history. The spreadsheet asks its operator for a
 *       start and an end; a dashboard has no operator at the moment it refreshes, and a client-facing
 *       dashboard reporting less than the campaign would be the more surprising answer.</li>
 *   <li>{@code elevate_plans_n_benches} is read without the spreadsheet-id filter the sheet applies, since
 *       the Hub is not a spreadsheet. The latest row per level-1 name wins, which is what that filter
 *       amounts to for a campaign served by one plan.</li>
 * </ul>
 */
public final class DashboardBasicSql {

	/** The level-3 name the mart uses for "no creative", which the sheet rewrites to a single dash. */
	private static final String EMPTY_LEVEL_THREE = "--";

	/** What a collapsed creative reads as, so the column keeps its place in the template's schema. */
	private static final String COLLAPSED_LEVEL_THREE = "-";

	/** The mart's own "not stated", which the sheet substitutes for a missing dimension. */
	private static final String NOT_SET = "not set";

	private static final String NULL = "NULL";
	private static final String ZERO = "0";
	private static final String YES = "YES";

	/** Channels whose conversions arrive at campaign level, so only the day's largest row may carry them. */
	private static final List<String> CAMPAIGN_LEVEL_CONVERSION_CHANNELS =
			List.of("YouTube", "Google SEM", "Google Search");

	/** Alias of the level-1 name in the output - the template's name for it. */
	public static final String LEVEL_ONE_ALIAS = "lvl1";

	/** Alias of the level-3 (creative) name in the output. */
	public static final String LEVEL_THREE_ALIAS = "lvl3";

	/** The plans table's owning-spreadsheet column - one value per reporting document. */
	private static final String SPREADSHEET_ID = "spreadsheet_id";

	/** The plans table's write stamp; a row per document accumulates, so the newest one wins. */
	private static final String TIMESTAMP_UTC = "timestamp_utc";

	/**
	 * Stands in for a missing plan value while testing whether the documents agree, so that "one says YES,
	 * the other says nothing" counts as a disagreement rather than as one answer.
	 */
	private static final String NO_PLAN_VALUE = "(none)";

	/**
	 * Plan columns that are labels rather than figures, and so take the newest document's value instead of
	 * being blanked when documents disagree: a dashboard with one of two campaign names beats a dashboard
	 * with none, whereas a target nobody agrees on is worse than an empty cell.
	 */
	private static final List<String> PLAN_LABEL_COLUMNS = List.of("campaign_short_name", "goal");

	/** Alias of the conversions the join attaches, before the output renames it. */
	private static final String JOINED_CONVERSIONS = "c_conversions";

	/** Alias of the revenue the join attaches. */
	private static final String JOINED_REVENUE = "revenue";

	/** Alias of the per-day rank used to pick which row a campaign-level conversion lands on. */
	private static final String RANK = "rn";

	/**
	 * Click-through rate as a fraction, not a percentage.
	 *
	 * <p>{@link ReportRowMetricSql#CTR} multiplies by 100 because the Hub's own report renders a percentage
	 * from the number it is given. The ClicData template formats the column itself, so a percentage here
	 * would be shown as one again - a CTR of 0.5% reading 50%. The gate is the shared one; only the scale
	 * differs.
	 */
	static final String CTR_FRACTION = ReportRowMetricSql.gatedRatio(
			ReportRowMetricSql.CTR_ELIGIBLE, BqSql.col(CLICKS), BqSql.col(IMPRESSIONS), null);

	/** Completion rate as a fraction, for the same reason as {@link #CTR_FRACTION}. */
	static final String AVCR_FRACTION = ReportRowMetricSql.gatedRatio(
			ReportRowMetricSql.AVCR_ELIGIBLE, BqSql.col(COMPLETES), BqSql.col(IMPRESSIONS), null);

	/**
	 * Builds the full query for one campaign's Basic data source.
	 *
	 * @param adjustmentsView the fully-qualified delivery view
	 * @param conversionsView the fully-qualified conversions view
	 * @param plansTable      the fully-qualified plans and benchmarks table
	 * @param campaignNames   subquery selecting the level-1 constructed names rows are scoped to
	 * @param includeCreative whether the creative (level-3) breakdown is kept; when false, rows aggregate
	 *                        across creatives and the column reads as a single dash
	 * @param includeCpa      whether the CPA helper columns carry values; when false they are blank, so the
	 *                        template's CPA reads as nothing rather than as an accidental figure
	 * @param dateFrom        first date to read, {@code null} for no lower bound
	 * @param dateTo          last date to read, {@code null} for no upper bound
	 * @return the query text
	 */
	public static String build(
			String adjustmentsView,
			String conversionsView,
			String plansTable,
			BqRequest campaignNames,
			boolean includeCreative,
			boolean includeCpa,
			String dateFrom,
			String dateTo) {
		String levelThree = includeCreative
				? "IF(" + BqSql.col(CONSTRUCTED_NAME_LVL3) + " = " + BqSql.literal(EMPTY_LEVEL_THREE) + ", "
						+ BqSql.literal(COLLAPSED_LEVEL_THREE) + ", " + BqSql.col(CONSTRUCTED_NAME_LVL3) + ")"
				: BqSql.literal(COLLAPSED_LEVEL_THREE);
		return "WITH campaign_names AS (\n"
				+ campaignNamesCte(campaignNames)
				+ "\n), plans_n_benches AS (\n"
				+ plansCte(plansTable)
				+ "\n), delivery AS (\n"
				+ deliveryCte(adjustmentsView, levelThree, dateFrom, dateTo)
				+ "\n), conversions_by_creative AS (\n"
				+ conversionsCte(conversionsView, levelThree, dateFrom, dateTo)
				+ "\n), conversions_by_campaign AS (\n"
				+ conversionsCte(conversionsView, null, dateFrom, dateTo)
				+ "\n), joined AS (\n"
				+ joinedCte()
				+ "\n)\n"
				+ "SELECT\n  " + String.join(",\n  ", outputColumns(includeCpa)) + "\n"
				+ "FROM joined\n"
				+ "LEFT JOIN plans_n_benches ON joined." + LEVEL_ONE_ALIAS + " = plans_n_benches."
				+ CONSTRUCTED_NAME + "\n"
				+ "ORDER BY " + BqSql.col(DATE) + " ASC, " + LEVEL_ONE_ALIAS + " ASC, " + LEVEL_THREE_ALIAS
				+ " ASC, " + BqSql.col(IMPRESSIONS) + " DESC";
	}

	/**
	 * The level-1 names this campaign delivers under - the Hub's stand-in for the explicit list of names a
	 * spreadsheet operator types into the sheet.
	 *
	 * <p>Used to narrow the plans table, exactly as the sheet narrows it. Without this the plans read would
	 * scan the whole table and could return another client's row for a level-1 name that happens to collide.
	 *
	 * @param campaignNames subquery selecting constructed names
	 * @return the CTE body
	 */
	static String campaignNamesCte(BqRequest campaignNames) {
		return "  SELECT DISTINCT " + BqSql.col(CONSTRUCTED_NAME) + "\n"
				+ "  FROM (" + campaignNames.sql() + ")";
	}

	/**
	 * The plans and benchmarks a dashboard reads its targets, short name, goal and CPA flag from, for the
	 * names this campaign actually delivers under.
	 *
	 * <p>Read per reporting document, then reconciled across documents - because the spreadsheet reads this
	 * table with {@code AND spreadsheet_id = <its own id>} and a dashboard here has no such id. One level-1
	 * name is planned in more than one document for 3,225 of 11,724 names, and those documents contradict
	 * each other on {@code cpa_needed} for 825 of them. Taking the newest row across all of them therefore
	 * answered a quarter of the time with a figure no single spreadsheet would show, which is what a PDI
	 * reported from the other side: a CPA here where the report shows none.
	 *
	 * <p>So a figure is carried only when every document that planned this name agrees on it, and left empty
	 * otherwise - a client-facing target nobody agrees on is worth less than a blank one, and the blank is
	 * explained in the dashboard's own hint. Labels take the newest value instead (see
	 * {@link #PLAN_LABEL_COLUMNS}). Benchmarks lose nothing to this: they never disagree.
	 *
	 * <p>Rows with no {@code spreadsheet_id} are skipped outright. No spreadsheet can match its own id
	 * against them, so no report is built on them - 495 names are planned only in such rows, and they were
	 * the one bucket where this differed from every report by construction.
	 *
	 * <p>The {@code WHERE} is not only a narrowing: BigQuery rejects a {@code QUALIFY} that stands without a
	 * {@code WHERE}, {@code GROUP BY} or {@code HAVING} in the same query block. The sheet satisfies that with
	 * its own campaign-list filter, and so does this.
	 *
	 * @param plansTable the fully-qualified plans and benchmarks table
	 * @return the CTE body
	 */
	static String plansCte(String plansTable) {
		List<String> reconciled = new ArrayList<>();
		reconciled.add(BqSql.col(CONSTRUCTED_NAME));
		for (String column : planColumns()) {
			if (CONSTRUCTED_NAME.equals(column)) {
				continue;
			}
			String value = PLAN_LABEL_COLUMNS.contains(column)
					? newestAcrossDocuments(column)
					: agreedAcrossDocuments(column);
			reconciled.add(value + " AS " + column);
		}
		List<String> perDocument = new ArrayList<>(planColumns());
		perDocument.add(TIMESTAMP_UTC);
		return "  SELECT " + String.join(", ", reconciled) + "\n"
				+ "  FROM (\n"
				+ "    SELECT " + String.join(", ", perDocument) + "\n"
				+ "    FROM `" + plansTable + "`\n"
				+ "    WHERE " + BqSql.col(CONSTRUCTED_NAME) + " IN (SELECT " + BqSql.col(CONSTRUCTED_NAME)
				+ " FROM campaign_names)\n"
				+ "      AND " + BqSql.col(SPREADSHEET_ID) + " IS NOT NULL\n"
				+ "      AND TRIM(" + BqSql.col(SPREADSHEET_ID) + ") != ''\n"
				+ "    QUALIFY "
				+ BqSql.rowNumberOverPartitionBy(
						List.of(CONSTRUCTED_NAME, SPREADSHEET_ID), BqSql.col(TIMESTAMP_UTC) + " DESC")
				+ " = 1\n"
				+ "  )\n"
				+ "  GROUP BY " + BqSql.col(CONSTRUCTED_NAME);
	}

	/**
	 * A plan figure, carried only when every document that planned this name holds the same value for it.
	 *
	 * <p>The missing-value stand-in matters: {@code COUNT(DISTINCT ...)} skips nulls, so without it a
	 * document that left the field empty would silently agree with one that filled it.
	 *
	 * @param column the plan column
	 * @return the reconciled expression
	 */
	static String agreedAcrossDocuments(String column) {
		String comparable = BqSql.coalesce("CAST(" + BqSql.col(column) + " AS STRING)", NO_PLAN_VALUE);
		return "IF(COUNT(DISTINCT " + comparable + ") = 1, " + BqSql.anyValue(column) + ", " + NULL + ")";
	}

	/**
	 * A plan label, taken from the document that wrote most recently.
	 *
	 * @param column the plan column
	 * @return the reconciled expression
	 */
	static String newestAcrossDocuments(String column) {
		return "ARRAY_AGG(" + BqSql.col(column) + " IGNORE NULLS ORDER BY " + BqSql.col(TIMESTAMP_UTC)
				+ " DESC LIMIT 1)[SAFE_OFFSET(0)]";
	}

	/**
	 * The delivery grain: one row per day and per naming breakdown, ranked by size within its day so a
	 * campaign-level conversion has exactly one row to land on.
	 *
	 * @param adjustmentsView the fully-qualified delivery view
	 * @param levelThree      the level-3 expression, collapsed or not
	 * @param dateFrom        first date to read, {@code null} for no lower bound
	 * @param dateTo          last date to read, {@code null} for no upper bound
	 * @return the CTE body
	 */
	static String deliveryCte(String adjustmentsView, String levelThree, String dateFrom, String dateTo) {
		List<String> grouped = new ArrayList<>(List.of(
				BqSql.col(DATE),
				notSet(CNB_CHANNEL) + " AS " + CNB_CHANNEL,
				notSet(CNB_TACTIC) + " AS " + CNB_TACTIC,
				notSet(CNB_BUYING_MODEL) + " AS " + CNB_BUYING_MODEL,
				BqSql.col(CONSTRUCTED_NAME) + " AS " + LEVEL_ONE_ALIAS,
				levelThree + " AS " + LEVEL_THREE_ALIAS));
		grainDimensions().forEach(column -> grouped.add(BqSql.col(column)));
		List<String> selected = new ArrayList<>(grouped);
		selected.addAll(List.of(
				BqSql.sum(IMPRESSIONS) + " AS " + IMPRESSIONS,
				BqSql.sum(CLICKS) + " AS " + CLICKS,
				BqSql.sum(DYNAMIC_COST) + " AS " + DYNAMIC_COST,
				BqSql.sum(STARTS) + " AS " + STARTS,
				BqSql.sum(COMPLETES) + " AS " + COMPLETES,
				BqSql.rowNumberOverPartitionBy(
						List.of(DATE, CONSTRUCTED_NAME),
						BqSql.sum(IMPRESSIONS) + " DESC") + " AS " + RANK));
		return "  SELECT\n    " + String.join(",\n    ", selected) + "\n"
				+ "  FROM `" + adjustmentsView + "`\n"
				+ "  WHERE " + BqSql.col(CONSTRUCTED_NAME) + " IN (SELECT " + BqSql.col(CONSTRUCTED_NAME)
				+ " FROM campaign_names)\n"
				+ "    AND " + BqSql.col(DATE) + " < " + BqSql.currentDate() + "\n"
				+ dateWindow(dateFrom, dateTo)
				+ "  GROUP BY " + String.join(", ", groupedNames());
	}

	/**
	 * The saved date window, as predicates on the source's own {@code date} column.
	 *
	 * <p>This is where the window has to be applied, not on the finished output. Both marts are partitioned by
	 * {@code date} and nothing else, so a predicate here is the only thing that stops BigQuery reading every
	 * partition the campaign has ever delivered in; a predicate wrapped around the completed query cannot be
	 * relied on to reach the source through this view's grouping, joins and windows.
	 *
	 * <p>Safe to apply before aggregation: the delivery rank partitions by {@code (date, constructed_name)} and
	 * the conversion grains group by date, so dropping whole days cannot change what a retained day says.
	 *
	 * @param dateFrom first date to read, {@code null} for no lower bound
	 * @param dateTo   last date to read, {@code null} for no upper bound
	 * @return the predicate lines, or an empty string when the window is open at both ends
	 */
	static String dateWindow(String dateFrom, String dateTo) {
		StringBuilder predicates = new StringBuilder();
		if (dateFrom != null && !dateFrom.isBlank()) {
			predicates.append("    AND ").append(BqSql.col(DATE)).append(" >= DATE ")
					.append(BqSql.literal(dateFrom)).append("\n");
		}
		if (dateTo != null && !dateTo.isBlank()) {
			predicates.append("    AND ").append(BqSql.col(DATE)).append(" <= DATE ")
					.append(BqSql.literal(dateTo)).append("\n");
		}
		return predicates.toString();
	}

	/**
	 * The conversions, at one of two grains.
	 *
	 * <p>Two, because conversions arrive at two grains and a single CTE cannot serve both without duplicating
	 * delivery rows. Where a platform reports per creative, the day's conversions belong to a level-1/level-3
	 * pair; where it reports for the campaign as a whole (see
	 * {@link #CAMPAIGN_LEVEL_CONVERSION_CHANNELS}), they belong to the level-1 name alone. Each grain is
	 * joined on its own whole key, so both joins are one-to-one and no delivery row can be emitted twice.
	 *
	 * <p>The spreadsheet builds one CTE at the finer grain and loosens its join instead, which is the same
	 * answer whenever a campaign-level channel has a single level-3 value in the conversions view - the usual
	 * case, since "campaign level" is precisely what having no creative breakdown means. Where it has more
	 * than one, that join multiplies the day's impressions, clicks and cost by however many it finds. This
	 * produces the sheet's numbers in the first case and refuses to produce inflated ones in the second.
	 *
	 * @param conversionsView the fully-qualified conversions view
	 * @param levelThree      the level-3 expression, collapsed or not; {@code null} for the campaign grain,
	 *                        which carries no level-3 column at all
	 * @param dateFrom        first date to read, {@code null} for no lower bound
	 * @param dateTo          last date to read, {@code null} for no upper bound
	 * @return the CTE body
	 */
	static String conversionsCte(String conversionsView, String levelThree, String dateFrom, String dateTo) {
		String levelThreeColumn = levelThree == null
				? ""
				: "    " + levelThree + " AS conv_" + LEVEL_THREE_ALIAS + ",\n";
		String levelThreeGrouping = levelThree == null ? "" : ", conv_" + LEVEL_THREE_ALIAS;
		return "  SELECT\n"
				+ "    " + BqSql.col(DATE) + " AS conv_date,\n"
				+ "    " + BqSql.col(CONSTRUCTED_NAME) + " AS conv_" + LEVEL_ONE_ALIAS + ",\n"
				+ levelThreeColumn
				+ "    " + BqSql.sum(BigQueryConversionsViewColumns.CONVERSIONS) + " AS " + JOINED_CONVERSIONS + ",\n"
				+ "    " + BqSql.sum(BigQueryConversionsViewColumns.REVENUE) + " AS " + JOINED_REVENUE + "\n"
				+ "  FROM `" + conversionsView + "`\n"
				+ "  WHERE " + BqSql.col(CONSTRUCTED_NAME) + " IN (SELECT " + BqSql.col(CONSTRUCTED_NAME)
				+ " FROM campaign_names)\n"
				+ "    AND " + BqSql.col(DATE) + " < " + BqSql.currentDate() + "\n"
				+ dateWindow(dateFrom, dateTo)
				+ "  GROUP BY conv_date, conv_" + LEVEL_ONE_ALIAS + levelThreeGrouping;
	}

	/**
	 * Attaches each day's conversions to its delivery rows.
	 *
	 * <p>Both grains are joined, each on its whole key, and the channel decides which one a row reads from.
	 * Joining one-to-one twice is what keeps a delivery row from being emitted more than once - see
	 * {@link #conversionsCte}.
	 *
	 * <p>On the channels whose platforms report for the campaign rather than the line
	 * ({@link #CAMPAIGN_LEVEL_CONVERSION_CHANNELS}), the figure still lands on the day's largest row alone.
	 * The campaign-grain join matches every delivery row of the day, so without that guard the conversion
	 * count itself would be repeated across them.
	 *
	 * @return the CTE body
	 */
	static String joinedCte() {
		String campaignLevel = BqSql.in(CNB_CHANNEL, CAMPAIGN_LEVEL_CONVERSION_CHANNELS);
		String largestRow = BqSql.col(RANK) + " = 1";
		return "  SELECT\n"
				+ "    delivery.* EXCEPT(" + RANK + "),\n"
				+ "    " + attachedByChannel(campaignLevel, largestRow, JOINED_CONVERSIONS) + " AS "
				+ JOINED_CONVERSIONS + ",\n"
				+ "    " + attachedByChannel(campaignLevel, largestRow, JOINED_REVENUE) + " AS "
				+ JOINED_REVENUE + "\n"
				+ "  FROM delivery\n"
				+ "  LEFT JOIN conversions_by_creative\n"
				+ "    ON delivery." + BqSql.col(DATE) + " = conversions_by_creative.conv_date\n"
				+ "    AND " + normalized("delivery." + BqSql.col(LEVEL_ONE_ALIAS))
				+ " = " + normalized("conversions_by_creative.conv_" + LEVEL_ONE_ALIAS) + "\n"
				+ "    AND " + normalized("delivery." + BqSql.col(LEVEL_THREE_ALIAS))
				+ " = " + normalized("conversions_by_creative.conv_" + LEVEL_THREE_ALIAS) + "\n"
				+ "  LEFT JOIN conversions_by_campaign\n"
				+ "    ON delivery." + BqSql.col(DATE) + " = conversions_by_campaign.conv_date\n"
				+ "    AND " + normalized("delivery." + BqSql.col(LEVEL_ONE_ALIAS))
				+ " = " + normalized("conversions_by_campaign.conv_" + LEVEL_ONE_ALIAS);
	}

	/**
	 * A conversions-side value read from the grain its channel reports at.
	 *
	 * @param campaignLevel the campaign-level-channel condition
	 * @param largestRow    the condition identifying the day's largest row
	 * @param column        the conversions-side column, named the same in both grains
	 * @return the guarded expression
	 */
	static String attachedByChannel(String campaignLevel, String largestRow, String column) {
		Map<String, String> branch = new LinkedHashMap<>();
		branch.put(
				campaignLevel,
				"IF(" + largestRow + ", conversions_by_campaign." + BqSql.col(column) + ", " + NULL + ")");
		return BqSql.caseWhen(branch, "conversions_by_creative." + BqSql.col(column));
	}

	/**
	 * The output columns, in the order the ClicData template binds them.
	 *
	 * @param includeCpa whether the CPA helper columns carry values
	 * @return the {@code expression AS alias} list
	 */
	static List<String> outputColumns(boolean includeCpa) {
		List<String> columns = new ArrayList<>();
		columns.add(BqSql.col(DATE) + " AS Date");
		columns.add("DATE_SUB(" + BqSql.col(DATE) + ", INTERVAL MOD(EXTRACT(DAYOFWEEK FROM "
				+ BqSql.col(DATE) + ") + 5, 7) DAY) AS week_start");
		columns.add("FORMAT_DATE('%Q', " + BqSql.col(DATE) + ") || 'Q' || FORMAT_DATE('%Y', "
				+ BqSql.col(DATE) + ") AS quarter");
		columns.add(BqSql.col(CNB_TACTIC) + " AS Tactic");
		// goal belongs here, fifth, and this list is 51 columns long. Both were briefly taken to be wrong:
		// the reporting tool's own tables come in four generations - 44, 49, 50 and 51 columns - and three
		// 50-column ones sampled first (they sort first, being underscore-prefixed) have no goal. The
		// current spreadsheet does emit it: its query selects 49 columns with goal fifth, and its sheet adds
		// Revenue and ROAS by formula, which is the 51-column generation and what this builds. The older
		// generations are older templates, recognisable by sheet-side header names the query never produces
		// - Level_1_Naming for lvl1, Creative for lvl3, week_start_date_monday for week_start.
		columns.add(BqSql.col("goal"));
		columns.add(BqSql.col(CNB_CHANNEL) + " AS Channel");
		columns.add(BqSql.caseWhen(channelShortNames(), BqSql.col(CNB_CHANNEL)) + " AS Channel_Short_Name");
		columns.add(BqSql.col(LEVEL_ONE_ALIAS));
		columns.add(BqSql.col("campaign_short_name"));
		columns.add(BqSql.col(LEVEL_THREE_ALIAS));
		freeDimensions().forEach(column -> columns.add(BqSql.col(column)));
		columns.add(positiveOnly(IMPRESSIONS) + " AS Impressions");
		columns.add(positiveOnly(CLICKS) + " AS Clicks");
		columns.add(ReportRowMetricSql.COST + " AS Cost");
		columns.add(positiveOnly(COMPLETES) + " AS Completions");
		columns.add(positiveOnly(JOINED_CONVERSIONS) + " AS Conversions");
		columns.add(ReportRowMetricSql.IVT + " AS IVT_Rate");
		columns.add(ReportRowMetricSql.CPC + " AS CPC");
		columns.add(ReportRowMetricSql.CPM + " AS CPM");
		columns.add(ReportRowMetricSql.CPV + " AS CPV");
		columns.add(AVCR_FRACTION + " AS AVCR");
		columns.add(CTR_FRACTION + " AS CTR");
		benchmarkColumns().forEach(column -> columns.add(BqSql.col(column)));
		columns.add(clickableImpressions() + " AS CTR_impressions");
		columns.add(gated(ReportRowMetricSql.CPM_ELIGIBLE, BqSql.col(IMPRESSIONS)) + " AS CPM_impressions");
		columns.add(viewableImpressions() + " AS AVCR_impressions");
		columns.add(cpaSide(includeCpa, ReportRowMetricSql.COST) + " AS CPA_cost");
		columns.add(gated(ReportRowMetricSql.CPV_ELIGIBLE, ReportRowMetricSql.COST) + " AS CPV_cost");
		columns.add(gated(ReportRowMetricSql.CPM_ELIGIBLE, ReportRowMetricSql.COST) + " AS CPM_cost");
		columns.add(gated(costPriceableByClick(), ReportRowMetricSql.COST) + " AS CPC_cost");
		columns.add(gated(ReportRowMetricSql.CPC_ELIGIBLE, BqSql.col(CLICKS)) + " AS CPC_clicks");
		columns.add(cpaSide(includeCpa, positiveOnly(JOINED_CONVERSIONS)) + " AS CPA_conversions");
		columns.add(BqSql.col("cr_benchmark"));
		columns.add(BqSql.col("cpa_benchmark"));
		columns.add(BqSql.col("avcr_benchmark"));
		columns.add(BqSql.col(LINE_ITEM_DESCRIPTION));
		columns.add(positiveOnly(JOINED_REVENUE) + " AS Revenue");
		columns.add("IF(" + BqSql.greaterThan(ReportRowMetricSql.COST, ZERO) + ", "
				+ BqSql.safeDivide(BqSql.col(JOINED_REVENUE), ReportRowMetricSql.COST) + ", " + NULL + ") AS ROAS");
		return columns;
	}

	/**
	 * The output aliases in the same order as {@link #outputColumns(boolean)}.
	 *
	 * <p>Used by API preview reads to keep row maps ordered and to whitelist filterable column names without
	 * duplicating the dashboard schema in a second class.
	 *
	 * @param includeCpa whether the CPA helper columns carry values
	 * @return the output aliases in template order
	 */
	public static List<String> outputColumnNames(boolean includeCpa) {
		return outputColumns(includeCpa).stream()
				.map(DashboardBasicSql::outputAlias)
				.toList();
	}

	/**
	 * Extracts the output alias from one {@code SELECT} item built by this class.
	 *
	 * @param column the output column expression
	 * @return the alias BigQuery exposes in the result row
	 */
	static String outputAlias(String column) {
		int as = column.lastIndexOf(" AS ");
		if (as >= 0) {
			return column.substring(as + 4).trim();
		}
		if (column.startsWith("`") && column.endsWith("`")) {
			return column.substring(1, column.length() - 1);
		}
		return column;
	}

	/**
	 * One side of the template's CPA, blank unless the dashboard keeps CPA and the campaign's plan asks for
	 * it.
	 *
	 * <p>Two gates, deliberately. {@code cpa_needed} is the plan's own answer to whether this campaign is
	 * measured on cost per action, which is what the spreadsheet honours; the dashboard's checkbox is the
	 * user's. Either one saying no leaves the column blank, so a dashboard cannot show a CPA for a campaign
	 * that has no action to price, and a user who switched CPA off does not get one anyway.
	 *
	 * @param includeCpa whether the dashboard keeps CPA
	 * @param value      the expression to carry when it does
	 * @return the guarded expression
	 */
	static String cpaSide(boolean includeCpa, String value) {
		if (!includeCpa) {
			return NULL;
		}
		Map<String, String> branch = new LinkedHashMap<>();
		branch.put(BqSql.equalsLiteral("cpa_needed", YES), value);
		return BqSql.caseWhen(branch, null);
	}

	/**
	 * Impressions on the rows a click-through rate applies to - the denominator of the template's CTR.
	 *
	 * @return the guarded expression
	 */
	static String clickableImpressions() {
		Map<String, String> branch = new LinkedHashMap<>();
		branch.put(BqSql.in(CNB_CHANNEL, ReportRowMetricSql.UNCLICKABLE_CHANNELS), NULL);
		return BqSql.caseWhen(branch, BqSql.col(IMPRESSIONS));
	}

	/**
	 * Impressions on the rows a completion rate applies to - the denominator of the template's AVCR.
	 *
	 * <p>Gated on the channel and on there being impressions at all, but not on completions, unlike
	 * {@link ReportRowMetricSql#AVCR_ELIGIBLE}: a video line that played nothing still had impressions to
	 * divide by, and blanking them would quietly raise the group's completion rate.
	 *
	 * @return the guarded expression
	 */
	static String viewableImpressions() {
		return gated(
				BqSql.allOf(
						BqSql.in(CNB_CHANNEL, ReportRowMetricSql.VIEWABLE_CHANNELS),
						BqSql.greaterThan(BqSql.col(IMPRESSIONS), ZERO)),
				BqSql.col(IMPRESSIONS));
	}

	/**
	 * The rows whose <em>cost</em> belongs in a CPC: priced by click, and having cost to contribute.
	 *
	 * <p>Not {@link ReportRowMetricSql#CPC_ELIGIBLE}, which additionally requires clicks. The spreadsheet
	 * gates the two sides of its CPC differently on purpose - cost counts where cost was spent, clicks count
	 * where clicks happened - and matching it matters more here than internal symmetry does, because the
	 * template divides one by the other.
	 *
	 * @return the condition
	 */
	static String costPriceableByClick() {
		return BqSql.allOf(
				BqSql.not(BqSql.in(CNB_CHANNEL, ReportRowMetricSql.UNCLICKABLE_CHANNELS)),
				BqSql.anyOf(
						BqSql.in(CNB_CHANNEL, ReportRowMetricSql.CLICKABLE_CHANNELS),
						BqSql.equalsLiteral(CNB_BUYING_MODEL, "CPC")),
				BqSql.greaterThan(ReportRowMetricSql.COST, ZERO));
	}

	/**
	 * A value kept only on the rows a condition holds for.
	 *
	 * @param eligible the condition
	 * @param value    the expression to carry
	 * @return the guarded expression
	 */
	static String gated(String eligible, String value) {
		Map<String, String> branch = new LinkedHashMap<>();
		branch.put(eligible, value);
		return BqSql.caseWhen(branch, null);
	}

	/**
	 * A count shown only where there is one, as the spreadsheet reports its metrics - a blank rather than a
	 * zero, so an absent figure reads as absent.
	 *
	 * @param column the column
	 * @return the guarded expression
	 */
	static String positiveOnly(String column) {
		return "IF(" + BqSql.greaterThan(BqSql.col(column), ZERO) + ", " + BqSql.col(column) + ", " + NULL + ")";
	}

	/**
	 * A dimension with the mart's own "not stated" substituted for a missing or empty value.
	 *
	 * @param column the column
	 * @return the coalesced expression
	 */
	static String notSet(String column) {
		String coalesced = BqSql.coalesce(BqSql.col(column), NOT_SET);
		return "IF(" + coalesced + " = '', " + BqSql.literal(NOT_SET) + ", " + coalesced + ")";
	}

	/**
	 * Comparable form of a name, so the conversions join is not defeated by case or padding.
	 *
	 * @param expression the expression to normalize
	 * @return the normalized expression
	 */
	static String normalized(String expression) {
		return "TRIM(LOWER(CAST(COALESCE(" + expression + ", 'empty') AS STRING)))";
	}

	/**
	 * The dimensions that pass through untouched, in the template's order.
	 *
	 * @return the column names
	 */
	static List<String> freeDimensions() {
		return List.of(
				CNB_AUDIENCE, CNB_GEO, CNB_LANGUAGE, CNB_MESSAGE, CNB_CREATIVE_TAG,
				CNB_KEYWORD_GROUP, CNB_FLIGHT_IDENTIFIER, CNB_OTHER);
	}

	/**
	 * Every dimension one delivery row is broken down by - the free ones plus the line item.
	 *
	 * <p>The line item is part of the grain but not part of the dimension block the output opens with: the
	 * template reads it near the end, next to revenue, and listing it in both places would emit the column
	 * twice.
	 *
	 * @return the column names
	 */
	static List<String> grainDimensions() {
		List<String> names = new ArrayList<>(freeDimensions());
		names.add(LINE_ITEM_DESCRIPTION);
		return names;
	}

	/**
	 * The names the delivery CTE groups by - the aliases it selects, since a group is per dimension value.
	 *
	 * @return the names
	 */
	static List<String> groupedNames() {
		List<String> names = new ArrayList<>(List.of(
				BqSql.col(DATE), CNB_CHANNEL, CNB_TACTIC, CNB_BUYING_MODEL, LEVEL_ONE_ALIAS, LEVEL_THREE_ALIAS));
		names.addAll(grainDimensions());
		return names;
	}

	/**
	 * The plan and benchmark columns a dashboard reads, as the spreadsheet reads them.
	 *
	 * @return the column names
	 */
	static List<String> planColumns() {
		return List.of(
				CONSTRUCTED_NAME, "campaign_short_name", "ivt_benchmark", "cpc_benchmark", "cpc_plan",
				"ctr_benchmark", "avcr_benchmark", "cr_benchmark", "cr_plan", "cpa_benchmark", "frequency",
				"cpv_benchmark", "cpv_plan", "ivt_weight", "frequency_weight", "ctr_weight", "avcr_weight",
				"cpc_weight", "cpa_needed", "cpm_plan", "goal");
	}

	/**
	 * The benchmark and plan columns the output carries between its metrics and its helper columns.
	 *
	 * @return the column names, in output order
	 */
	static List<String> benchmarkColumns() {
		return List.of(
				"ivt_benchmark", "cpc_benchmark", "ctr_benchmark", "cpv_benchmark", "cpc_plan", "cpv_plan",
				"cpm_plan");
	}

	/**
	 * The template's short channel labels, in the order the spreadsheet tests them.
	 *
	 * @return condition to label, iteration-ordered
	 */
	static Map<String, String> channelShortNames() {
		Map<String, String> labels = new LinkedHashMap<>();
		shortNamesByChannel().forEach((channel, label) ->
				labels.put(BqSql.equalsLiteral(CNB_CHANNEL, channel), BqSql.literal(label)));
		return labels;
	}

	/**
	 * The channels the template renames, and what it renames them to.
	 *
	 * @return channel to label, iteration-ordered
	 */
	static Map<String, String> shortNamesByChannel() {
		Map<String, String> labels = new LinkedHashMap<>();
		labels.put("Amazon Display", "AMZ Display");
		labels.put("Amazon Video", "AMZ Video");
		labels.put("Amazon Video Twitch", "AMZ Twitch");
		labels.put("Performance Max", "PMax");
		labels.put("Amazon Search", "AMZ SEM");
		labels.put("In-App Display", "Display In-App");
		labels.put("Google SEM", "Google Search");
		labels.put("Bing SEM", "Bing Search");
		labels.put("Apple Search Ads", "Apple Search");
		labels.put("Live Sports", "CTV Live Sports");
		return labels;
	}

	private DashboardBasicSql() {
	}
}
