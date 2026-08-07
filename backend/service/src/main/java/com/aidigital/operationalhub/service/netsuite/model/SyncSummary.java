package com.aidigital.operationalhub.service.netsuite.model;

/**
 * Outcome of a NetSuite/Rippling sync run.
 *
 * @param teams              number of distinct teams (departments) seen and ensured
 * @param users              number of users upserted from active employees
 * @param assignmentsUpdated number of team role assignments created or changed
 * @param agenciesMapped     number of agencies mapped to a team (via their MPO team lead)
 */
public record SyncSummary(int teams, int users, int assignmentsUpdated, int agenciesMapped) {

}
