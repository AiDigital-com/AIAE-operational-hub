package com.aidigital.operationalhub.service.netsuite.model;

/**
 * Outcome of a NetSuite/Rippling sync run.
 *
 * @param teams              number of distinct teams (departments) seen and ensured
 * @param users              number of users upserted from active employees
 * @param assignmentsUpdated number of team role assignments created or changed
 * @param agenciesMapped     number of agencies mapped to a team (via their MPO team lead)
 * @param overridesApplied   number of agencies mapped to a team via an active
 *                           {@code hub_agency_owner_overrides} row rather than automatic matching
 */
public record SyncSummary(int teams, int users, int assignmentsUpdated, int agenciesMapped, int overridesApplied) {

}
