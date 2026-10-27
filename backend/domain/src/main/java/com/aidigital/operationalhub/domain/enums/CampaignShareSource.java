package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Where a {@code hub_campaign_shares} row came from. Persisted as a TEXT code, like {@link HubStatus}.
 */
@Getter
@RequiredArgsConstructor
public enum CampaignShareSource {

	/**
	 * "Add people" on the campaign: a person chose to share it.
	 */
	MANUAL("manual", "Added"),

	/**
	 * The automatic grant that follows owning a pacing on the campaign: creating one, saving a plan
	 * that adds its line items, or receiving it in an ownership transfer.
	 */
	PACING_CREATED("pacing_created", "Via pacing");

	private final String code;
	private final String displayName;
}
