package com.aidigital.operationalhub.service.agency.bigquery.model;

/**
 * Agency/client identity from IO-lines.
 *
 * @param agencyId the agency id
 * @param clientId the advertiser/client id
 */
public record AgencyClientKey(Long agencyId, Long clientId) {

}
