package com.aidigital.operationalhub.service.agency.search;

import com.aidigital.operationalhub.service.common.search.SearchableField;
import lombok.RequiredArgsConstructor;

/**
 * Sortable and filterable fields of the agency listing, each mapped to its BigQuery column on the
 * {@code netsuite_campaigns_with_ids_fresh_data} table.
 */
@RequiredArgsConstructor
public enum AgencyField implements SearchableField {

	/**
	 * The BigQuery agency id ({@code Agency ID}).
	 */
	ID("Agency ID", true),

	/**
	 * The agency company name ({@code Agency}).
	 */
	NAME("Agency", false),

	/**
	 * The agency primary email — not available in BigQuery, filtering is not supported.
	 */
	EMAIL("email", false),

	/**
	 * The agency lifecycle status — not available in BigQuery, all rows are treated as active.
	 */
	STATUS("status", false),

	/**
	 * The number of distinct clients (advertisers) of the agency — sortable only (used to surface the
	 * busiest agencies in the sidebar); filtering is not supported.
	 */
	CLIENTS_COUNT("clients_count", true);

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
