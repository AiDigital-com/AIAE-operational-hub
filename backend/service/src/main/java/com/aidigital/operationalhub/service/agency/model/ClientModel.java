package com.aidigital.operationalhub.service.agency.model;

/**
 * Immutable view of a client sourced from BigQuery.
 *
 * @param id       the BigQuery client/advertiser id
 * @param name     the client company name
 * @param agencyId the owning agency's BigQuery id, may be {@code null}
 * @param email    the primary email, may be {@code null}
 * @param status   the lifecycle status (e.g. {@code ACTIVE}/{@code INACTIVE})
 * @since 1.0
 */
public record ClientModel(Long id, String name, Long agencyId, String email, String status) {

}
