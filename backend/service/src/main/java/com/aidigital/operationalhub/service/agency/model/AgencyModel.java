package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * Immutable view of an agency sourced from BigQuery.
 *
 * @param id           the BigQuery agency id
 * @param name         the agency company name
 * @param email        the primary email, may be {@code null}
 * @param status       the lifecycle status (e.g. {@code ACTIVE}/{@code INACTIVE})
 * @param clientsCount the number of distinct clients belonging to this agency, may be {@code null}
 * @param clients      the agency's clients (id and name), populated only when explicitly requested;
 *                     {@code null} for list/grid views that only need the count
 * @since 1.0
 */
public record AgencyModel(
		Long id,
		String name,
		String email,
		String status,
		Long clientsCount,
		List<AgencyClientRefModel> clients) {

}
