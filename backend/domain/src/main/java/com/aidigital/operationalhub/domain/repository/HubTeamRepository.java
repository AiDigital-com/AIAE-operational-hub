package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.ToWarmUp;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import jakarta.persistence.QueryHint;
import lombok.NonNull;
import org.hibernate.jpa.HibernateHints;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.QueryHints;

import java.util.List;

/**
 * Spring Data repository for {@link HubTeam} ({@code hub_teams}).
 */
public interface HubTeamRepository extends JpaRepository<HubTeam, Long>, ToWarmUp<HubTeam> {

	@Override
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "existsHubTeamById")
	})
	boolean existsById(@NonNull Long id);

	@NonNull
	@Override
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllHubTeams")
	})
	List<HubTeam> findAll();

	/**
	 * Returns a page of teams whose name contains the given fragment, case-insensitively.
	 *
	 * @param teamName the case-insensitive name fragment
	 * @param pageable the paging and sorting directive
	 * @return the matching page of teams
	 */
	Page<HubTeam> findByTeamNameContainingIgnoreCase(String teamName, Pageable pageable);

	/**
	 * Finds a team by its exact name (the unique key), used by the sync to get-or-create teams.
	 *
	 * @param teamName the team name
	 * @return the matching team, or empty if none exists
	 */
	java.util.Optional<HubTeam> findByTeamName(String teamName);

	@Override
	default Class<HubTeam> getClazz() {
		return HubTeam.class;
	}
}
