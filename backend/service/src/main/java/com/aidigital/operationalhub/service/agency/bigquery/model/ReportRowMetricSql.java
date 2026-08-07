package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CLICKS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_BUYING_MODEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CHANNEL;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_OTHER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.COMPLETES;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DYNAMIC_COST;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.IMPRESSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.RATE_TYPE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.STARTS;

/**
 * What the report's derived metrics mean, in the two forms a read needs: per row, and rolled up over
 * a {@code GROUP BY}.
 *
 * <p>Every definition here is a translation of the client-facing reporting tool's own
 * {@code runBasicReport} query, which is the source of truth for what a metric means at this agency.
 * Three of its conventions are not the obvious ones, and each was getting a different answer here
 * before:
 *
 * <ul>
 *   <li><strong>Cost is {@code dynamic_cost}, not {@code spend}</strong> - the rate-card cost the client
 *       is billed, not what the media cost us. A report is a client-facing document.</li>
 *   <li><strong>Added Value delivery costs nothing.</strong> A row whose {@code CNB_other} is
 *       {@code 'Added Value'} contributes zero cost, so bonus delivery improves the blended rate
 *       instead of being billed for.</li>
 *   <li><strong>CPV divides by completions</strong>, not by starts. The rate card's own CPV (see
 *       {@link #BILLABLE_UNITS}) divides by starts, so the two genuinely differ - what a client is
 *       charged per start and what a delivered view ended up costing are different questions.</li>
 * </ul>
 *
 * <p>Each ratio is also gated to the channels it means anything on: a CPM on a search line or a CTR on
 * a billboard is arithmetic, not information. An ineligible row yields {@code NULL} and - this is the
 * part that is easy to get wrong - drops out of <em>both</em> sides of a grouped read, contributing
 * neither cost nor impressions to the group's rate. The reporting tool arranges the same thing by
 * selecting paired {@code CPM_cost}/{@code CPM_impressions} helper columns for its dashboard to sum.
 *
 * <p>This is vocabulary, not a second query builder - every string here is composed by {@link BqSql},
 * which stays the only place SQL text is written. {@link BqRequest} knows how to shape a query and has
 * no business knowing any of the above.
 *
 * <p>Every ratio needs two forms because a ratio does not aggregate like the counts around it.
 * Summing a group's impressions is right; averaging its rows' CPMs is not - a row that delivered ten
 * impressions would weigh as much as one that delivered ten million. The grouped form divides the
 * summed numerator by the summed denominator instead, which collapses to the per-row form when a
 * group holds exactly one row.
 */
public final class ReportRowMetricSql {

	private static final String THOUSAND = "1000";
	private static final String HUNDRED = "100";
	private static final String ZERO = "0";
	private static final String NULL = "NULL";
	private static final String ADDED_VALUE = "Added Value";
	private static final String CPC_BUYING_MODEL = "CPC";

	/**
	 * Channels bought as inventory rather than as a response: a billboard and a television spot have no
	 * click to price. CPC and CTR are blank for them.
	 *
	 * <p>The reporting tool writes this same set twice, in two orders, as the leading {@code WHEN} of its
	 * CPC and of its CTR.
	 */
	static final List<String> UNCLICKABLE_CHANNELS = List.of("CTV", "DOOH", "Live Sports", "CTV Live Sports");

	/**
	 * Channels a click can be priced on. Or-ed with an explicit {@code CPC} buying model, which qualifies
	 * a row whatever its channel.
	 */
	static final List<String> CLICKABLE_CHANNELS = List.of(
			"Display", "In-App Display", "Amazon Display", "Native", "Audio", "Spotify", "Pandora",
			"Video", "Native Video", "Amazon Video", "Amazon Video Twitch", "Amazon Display Twitch",
			"YouTube", "CTV/OTT", "OTT", "Rich Media");

	/**
	 * Channels an impression can be priced on - the clickable set plus the inventory-bought ones, which
	 * still deliver impressions even where a click means nothing.
	 */
	static final List<String> IMPRESSION_CHANNELS = List.of(
			"Display", "In-App Display", "Amazon Display", "Native", "Audio", "Spotify", "Pandora",
			"Video", "Native Video", "Amazon Video", "Amazon Video Twitch", "Amazon Display Twitch",
			"YouTube", "CTV/OTT", "CTV", "CTV Live Sports", "Live Sports", "OTT", "DOOH", "Rich Media");

	/**
	 * Channels that play something to completion, so a view has a cost and a completion rate a meaning.
	 * Display and search are absent: there is nothing to complete.
	 */
	static final List<String> VIEWABLE_CHANNELS = List.of(
			"Audio", "Spotify", "Pandora", "Native Video", "Video", "Amazon Video", "Amazon Video Twitch",
			"YouTube", "CTV/OTT", "CTV", "CTV Live Sports", "Live Sports", "OTT");

	/**
	 * Buying models that price by impression whatever the channel. {@code '-'} is the mart's own "not
	 * stated", which the reporting tool reads as CPM - the default way media is bought.
	 */
	static final List<String> IMPRESSION_BUYING_MODELS = List.of("CPM", "-");

	/**
	 * What a row cost the client: the rate-card cost, with Added Value delivery free.
	 *
	 * <p>Not {@code spend}. {@code spend} is what the media cost us and belongs in a margin
	 * conversation; every cost ratio in the client-facing report is built on {@code dynamic_cost}.
	 */
	public static final String COST =
			BqSql.caseWhen(branch(BqSql.equalsLiteral(CNB_OTHER, ADDED_VALUE), ZERO), BqSql.col(DYNAMIC_COST));

	/** A row whose impressions can be priced (see {@link #IMPRESSION_CHANNELS}). */
	static final String CPM_ELIGIBLE = BqSql.allOf(
			BqSql.anyOf(
					BqSql.in(CNB_CHANNEL, IMPRESSION_CHANNELS),
					BqSql.in(CNB_BUYING_MODEL, IMPRESSION_BUYING_MODELS)),
			BqSql.greaterThan(BqSql.col(IMPRESSIONS), ZERO));

	/** A row whose clicks can be priced (see {@link #CLICKABLE_CHANNELS}). */
	static final String CPC_ELIGIBLE = BqSql.allOf(
			BqSql.not(BqSql.in(CNB_CHANNEL, UNCLICKABLE_CHANNELS)),
			BqSql.anyOf(
					BqSql.in(CNB_CHANNEL, CLICKABLE_CHANNELS), BqSql.equalsLiteral(CNB_BUYING_MODEL, CPC_BUYING_MODEL)),
			BqSql.greaterThan(BqSql.col(CLICKS), ZERO));

	/** A row whose completions can be priced (see {@link #VIEWABLE_CHANNELS}). */
	static final String CPV_ELIGIBLE = BqSql.allOf(
			BqSql.in(CNB_CHANNEL, VIEWABLE_CHANNELS),
			BqSql.greaterThan(BqSql.col(COMPLETES), ZERO));

	/** A row whose completion rate means something. */
	static final String AVCR_ELIGIBLE = BqSql.allOf(
			BqSql.in(CNB_CHANNEL, VIEWABLE_CHANNELS),
			BqSql.greaterThan(BqSql.col(IMPRESSIONS), ZERO),
			BqSql.greaterThan(BqSql.col(COMPLETES), ZERO));

	/** A row whose click-through rate means something. */
	static final String CTR_ELIGIBLE = BqSql.allOf(
			BqSql.not(BqSql.in(CNB_CHANNEL, UNCLICKABLE_CHANNELS)),
			BqSql.greaterThan(BqSql.col(IMPRESSIONS), ZERO),
			BqSql.greaterThan(BqSql.col(CLICKS), ZERO));

	/**
	 * How many billable units one row represents, in the unit its <em>rate card</em> is quoted in:
	 * thousands of impressions on CPM, clicks on CPC, starts on CPV.
	 *
	 * <p>Mirrors the {@code dynamic_rate} CASE in {@code platform_mart_adjustments_view_op_hub}. Note the
	 * CPV branch counts starts where {@link #CPV} counts completions: the rate card prices a view that
	 * began, the report prices one that finished. Both are right about different things.
	 */
	public static final String BILLABLE_UNITS = BqSql.caseOf(BqSql.col(RATE_TYPE), rateUnits());

	/**
	 * The blended rate card over a group: total dynamic cost per total billable unit. Well defined even
	 * where a group mixes rate types, since each type contributes both cost and units in its own unit.
	 */
	public static final String GROUPED_DYNAMIC_RATE =
			BqSql.safeDivide(BqSql.sum(DYNAMIC_COST), BqSql.sumOf(BILLABLE_UNITS));

	/*
	 * There is deliberately no grouped form of avg_dynamic_rate_by_date_tactic. The view builds it from
	 * window functions, so any aggregate over it expands to an aggregate of an aggregate once BigQuery
	 * inlines the view, and BigQuery refuses it outright. A grouped read leaves the column blank.
	 */

	/** CPM for one row: client cost per thousand impressions, blank where impressions are not priced. */
	public static final String CPM = gatedRatio(CPM_ELIGIBLE, COST, BqSql.col(IMPRESSIONS), THOUSAND);

	/** CPM over a group: summed cost per summed thousand impressions, over the priceable rows only. */
	public static final String GROUPED_CPM = groupedGatedRatio(CPM_ELIGIBLE, COST, IMPRESSIONS, THOUSAND);

	/** CPC for one row: client cost per click, blank where clicks are not priced. */
	public static final String CPC = gatedRatio(CPC_ELIGIBLE, COST, BqSql.col(CLICKS), null);

	/** CPC over a group: summed cost per summed clicks, over the priceable rows only. */
	public static final String GROUPED_CPC = groupedGatedRatio(CPC_ELIGIBLE, COST, CLICKS, null);

	/**
	 * CPV for one row: client cost per <em>completed</em> view.
	 *
	 * <p>Completions, not starts - see the class note. The rate card's CPV is the other convention.
	 */
	public static final String CPV = gatedRatio(CPV_ELIGIBLE, COST, BqSql.col(COMPLETES), null);

	/** CPV over a group: summed cost per summed completions, over the viewable rows only. */
	public static final String GROUPED_CPV = groupedGatedRatio(CPV_ELIGIBLE, COST, COMPLETES, null);

	/** Click-through rate for one row, as a percentage of impressions. */
	public static final String CTR = gatedRatio(CTR_ELIGIBLE, BqSql.col(CLICKS), BqSql.col(IMPRESSIONS), HUNDRED);

	/** Click-through rate over a group: summed clicks per summed impressions, over the clickable rows. */
	public static final String GROUPED_CTR = groupedGatedRatio(CTR_ELIGIBLE, BqSql.col(CLICKS), IMPRESSIONS, HUNDRED);

	/** Average video completion rate for one row, as a percentage of impressions. */
	public static final String AVCR = gatedRatio(AVCR_ELIGIBLE, BqSql.col(COMPLETES), BqSql.col(IMPRESSIONS), HUNDRED);

	/** Completion rate over a group: summed completions per summed impressions, over the viewable rows. */
	public static final String GROUPED_AVCR =
			groupedGatedRatio(AVCR_ELIGIBLE, BqSql.col(COMPLETES), IMPRESSIONS, HUNDRED);

	/**
	 * Channels that report no modelled IVT at all, so the metric comes back blank for them.
	 *
	 * <p>Two reasons in one list, per the source report's own definition. The walled gardens and search
	 * surfaces (Meta, TikTok, the Google and Bing search channels, Amazon, Spotify…) filter invalid
	 * traffic themselves and publish their own figures, so modelling one on top would be inventing a
	 * second answer. CTV, DOOH and Live Sports have no click to reason from in the first place.
	 */
	static final List<String> IVT_EXEMPT_CHANNELS = List.of(
			"Amazon Display", "Spotify", "Pandora", "Amazon Video", "Amazon Video Twitch",
			"Amazon Display Twitch", "YouTube", "CTV", "Live Sports", "CTV Live Sports", "DOOH", "Meta",
			"LinkedIn", "Reddit", "TikTok", "Snapchat", "Google App", "Google SEM", "Google Search",
			"Performance Max", "Bing SEM", "Bing Search", "Apple Search Ads", "Apple Search",
			"Amazon Search", "Pinterest", "Twitter");

	/**
	 * The per-mille coefficients the modelled IVT rate is drawn from, indexed by the last digit of the
	 * row's impression count. Ten values between 4.14% and 4.95% - "around, but never above, 5%".
	 */
	private static final Map<Integer, String> IVT_COEFFICIENTS = ivtCoefficients();

	/**
	 * Modelled invalid traffic for one row, as a <em>count of impressions</em> (not a percentage,
	 * despite the source report calling its column {@code IVT_Rate}).
	 *
	 * <p><strong>This is not measured, it is modelled.</strong> No verification vendor's figure reaches
	 * this mart. The business decided to work backwards from a benchmark instead: assume invalid traffic
	 * runs at around, but never above, 5% of impressions, and spread the rows across ten coefficients
	 * from 4.14% to 4.95% so a campaign's total lands near the benchmark without every row carrying an
	 * identical, obviously-synthetic number.
	 *
	 * <p>The spread is keyed on {@code MOD(impressions, 10)} - the impression count's own last digit -
	 * rather than a random draw, and that choice is the whole point: re-reading or re-exporting the same
	 * row must produce the same IVT it produced yesterday, which a random value could not promise.
	 * Impressions are used as the key because they are always present, finely grained enough to
	 * distribute evenly, and reading their last digit cannot perturb the value itself.
	 *
	 * <p>Translated from the source report's {@code IVT_Rate} expression with one simplification: that
	 * expression guards on a {@code CTR_Impressions} column, which is {@code impressions} blanked for
	 * CTV/DOOH/Live Sports - and those four channels are already in {@link #IVT_EXEMPT_CHANNELS}, so
	 * inside the branch that computes anything the two are identical. Nothing is dropped.
	 */
	public static final String IVT = BqSql.round(BqSql.caseWhen(ivtExemptions(), ivtFromImpressions()), 2);

	/**
	 * Modelled IVT over a group: the sum of its rows' own modelled counts.
	 *
	 * <p>Summed rather than re-modelled from the group's total impressions, so a grouped report and the
	 * raw rows behind it always agree. Re-applying the coefficient to a summed impression count would
	 * pick a coefficient by the total's last digit and quietly disagree with every row it covers. Exempt
	 * rows contribute {@code NULL} and so drop out of the sum rather than counting as zero.
	 */
	public static final String GROUPED_IVT = BqSql.sumOf(IVT);

	/**
	 * A ratio that exists only where the row qualifies for it, scaled where the metric is quoted per
	 * mille or per cent.
	 *
	 * @param eligible    the condition under which the row has this metric at all
	 * @param numerator   the numerator expression
	 * @param denominator the denominator expression
	 * @param scale       the multiplier ({@code 1000}, {@code 100}), or {@code null} for none
	 * @return the guarded ratio expression
	 */
	static String gatedRatio(String eligible, String numerator, String denominator, String scale) {
		String ratio = BqSql.safeDivide(numerator, denominator);
		return BqSql.caseWhen(branch(eligible, scale == null ? ratio : BqSql.multiply(ratio, scale)), null);
	}

	/**
	 * The same ratio over a group: each side summed across the qualifying rows only.
	 *
	 * <p>The gate has to sit inside both sums rather than around the division. Sum everything and then
	 * divide, and a search line's cost lands in a CPM whose impressions were never counted - the group's
	 * rate then answers a question nobody asked.
	 *
	 * @param eligible    the condition under which a row contributes to this metric
	 * @param numerator   the numerator expression
	 * @param denominator the denominator column
	 * @param scale       the multiplier ({@code 1000}, {@code 100}), or {@code null} for none
	 * @return the grouped guarded ratio expression
	 */
	static String groupedGatedRatio(String eligible, String numerator, String denominator, String scale) {
		String ratio = BqSql.safeDivide(
				BqSql.sumOf(BqSql.caseWhen(branch(eligible, numerator), null)),
				BqSql.sumOf(BqSql.caseWhen(branch(eligible, BqSql.col(denominator)), null)));
		return scale == null ? ratio : BqSql.multiply(ratio, scale);
	}

	/**
	 * A one-branch {@code CASE} map, so {@link BqSql#caseWhen} renders it predictably.
	 *
	 * @param condition the condition
	 * @param result    the expression it yields
	 * @return the single-entry map
	 */
	static Map<String, String> branch(String condition, String result) {
		Map<String, String> branch = new LinkedHashMap<>();
		branch.put(condition, result);
		return branch;
	}

	/**
	 * The conditions under which a row has no modelled IVT, in the order the source report tests them.
	 *
	 * @return condition to result (always NULL), iteration-ordered
	 */
	static Map<String, String> ivtExemptions() {
		Map<String, String> exemptions = new LinkedHashMap<>();
		exemptions.put(BqSql.in(CNB_CHANNEL, IVT_EXEMPT_CHANNELS), NULL);
		exemptions.put(BqSql.atMost(BqSql.col(IMPRESSIONS), ZERO), NULL);
		return exemptions;
	}

	/**
	 * Picks the coefficient for a row by its impression count's last digit and applies it.
	 *
	 * @return the modelled impression count expression
	 */
	static String ivtFromImpressions() {
		return BqSql.caseOfNumber(BqSql.mod(IMPRESSIONS, 10), IVT_COEFFICIENTS);
	}

	/**
	 * The ten coefficients, in digit order, each as the percentage of impressions it represents.
	 *
	 * @return last digit to modelled-impressions expression
	 */
	static Map<Integer, String> ivtCoefficients() {
		String[] percentages = {"4.23", "4.77", "4.52", "4.89", "4.31", "4.68", "4.95", "4.14", "4.84", "4.40"};
		Map<Integer, String> coefficients = new LinkedHashMap<>();
		for (int digit = 0; digit < percentages.length; digit++) {
			coefficients.put(digit, BqSql.divide(BqSql.multiply(BqSql.col(IMPRESSIONS), percentages[digit]), "100.00"));
		}
		return coefficients;
	}

	/**
	 * The billable unit each rate type is quoted per, in the order the source view tests them.
	 *
	 * @return rate type to unit expression, iteration-ordered
	 */
	static Map<String, String> rateUnits() {
		Map<String, String> units = new LinkedHashMap<>();
		units.put("CPM", BqSql.safeDivide(BqSql.col(IMPRESSIONS), THOUSAND));
		units.put("CPC", BqSql.col(CLICKS));
		units.put("CPV", BqSql.col(STARTS));
		return units;
	}

	private ReportRowMetricSql() {
	}
}
