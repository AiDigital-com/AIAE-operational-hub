package com.aidigital.operationalhub.service.agency.search;

import com.aidigital.operationalhub.service.common.search.SearchableField;
import lombok.RequiredArgsConstructor;

/**
 * Sortable and filterable fields of the client listing, each mapped to its BigQuery column on the
 * {@code netsuite_campaigns_with_ids_fresh_data} table.
 */
@RequiredArgsConstructor
public enum ClientField implements SearchableField {

	/**
	 * The BigQuery client/advertiser id ({@code Advertiser ID}).
	 */
	ID("Advertiser ID", true),

	/**
	 * The client company name ({@code Advertiser}).
	 */
	NAME("Advertiser", false),

	/**
	 * The owning agency id ({@code Agency ID}).
	 */
	AGENCY_ID("Agency ID", true),

	/**
	 * The client primary email — not available in BigQuery, filtering is not supported.
	 */
	EMAIL("email", false),

	/**
	 * The client lifecycle status — not available in BigQuery, all rows are treated as active.
	 */
	STATUS("status", false);

	private final String expression;
	private final boolean numeric;

	@Override
	public String expression() {
		return expression;
	}

	@Override
	public boolean numeric() {
		return numeric;
	}
}
