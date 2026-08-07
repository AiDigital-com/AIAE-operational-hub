package com.aidigital.operationalhub.service.agency.search;

import com.aidigital.operationalhub.service.common.search.SearchableField;
import lombok.RequiredArgsConstructor;

/**
 * Sortable and filterable fields of the campaign listing, each mapped to its model property.
 */
@RequiredArgsConstructor
public enum CampaignField implements SearchableField {

	/**
	 * The campaign id.
	 */
	ID("id", true),

	/**
	 * The campaign name.
	 */
	NAME("name", false),

	/**
	 * The client (advertiser) id.
	 */
	CLIENT_ID("clientId", true),

	/**
	 * The agency id.
	 */
	AGENCY_ID("agencyId", true),

	/**
	 * The effective client name resolved from the reporting mart.
	 */
	CLIENT_NAME("clientName", false),

	/**
	 * The campaign status.
	 */
	STATUS("status", false),

	/**
	 * A free-text term matched against the campaign, client and agency name at once, so a user who
	 * knows the campaign only as "the GWP one" still finds it.
	 *
	 * <p>Filter-only, and the odd one out of this enum: it stands for three columns rather than a
	 * property of the campaign, which is also why it is absent from the sort contract - there is
	 * nothing to order by. {@link #expression()} answers with the campaign name so a request that
	 * sorts by it anyway degrades to a sensible order instead of failing.
	 */
	SEARCH("name", false);

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
