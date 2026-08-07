package com.aidigital.operationalhub.service.agency.model;

/**
 * Lightweight reference to a client (advertiser) embedded in an {@link AgencyModel} for sidebar
 * navigation. Carries only the id and name; {@code name} may be {@code null} when the source row has
 * no advertiser name.
 *
 * @param id   the BigQuery advertiser id
 * @param name the advertiser/client name, may be {@code null}
 * @since 1.0
 */
public record AgencyClientRefModel(Long id, String name) {

}
