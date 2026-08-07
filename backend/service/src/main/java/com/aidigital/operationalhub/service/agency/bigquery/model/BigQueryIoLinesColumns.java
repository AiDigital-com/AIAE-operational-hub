package com.aidigital.operationalhub.service.agency.bigquery.model;

/**
 * Column names of the BigQuery {@code netsuite_campaigns_with_ids_fresh_data} IO Lines source table
 * used to load agencies, clients, and campaigns.
 *
 * <p>Names match the actual BigQuery schema exactly (lowercase snake_case).
 */
public final class BigQueryIoLinesColumns {

	/**
	 * BigQuery column holding the agency internal id.
	 */
	public static final String AGENCY_ID = "agency_id";

	/**
	 * BigQuery column holding the agency company name.
	 */
	public static final String AGENCY = "agency";

	/**
	 * BigQuery column holding the advertiser/client internal id.
	 */
	public static final String ADVERTISER_ID = "advertiser_id";

	/**
	 * BigQuery column holding the advertiser/client company name.
	 */
	public static final String ADVERTISER = "advertiser";

	/**
	 * BigQuery column holding the campaign internal id.
	 */
	public static final String CAMPAIGN_ID = "campaign_id";

	/**
	 * BigQuery column holding the campaign name.
	 */
	public static final String CAMPAIGN = "campaign";

	/**
	 * BigQuery column holding the industry/vertical.
	 */
	public static final String INDUSTRY_VERTICAL = "industry_vertical";

	/**
	 * BigQuery column holding the order number.
	 */
	public static final String ORDER_NUMBER = "order_number";

	/**
	 * BigQuery column holding the order internal id.
	 */
	public static final String ORDER_ID = "order_id";

	/**
	 * BigQuery column holding the order status.
	 */
	public static final String ORDER_STATUS = "order_status";

	/**
	 * BigQuery column holding the order start date.
	 */
	public static final String ORDER_START_DATE = "order_start_date";

	/**
	 * BigQuery column holding the order end date.
	 */
	public static final String ORDER_END_DATE = "order_end_date";

	/**
	 * BigQuery column holding the order budget.
	 */
	public static final String ORDER_BUDGET = "order_budget";

	/**
	 * BigQuery column holding the media tactic / channel.
	 */
	public static final String MEDIA_TACTIC = "media_tactic";

	/**
	 * BigQuery column holding the line item id.
	 */
	public static final String LINE_ITEM_ID = "line_item_id";

	/**
	 * BigQuery column holding the line item's own budget allocation (as opposed to {@link #ORDER_BUDGET},
	 * which is the order-level total repeated on every line-item row of that order).
	 */
	public static final String TACTIC_BUDGET = "tactic_budget";

	/**
	 * BigQuery column holding the line item's free-form description.
	 */
	public static final String DESCRIPTION = "description";

	/**
	 * BigQuery column holding the line item's rate type.
	 */
	public static final String RATE_TYPE = "rate_type";

	/**
	 * BigQuery column holding the line item's own flight start date.
	 */
	public static final String START_DATE = "start_date";

	/**
	 * BigQuery column holding the line item's own flight end date.
	 */
	public static final String END_DATE = "end_date";

	/**
	 * BigQuery column holding the growth director.
	 */
	public static final String GROWTH_DIRECTOR = "growth_director";

	/**
	 * BigQuery column holding the client service manager.
	 */
	public static final String CLIENT_SERVICE_MANAGER = "client_service_manager";

	/**
	 * BigQuery column holding the MPO team lead.
	 */
	public static final String MPO_TEAM_LEAD = "mpo_team_lead";

	private BigQueryIoLinesColumns() {
		// constants only
	}
}
