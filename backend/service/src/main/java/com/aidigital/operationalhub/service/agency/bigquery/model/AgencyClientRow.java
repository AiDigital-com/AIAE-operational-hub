package com.aidigital.operationalhub.service.agency.bigquery.model;

import com.aidigital.operationalhub.service.agency.model.AgencyClientRefModel;

/**
 * A client reference together with the id of the agency it belongs to.
 *
 * @param agencyId the owning agency id
 * @param client   the client reference
 */
public record AgencyClientRow(Long agencyId, AgencyClientRefModel client) {
}
