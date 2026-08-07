package com.aidigital.operationalhub.service.netsuite.org;

import org.springframework.stereotype.Component;

/**
 * Normalizes a person name for case-insensitive, whitespace-insensitive equality matching.
 *
 * <p>Shared by {@link OrgTreeTeamResolver} (the manager-chain name index and its chain walk) and
 * {@code NetSuiteSyncReconciler} (matching an IO Lines agency's {@code mpo_team_lead} name to a synced
 * Team Lead), so both sides key on the identical function. Before this collaborator existed the two call
 * sites diverged (one collapsed internal whitespace, the other did not), which could make the agency-lead
 * match miss on irregular whitespace even though the resolver's own chain-walk matched.
 */
@Component
public class NameNormalizer {

	/**
	 * Normalizes a name: trims leading/trailing whitespace, lower-cases, and collapses runs of internal
	 * whitespace to a single space.
	 *
	 * @param name the raw name; must not be {@code null}
	 * @return the normalized name
	 */
	public String normalize(String name) {
		return name.trim().toLowerCase().replaceAll("\\s+", " ");
	}
}
