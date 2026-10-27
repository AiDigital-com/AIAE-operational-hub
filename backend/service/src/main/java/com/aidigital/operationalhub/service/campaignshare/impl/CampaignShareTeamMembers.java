package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;
import java.util.stream.Collectors;

/**
 * The people who work a team's agencies in the Hub, whatever their Rippling department says: an active
 * role scoped to a team that owns at least one agency.
 *
 * <p>Owner decision 2026-10-27: an admin who gives somebody outside MPO a role on an MPO team (say, a
 * manager on Galina's team) has made them MPO for the Hub, so they can be added to campaigns too. Teams
 * the sync builds for other departments (Planning, Client Service, Data Operations) own no agency, so
 * their people stay out. Client Services is excluded by role, as it is from sharing. The sync replaces
 * such a hand-made role on its next run; that is accepted.
 *
 * <p>Transactional because the assignment's role is a lazy association.
 */
@Component
@RequiredArgsConstructor
public class CampaignShareTeamMembers {

	private final HubTeamAgencyService hubTeamAgencyService;
	private final HubRoleAssignmentService hubRoleAssignmentService;

	/**
	 * Every {@code hub_users.id} holding an active role on a team that owns an agency.
	 *
	 * @return the ids, never {@code null}
	 */
	@Transactional(readOnly = true)
	public Set<Long> userIds() {
		Set<Long> teamIds = hubTeamAgencyService.findAll().stream()
				.map(HubTeamAgency::getTeamId)
				.collect(Collectors.toSet());
		if (teamIds.isEmpty()) {
			return Set.of();
		}
		return hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds(RbacScopeCode.TEAM.getCode(), teamIds)
				.stream()
				.filter(assignment -> assignment.getRole() == null
						|| !RbacRoleCode.CLIENT_SERVICES.getCode().equals(assignment.getRole().getRoleCode()))
				.map(HubRoleAssignment::getUserId)
				.collect(Collectors.toSet());
	}
}
