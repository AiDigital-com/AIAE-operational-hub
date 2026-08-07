package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubTeamAgency;

import java.util.Collection;
import java.util.List;

/**
 * Single gateway to the {@code hub_team_agencies} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubTeamAgencyRepository}; other services depend on this contract instead of the repository.
 */
public interface HubTeamAgencyService {

	/**
	 * Returns all team-to-agency mappings.
	 *
	 * @return every mapping, in no guaranteed order
	 */
	List<HubTeamAgency> findAll();

	/**
	 * Returns the distinct agency ids owned by any of the given teams, via one batched query instead of
	 * one query per team.
	 *
	 * @param teamIds the {@code hub_teams.id} values to match
	 * @return the matching agency ids across the given teams, in no guaranteed order
	 */
	List<Long> findAgencyIdsByTeamIdIn(Collection<Long> teamIds);

	/**
	 * Persists the given mapping.
	 *
	 * @param mapping the mapping to save
	 * @return the saved mapping
	 */
	HubTeamAgency save(HubTeamAgency mapping);

	/**
	 * Deletes the given mappings (no-op when empty).
	 *
	 * @param mappings the mappings to delete
	 */
	void deleteAll(Collection<HubTeamAgency> mappings);
}
