package com.aidigital.operationalhub.service.agency.bigquery.model;

/**
 * One IO-lines campaign linked to an agency/client pair.
 *
 * @param key          the agency/client key
 * @param campaignName the campaign name
 */
public record AgencyClientCampaign(AgencyClientKey key, String campaignName) {

}
