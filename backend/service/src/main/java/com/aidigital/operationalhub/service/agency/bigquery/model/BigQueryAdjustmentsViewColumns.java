package com.aidigital.operationalhub.service.agency.bigquery.model;

/**
 * Column names of the {@code platform_mart_adjustments_view_op_hub} BigQuery view — a per-day,
 * per-line-item delivery/actuals row, merging the base {@code platform_mart} data with manual op-hub
 * adjustments (view resolves conflicts by latest {@code last_modified_at} server-side).
 *
 * <p>Names match the actual BigQuery schema exactly (mixed case preserved for the {@code CNB_*}
 * columns).
 */
public final class BigQueryAdjustmentsViewColumns {

	/**
	 * BigQuery column holding the delivery date.
	 */
	public static final String DATE = "date";

	/**
	 * BigQuery column holding the DSP/ad-server platform.
	 */
	public static final String PLATFORM = "platform";

	/**
	 * BigQuery column holding the platform account name.
	 */
	public static final String ACCOUNT = "account";

	/**
	 * BigQuery column holding the platform account id.
	 */
	public static final String ACCOUNT_ID = "account_id";

	/**
	 * BigQuery column holding the level-1 constructed name - the full naming-convention string, whose
	 * parts are also exposed individually as the {@code CNB_*} columns below.
	 *
	 * <p><strong>What a level denotes depends on the row's {@code platform}</strong>, so none of these
	 * three levels can be given a fixed name. Level 1 is the line item on DV360, Xandr, Yahoo and
	 * Beeswax; the ad set on The Trade Desk, Meta, TikTok and LinkedIn; the campaign on Google Ads,
	 * Spotify, Microsoft, Vistar and Viant; and the insertion order on Amazon and ADT. Confirmed on
	 * DV360 data: 6 distinct lvl2 values (insertion orders) covering 25 distinct values of this column
	 * (line items), each covering 1-11 lvl3 values (creatives).
	 */
	public static final String CONSTRUCTED_NAME = "constructed_name";

	/**
	 * BigQuery column holding the level-1 constructed id - the identity a report row is edited and
	 * counted by (see {@code BigQueryReportRowService}'s distinct-id count and adjustment keys).
	 *
	 * <p>Where level 1 is the line item (DV360 and friends - see {@link #CONSTRUCTED_NAME}), these are
	 * the DSP's own line items, one per targeting variant. They are finer-grained than the NetSuite
	 * line items the Setup tab lists ({@code CNB_unique_line_item_id}): one NetSuite line item
	 * typically spans several of these.
	 */
	public static final String CONSTRUCTED_ID = "constructed_id";

	/**
	 * BigQuery column holding the level-2 constructed name. Platform-dependent like
	 * {@link #CONSTRUCTED_NAME}: the insertion order on DV360, Xandr, Vistar and Viant; the campaign on
	 * The Trade Desk, Meta, TikTok, LinkedIn, Yahoo and Beeswax; the ad set on Google Ads, Spotify and
	 * Microsoft; the line item on Amazon and ADT.
	 */
	public static final String CONSTRUCTED_NAME_LVL2 = "constructed_name_lvl2";

	/**
	 * BigQuery column holding the level-2 constructed id. See {@link #CONSTRUCTED_NAME_LVL2}.
	 */
	public static final String CONSTRUCTED_ID_LVL2 = "constructed_id_lvl2";

	/**
	 * BigQuery column holding the level-3 constructed name - the creative on most platforms, the ad on
	 * Google Ads, Spotify, Meta, TikTok and Microsoft (e.g.
	 * {@code "Evergreen - Save smarter with FPCU_rectangle"}). Never the campaign, whose own name is
	 * {@link #CAMPAIGN_NAME}.
	 */
	public static final String CONSTRUCTED_NAME_LVL3 = "constructed_name_lvl3";

	/**
	 * BigQuery column holding the level-3 constructed id. See {@link #CONSTRUCTED_NAME_LVL3}.
	 */
	public static final String CONSTRUCTED_ID_LVL3 = "constructed_id_lvl3";

	/**
	 * BigQuery column holding the naming-convention agency id.
	 */
	public static final String CNB_AGENCY_ID = "CNB_agency_id";

	/**
	 * BigQuery column holding the naming-convention client name.
	 */
	public static final String CNB_CLIENT = "CNB_client";

	/**
	 * BigQuery column holding the naming-convention industry code.
	 */
	public static final String CNB_INDUSTRY_CODE = "CNB_industry_code";

	/**
	 * BigQuery column holding the naming-convention campaign name — the join key matched against a Hub
	 * campaign's own name (see {@code BigQueryReportRowService}).
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
	 * BigQuery column holding the naming-convention "other" free-form segment.
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
	 * BigQuery column holding delivered impressions.
	 */
	public static final String IMPRESSIONS = "impressions";

	/**
	 * BigQuery column holding delivered clicks.
	 */
	public static final String CLICKS = "clicks";

	/**
	 * BigQuery column holding delivered spend.
	 */
	public static final String SPEND = "spend";

	/**
	 * BigQuery column holding video starts.
	 */
	public static final String STARTS = "starts";

	/**
	 * BigQuery column holding video first-quartile completions.
	 */
	public static final String FIRST_QUARTILES = "first_quartiles";

	/**
	 * BigQuery column holding video midpoint completions.
	 */
	public static final String MIDPOINTS = "midpoints";

	/**
	 * BigQuery column holding video third-quartile completions.
	 */
	public static final String THIRD_QUARTILES = "third_quartiles";

	/**
	 * BigQuery column holding video completions.
	 */
	public static final String COMPLETES = "completes";

	/**
	 * BigQuery column holding conversions.
	 */
	public static final String CONVERSIONS = "conversions";

	/**
	 * BigQuery column holding post-click conversions.
	 */
	public static final String POST_CLICK_CONVERSIONS = "post_click_conversions";

	/**
	 * BigQuery column holding post-view conversions.
	 */
	public static final String POST_VIEW_CONVERSIONS = "post_view_conversions";

	/**
	 * BigQuery column holding rate-card (dynamic) cost.
	 */
	public static final String DYNAMIC_COST = "dynamic_cost";

	/**
	 * BigQuery column holding link clicks.
	 */
	public static final String LINK_CLICKS = "link_clicks";

	/**
	 * BigQuery column holding a marker of which metrics were manually adjusted.
	 */
	public static final String ADJUSTED_METRICS = "adjusted_metrics";

	/**
	 * BigQuery column holding the row's creation timestamp.
	 */
	public static final String CREATED_AT = "created_at";

	/**
	 * BigQuery column holding the row's creator.
	 */
	public static final String CREATED_BY = "created_by";

	/**
	 * BigQuery column holding the row's last-modified timestamp — the view's own conflict-resolution
	 * key when merging base and op-hub adjustment rows.
	 */
	public static final String LAST_MODIFIED_AT = "last_modified_at";

	/**
	 * BigQuery column holding the row's last modifier.
	 */
	public static final String LAST_MODIFIED_BY = "last_modified_by";

	/**
	 * BigQuery column holding the rate type (e.g. CPM).
	 */
	public static final String RATE_TYPE = "rate_type";

	/**
	 * BigQuery column holding the rate-card (dynamic) rate.
	 */
	public static final String DYNAMIC_RATE = "dynamic_rate";

	/**
	 * BigQuery column holding the average dynamic rate by date and tactic.
	 */
	public static final String AVG_DYNAMIC_RATE_BY_DATE_TACTIC = "avg_dynamic_rate_by_date_tactic";

	/**
	 * BigQuery column holding the free-form line item description.
	 */
	public static final String LINE_ITEM_DESCRIPTION = "line_item_description";

	private BigQueryAdjustmentsViewColumns() {
		// constants only
	}
}
