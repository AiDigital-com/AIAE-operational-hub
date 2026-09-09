package com.aidigital.operationalhub.service.netsuite.model;

/**
 * A single desired {@code hub_team_agencies} row: one team's ownership of one agency. An agency can be
 * co-owned, so several {@link AgencyTeam} pairs can share the same {@link #agencyId()} with different
 * {@link #teamId()} values - each pair is reconciled as its own row rather than one row per agency.
 *
 * @param agencyId the {@code hub_team_agencies.agency_id}
 * @param teamId   the {@code hub_team_agencies.team_id}
 */
public record AgencyTeam(Long agencyId, Long teamId) {

}
