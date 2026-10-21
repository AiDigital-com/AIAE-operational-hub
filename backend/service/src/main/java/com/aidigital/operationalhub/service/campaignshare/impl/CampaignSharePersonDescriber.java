package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Describes people by their current Hub role and team, for the "Add people" lists on a campaign.
 *
 * <p>One batched read of the active assignments (the same read the user-management table makes) and
 * one read of the team list, which is small and cached. Transactional because the assignment's role
 * and scope type are lazy associations, and this is the one place they are followed.
 */
@Component
@RequiredArgsConstructor
public class CampaignSharePersonDescriber {

	private final HubRoleAssignmentService hubRoleAssignmentService;
	private final HubTeamService hubTeamService;

	/**
	 * Describes each given user by role and team. A user without an active role is described as having
	 * none; the single-active-role rule means the first assignment found is the one.
	 *
	 * @param userIds the {@code hub_users.id} values to describe
	 * @return a description per user id, for every id given
	 */
	@Transactional(readOnly = true)
	public Map<Long, CampaignSharePersonRoleModel> describe(Collection<Long> userIds) {
		Map<Long, CampaignSharePersonRoleModel> result = new HashMap<>();
		if (userIds.isEmpty()) {
			return result;
		}
		List<HubRoleAssignment> assignments = hubRoleAssignmentService.findActiveByUserIds(userIds);
		Map<Long, String> teamNamesById = assignments.isEmpty() ? Map.of() : teamNamesById();
		for (HubRoleAssignment assignment : assignments) {
			result.putIfAbsent(assignment.getUserId(), describe(assignment, teamNamesById));
		}
		for (Long userId : userIds) {
			result.putIfAbsent(userId, CampaignSharePersonRoleModel.none());
		}
		return result;
	}

	/**
	 * Describes one assignment: the role's display name, and the team's name when the role is scoped to
	 * a team.
	 *
	 * @param assignment    the active assignment
	 * @param teamNamesById every team's name by id
	 * @return the description
	 */
	CampaignSharePersonRoleModel describe(HubRoleAssignment assignment, Map<Long, String> teamNamesById) {
		String roleName = assignment.getRole() == null ? null : assignment.getRole().getDisplayName();
		boolean teamScoped = assignment.getScopeType() != null
				&& RbacScopeCode.TEAM.getCode().equals(assignment.getScopeType().getScopeCode());
		String teamName = teamScoped && assignment.getScopeId() != null
				? teamNamesById.get(assignment.getScopeId())
				: null;
		return new CampaignSharePersonRoleModel(roleName, teamName);
	}

	/**
	 * Every team's name by {@code hub_teams.id}.
	 *
	 * @return the names by id
	 */
	Map<Long, String> teamNamesById() {
		return hubTeamService.listAllOrderedByName().stream()
				.collect(Collectors.toMap(HubTeam::getId, HubTeam::getTeamName, (a, b) -> a, HashMap::new));
	}

	/**
	 * Convenience for callers that build their rows from a stream of user ids.
	 *
	 * <p>Transactional in its own right: it calls {@link #describe(Collection)} on {@code this}, which
	 * bypasses the proxy, so the annotation there alone would leave the lazy role unloaded here.
	 *
	 * @param userIds the ids
	 * @return the descriptions, as {@link #describe(Collection)}
	 */
	@Transactional(readOnly = true)
	public Function<Long, CampaignSharePersonRoleModel> describer(Collection<Long> userIds) {
		Map<Long, CampaignSharePersonRoleModel> described = describe(userIds);
		return id -> described.getOrDefault(id, CampaignSharePersonRoleModel.none());
	}
}
