package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

/**
 * Spring Data repository for {@link HubTeamAgency} ({@code hub_team_agencies}).
 */
public interface HubTeamAgencyRepository extends JpaRepository<HubTeamAgency, Long> {

	/**
	 * Returns all agency mappings owned by any of the given teams, in one query — used to resolve a
	 * user's team-scoped agency visibility without one query per team.
	 *
	 * @param teamIds the {@code hub_teams.id} values to match
	 * @return the matching agency mappings across the given teams
	 */
	List<HubTeamAgency> findByTeamIdIn(Collection<Long> teamIds);

	/**
	 * Returns every team mapping of one agency - an agency may belong to more than one team.
	 *
	 * @param agencyId the agency id
	 * @return the agency's mappings
	 */
	List<HubTeamAgency> findByAgencyId(Long agencyId);
}
