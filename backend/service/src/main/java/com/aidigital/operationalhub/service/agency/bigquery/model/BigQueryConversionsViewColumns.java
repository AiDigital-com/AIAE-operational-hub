package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.List;

/**
 * Column names of the {@code conversions_mart_adjustments_view_op_hub} BigQuery view — a per-day,
 * per-conversion-action row, merging the base {@code conversions_mart} with the hub's own appended
 * adjustments.
 *
 * <p>Names match the actual BigQuery schema exactly (mixed case preserved for the {@code CNB_*}
 * columns). The identity and {@code CNB_*} columns mean exactly what they mean in
 * {@link BigQueryAdjustmentsViewColumns} - same naming convention, same three platform-dependent
 * levels - so a report and its conversions can be grouped and filtered in one vocabulary. They are
 * declared again rather than shared because the two views are separate contracts that happen to agree
 * today: one could gain or rename a column without the other.
 *
 * <p>Four things about this view matter to every caller. All four are read off its definition, not
 * inferred from the delivery one.
 *
 * <p><strong>It merges two adjustment tables, not one.</strong> The hub's own write table is unioned with
 * the reporting tool's {@code aidigital_database.conversions_mart_manual_adjustments} before anything else
 * happens, so the tool and the hub adjust the same rows and the later write wins whichever of them made it.
 *
 * <p><strong>Conflicts resolve last-write-wins, on a coarser key than the join.</strong> The union is
 * reduced by {@code QUALIFY last_modified_at = MAX(last_modified_at) OVER (PARTITION BY account_id, date,
 * constructed_id, constructed_id_lvl2, constructed_id_lvl3, conversion_action, conversion_category)} - seven
 * columns, where the join that follows matches on twelve ({@link #NATURAL_KEY}). Since the seven are a
 * subset, two rows sharing a natural key also share a partition and only the later survives; but two rows
 * differing only in a name or in {@code platform}/{@code account} collide too, and the older is dropped
 * although it is a different row by the join's own reckoning. A null {@code last_modified_at} reads as
 * {@code 1970-01-01}, so an unstamped write always loses.
 *
 * <p><strong>An adjustment matching no base row still appears.</strong> A second branch right-joins the
 * surviving adjustments against the base aggregate on nine of the twelve columns (identity and action, but
 * not {@code platform}/{@code account}/{@code account_id}), keeps those with no base match, and derives every
 * {@code CNB_*} value from {@code SPLIT(constructed_name, '_')} rather than from the columns of that name in
 * the write table - which the view never reads. Those rows report {@link #ADJUSTED_METRICS} as
 * {@code 'Non-existent data'}.
 *
 * <p><strong>No metric is ever null.</strong> Every metric is wrapped in {@code COALESCE(..., 0)}, in
 * the base aggregate and in the merge ({@code COALESCE(ma.metric, pm.metric, 0)}), so a conversion row reads
 * zero where a delivery row would read blank. Nothing here can distinguish "no conversions recorded" from
 * "zero conversions" - and an adjustment leaving a metric null falls back to the mart's own figure rather
 * than zeroing it.
 */
public final class BigQueryConversionsViewColumns {

	/**
	 * BigQuery column holding the conversion date.
	 */
	public static final String DATE = "date";

	/**
	 * BigQuery column holding the DSP/ad-server platform.
	 */
	public static final String PLATFORM = "platform";

	/**
	 * BigQuery column holding the conversion action - the advertiser's own name for what was counted
	 * (a purchase, a lead form, an app install). The grain this view adds over the delivery one: a
	 * single line item on a single day has one delivery row and one conversion row per action.
	 */
	public static final String CONVERSION_ACTION = "conversion_action";

	/**
	 * BigQuery column holding the conversion category - the platform's own classification of the action.
	 */
	public static final String CONVERSION_CATEGORY = "conversion_category";

	/**
	 * BigQuery column holding the platform account name.
	 */
	public static final String ACCOUNT = "account";

	/**
	 * BigQuery column holding the platform account id.
	 */
	public static final String ACCOUNT_ID = "account_id";

	/**
	 * BigQuery column holding the level-1 constructed name. What a level denotes depends on the row's
	 * {@code platform} - see {@link BigQueryAdjustmentsViewColumns#CONSTRUCTED_NAME}.
	 */
	public static final String CONSTRUCTED_NAME = "constructed_name";

	/**
	 * BigQuery column holding the level-1 constructed id.
	 */
	public static final String CONSTRUCTED_ID = "constructed_id";

	/**
	 * BigQuery column holding the level-2 constructed name.
	 */
	public static final String CONSTRUCTED_NAME_LVL2 = "constructed_name_lvl2";

	/**
	 * BigQuery column holding the level-2 constructed id.
	 */
	public static final String CONSTRUCTED_ID_LVL2 = "constructed_id_lvl2";

	/**
	 * BigQuery column holding the level-3 constructed name.
	 */
	public static final String CONSTRUCTED_NAME_LVL3 = "constructed_name_lvl3";

	/**
	 * BigQuery column holding the level-3 constructed id.
	 */
	public static final String CONSTRUCTED_ID_LVL3 = "constructed_id_lvl3";

	/**
	 * BigQuery column holding the naming-convention agency id.
	 */
	public static final String CNB_AGENCY_ID = "CNB_agency_id";

	/**
	 * BigQuery column holding the naming-convention client - one half of a campaign's scope.
	 */
	public static final String CNB_CLIENT = "CNB_client";

	/**
	 * BigQuery column holding the naming-convention industry code.
	 */
	public static final String CNB_INDUSTRY_CODE = "CNB_industry_code";

	/**
	 * BigQuery column holding the naming-convention campaign name - the other half of a campaign's scope.
	 */
	public static final String CNB_CAMPAIGN_NAME = "CNB_campaign_name";

	/**
	 * BigQuery column holding the naming-convention channel.
	 */
	public static final String CNB_CHANNEL = "CNB_channel";

	/**
	 * BigQuery column holding the naming-convention tactic.
	 */
	public static final String CNB_TACTIC = "CNB_tactic";

	/**
	 * BigQuery column holding the naming-convention buying model.
	 */
	public static final String CNB_BUYING_MODEL = "CNB_buying_model";

	/**
	 * BigQuery column holding the naming-convention audience.
	 */
	public static final String CNB_AUDIENCE = "CNB_audience";

	/**
	 * BigQuery column holding the naming-convention unique line item id.
	 */
	public static final String CNB_UNIQUE_LINE_ITEM_ID = "CNB_unique_line_item_id";

	/**
	 * BigQuery column holding the naming-convention "other" segment.
	 */
	public static final String CNB_OTHER = "CNB_other";

	/**
	 * BigQuery column holding the naming-convention geo.
	 */
	public static final String CNB_GEO = "CNB_geo";

	/**
	 * BigQuery column holding the naming-convention creative tag.
	 */
	public static final String CNB_CREATIVE_TAG = "CNB_creative_tag";

	/**
	 * BigQuery column holding the naming-convention message.
	 */
	public static final String CNB_MESSAGE = "CNB_message";

	/**
	 * BigQuery column holding the naming-convention keyword group.
	 */
	public static final String CNB_KEYWORD_GROUP = "CNB_keyword_group";

	/**
	 * BigQuery column holding the naming-convention flight identifier.
	 */
	public static final String CNB_FLIGHT_IDENTIFIER = "CNB_flight_identifier";

	/**
	 * BigQuery column holding the naming-convention language.
	 */
	public static final String CNB_LANGUAGE = "CNB_language";

	/**
	 * BigQuery column holding the conversions the platform attributes by its own default model. What the
	 * reporting tool counts for every platform except Google Ads, and for Google Ads too unless the
	 * report asks for {@link #ALL_CONVERSIONS}.
	 */
	public static final String CONVERSIONS = "conversions";

	/**
	 * BigQuery column holding Google Ads' "all conversions" figure - every conversion action the account
	 * tracks, not only those marked primary. Meaningful on Google Ads alone; the reporting tool offers it
	 * as a per-report choice against {@link #CONVERSIONS}.
	 */
	public static final String ALL_CONVERSIONS = "all_conversions";

	/**
	 * BigQuery column holding conversions attributed to a view rather than a click.
	 */
	public static final String POST_VIEW_CONVERSIONS = "post_view_conversions";

	/**
	 * BigQuery column holding conversions attributed to a click.
	 */
	public static final String POST_CLICK_CONVERSIONS = "post_click_conversions";

	/**
	 * BigQuery column holding the revenue attributed to the conversions.
	 */
	public static final String REVENUE = "revenue";

	/**
	 * BigQuery column holding the revenue attributed to post-click conversions specifically.
	 */
	public static final String POST_CLICK_REVENUE = "post_click_revenue";

	/**
	 * BigQuery column holding app installs.
	 */
	public static final String INSTALLS = "installs";

	/**
	 * BigQuery column naming which metrics an adjustment changed, comma-joined.
	 *
	 * <p>Computed by the view, not stored: it diffs each of the seven metrics against the base mart's own
	 * value and comma-joins the names that differ. The write table has a column of this name, but nothing
	 * written there is ever read back - the view overwrites it, except on a row that exists only as an
	 * adjustment, which reads {@code 'Non-existent data'}.
	 */
	public static final String ADJUSTED_METRICS = "adjusted_metrics";

	/**
	 * Sentinel emitted by the conversions view when an adjustment has no matching base conversions row.
	 *
	 * <p>This is a data-quality marker from the view, not an adjusted metric name, so report readers should
	 * not display it in {@link #ADJUSTED_METRICS}.
	 */
	public static final String NON_EXISTENT_DATA = "Non-existent data";

	/**
	 * BigQuery column holding when the adjustment row was created.
	 */
	public static final String CREATED_AT = "created_at";

	/**
	 * BigQuery column holding who created the adjustment row.
	 */
	public static final String CREATED_BY = "created_by";

	/**
	 * BigQuery column holding when the adjustment row was last modified.
	 */
	public static final String LAST_MODIFIED_AT = "last_modified_at";

	/**
	 * BigQuery column holding who last modified the adjustment row.
	 */
	public static final String LAST_MODIFIED_BY = "last_modified_by";

	/**
	 * What these marts store instead of an absent identity value, and what the views compare through.
	 *
	 * <p>Not a guess: the delivery view - same team, same idiom - joins its adjustments with
	 * {@code COALESCE(pm.constructed_id, 'not set') = COALESCE(ma.constructed_id, 'not set')} on every
	 * identity column, and its aggregate emits {@code COALESCE(platform, 'not set') AS platform}. So a
	 * reader sees {@code 'not set'} where the table holds {@code NULL}, and the two are one value as far as
	 * matching a row goes.
	 *
	 * <p>Anything that has to find a row again must compare the same way. A predicate of
	 * {@code col = 'not set'} does not match a stored {@code NULL}, which for a delete means missing the row
	 * it meant to replace - and then the insert adds a second one.
	 */
	public static final String ABSENT_VALUE = "not set";

	/**
	 * The twelve columns that identify a conversions row: a day, where it was served, and which action was
	 * counted. Exactly the columns the view's own {@code LEFT JOIN} matches an adjustment to its base row
	 * on, each side wrapped in {@code COALESCE(col, 'not set')} - so this is the key an adjustment has to be
	 * unique by, and the key {@link ConversionAdjustmentWriter} deletes by before it inserts.
	 *
	 * <p>Both the name and the id of each level are in it, not the id alone. That is the view's own choice
	 * rather than ours, and it means an adjustment written before a line item was renamed stops matching -
	 * the same trade the delivery side makes.
	 */
	public static final List<String> NATURAL_KEY = List.of(
			DATE, PLATFORM, ACCOUNT, ACCOUNT_ID, CONVERSION_ACTION, CONVERSION_CATEGORY,
			CONSTRUCTED_NAME, CONSTRUCTED_ID, CONSTRUCTED_NAME_LVL2, CONSTRUCTED_ID_LVL2,
			CONSTRUCTED_NAME_LVL3, CONSTRUCTED_ID_LVL3);

	/**
	 * The natural key's text columns - every one of them but {@link #DATE}, which the write table stores as
	 * a {@code DATE}.
	 *
	 * <p>The distinction exists because {@link #ABSENT_VALUE} is text and can only stand in for text. The
	 * view draws the same line, comparing the eleven through {@code COALESCE(col, 'not set')} and the date
	 * through a date sentinel of its own ({@code COALESCE(pm.date, DATE '1970-01-01')}). Wrapping the date
	 * in the text placeholder is not a harmless extra: BigQuery has no common type for a {@code DATE} and
	 * {@code 'not set'} and rejects the statement, so the delete never runs at all.
	 */
	public static final List<String> TEXT_NATURAL_KEY = NATURAL_KEY.stream()
			.filter(column -> !DATE.equals(column))
			.toList();

	private BigQueryConversionsViewColumns() {
	}
}
