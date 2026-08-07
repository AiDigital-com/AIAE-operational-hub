package com.aidigital.operationalhub.service.agency.bigquery.model;

/**
 * One campaign/client pair from a mart lookup.
 *
 * @param campaignId the campaign id
 * @param agencyId   the agency id
 * @param clientId   the client id
 * @param clientName the client name
 */
public record CampaignClient(Long campaignId, Long agencyId, Long clientId, String clientName) {

	/**
	 * Returns the owning agency/client key when both ids are present.
	 *
	 * @return the agency/client key, or {@code null} when either id is missing
	 */
	public AgencyClientKey key() {
		return agencyId == null || clientId == null ? null : new AgencyClientKey(agencyId, clientId);
	}
}
