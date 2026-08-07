package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubTeam;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Single gateway to the {@code hub_teams} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubTeamRepository}; other services depend on this contract instead of the repository.
 */
public interface HubTeamService {

	/**
	 * Lists all Hub teams ordered by team name ascending.
	 *
	 * @return all team entities ordered by team name
	 */
	List<HubTeam> listAllOrderedByName();

	/**
	 * Finds a team by its exact name.
	 *
	 * @param name the team name
	 * @return the matching team, or empty if none exists
	 */
	java.util.Optional<HubTeam> findByName(String name);

	/**
	 * Returns a page of teams ordered by name, optionally filtered by a case-insensitive name fragment.
	 *
	 * @param name       the name fragment to filter by, or {@code null}/blank for no filter
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the matching page of teams
	 */
	Page<HubTeam> search(String name, int pageNumber, int pageSize);

	/**
	 * Creates a new Hub team.
	 *
	 * @param team the team to persist
	 * @return the persisted team
	 */
	HubTeam create(HubTeam team);

	/**
	 * Updates an existing Hub team.
	 *
	 * @param teamId the id of the team to update
	 * @param team   the new team data
	 * @return the updated team
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the team does not exist
	 */
	HubTeam update(Long teamId, HubTeam team);

	/**
	 * Tells whether a team with the given id exists.
	 *
	 * @param teamId the {@code hub_teams.id} to check
	 * @return {@code true} if a team with that id exists, otherwise {@code false}
	 */
	boolean existsById(Long teamId);

	/**
	 * Persists a NetSuite-sourced team, creating or refreshing it as-is.
	 *
	 * <p>Unlike {@link #update}, this does not reject rows with {@code fromNetSuite=true}: it is the one
	 * path the NetSuite sync job uses to create a team, refresh its pod/team-lead metadata, or deactivate
	 * it when superseded, while {@link #update} remains the admin-facing guard that keeps synced teams
	 * read-only to end users.
	 *
	 * @param team the from_netsuite team to persist
	 * @return the persisted team
	 */
	HubTeam saveFromNetSuite(HubTeam team);
}
