package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.service.agency.AgencyCampaignIdService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.PacingCampaignIndexService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * The campaigns a set of teams sees every pacing on (2026-10-23): the campaigns of the teams' agencies,
 * narrowed to those that actually carry a pacing. The narrowing is not optional - a team can own a
 * thousand campaigns all-time and the signed scope header has a size cap - and it costs nothing a
 * person would notice: a campaign with no pacing has nothing for the scope to admit.
 *
 * <p>Two cached reads: the agency→campaign ids from BigQuery (the gateway's snapshot cache, keyed by
 * the rendered SQL) and the fleet-wide campaigns-with-pacings set from Pacing
 * ({@link PacingCampaignIndexService}). The intersection is computed here, per call, which is cheap.
 *
 * <p>Either read failing degrades to "no team campaigns this time", logged as a warning, rather than
 * failing the Pacing call it sits in front of: the person still sees their team-mates' pacings and
 * their own shares, which is exactly what they saw before this widening existed, and a BigQuery hiccup
 * must not take the pacing overview down with it.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TeamCampaignScopeResolver {

	private final HubTeamAgencyService hubTeamAgencyService;
	private final AgencyCampaignIdService agencyCampaignIdService;
	private final PacingCampaignIndexService pacingCampaignIndexService;

	/**
	 * Resolves the campaign ids, as text, of the given teams' agencies that carry at least one pacing.
	 *
	 * @param teamIds the {@code hub_teams.id} values of the user's TEAM-scoped assignments
	 * @return the campaign ids, sorted ascending as text; empty when the teams own no agency or no
	 * campaign of theirs has a pacing
	 */
	public List<String> resolve(Collection<Long> teamIds) {
		if (teamIds.isEmpty()) {
			return List.of();
		}
		List<Long> agencyIds = hubTeamAgencyService.findAgencyIdsByTeamIdIn(teamIds);
		if (agencyIds.isEmpty()) {
			return List.of();
		}
		try {
			List<Long> campaignIds = agencyCampaignIdService.findCampaignIdsByAgencyIds(agencyIds);
			if (campaignIds.isEmpty()) {
				return List.of();
			}
			Set<String> withPacings = pacingCampaignIndexService.campaignIdsWithPacings();
			return campaignIds.stream()
					.map(String::valueOf)
					.filter(withPacings::contains)
					.toList();
		} catch (RuntimeException ex) {
			log.warn("Could not resolve the team campaigns with pacings for teams {}; the scope carries none this "
					+ "time (team-mates' pacings and own shares are unaffected)", teamIds, ex);
			return List.of();
		}
	}
}
