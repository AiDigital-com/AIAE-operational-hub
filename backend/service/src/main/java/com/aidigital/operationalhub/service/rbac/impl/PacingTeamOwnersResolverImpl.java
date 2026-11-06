package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.PacingTeamOwnersResolver;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Default {@link PacingTeamOwnersResolver}: the same team membership {@link PacingScopeResolverImpl}
 * builds its {@code owners} scope from, plus the admins' own team, which that resolver never needs
 * because an admin's scope is unrestricted.
 */
@Service
@RequiredArgsConstructor
public class PacingTeamOwnersResolverImpl implements PacingTeamOwnersResolver {

	private final RbacQueryService rbacQueryService;
	private final HubRoleAssignmentService hubRoleAssignmentService;
	private final HubUserService hubUserService;

	@Override
	public List<String> resolveTeamOwnerIds(CurrentUserModel user) {
		EffectiveAccessContext access = rbacQueryService.getEffectiveAccess(user.clerkUserId());
		Set<Long> memberUserIds = new LinkedHashSet<>();
		memberUserIds.add(user.id());
		teamAssignments(access).stream()
				.map(HubRoleAssignment::getUserId)
				.filter(Objects::nonNull)
				.forEach(memberUserIds::add);

		return hubUserService.findAllByIds(memberUserIds).stream()
				.map(HubUser::getPacingUserId)
				.filter(Objects::nonNull)
				.distinct()
				.toList();
	}

	/**
	 * The assignments whose holders make up the user's team: every active {@code ADMIN} for an admin,
	 * otherwise every active assignment scoped to one of the user's {@code TEAM}s.
	 *
	 * @param access the user's effective access
	 * @return the team's assignments; empty when the user has no team
	 */
	List<HubRoleAssignment> teamAssignments(EffectiveAccessContext access) {
		if (access.admin()) {
			return hubRoleAssignmentService.findActiveByRoleCode(RbacRoleCode.ADMIN.getCode());
		}
		List<Long> teamIds = access.assignments().stream()
				.filter(assignment -> RbacScopeCode.TEAM.getCode().equals(assignment.scopeCode()))
				.map(assignment -> assignment.assignment().getScopeId())
				.filter(Objects::nonNull)
				.distinct()
				.toList();
		return hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds(RbacScopeCode.TEAM.getCode(), teamIds);
	}
}
