package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/**
 * Default {@link AgencyVisibilityService}. Reads the user's effective access and translates their
 * TEAM-scoped roles into visible agency ids via {@link HubTeamAgencyService}.
 */
@Service
@RequiredArgsConstructor
public class AgencyVisibilityServiceImpl implements AgencyVisibilityService {

	private final RbacQueryService rbacQueryService;
	private final HubTeamAgencyService hubTeamAgencyService;

	/**
	 * {@inheritDoc}
	 *
	 * <p>Deliberately not {@code @Transactional} itself: {@link RbacQueryService#getEffectiveAccess} and
	 * {@link HubTeamAgencyService#findAgencyIdsByTeamIdIn} already open their own read-only transaction
	 * on a cache miss, so wrapping this method too would only cost a pooled connection on every cache
	 * <em>hit</em> - the hottest path this cache exists to make cheap.
	 */
	@Override
	@Cacheable(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#user.id()")
	public AgencyVisibility resolveForCurrentUser(CurrentUserModel user) {
		EffectiveAccessContext access = rbacQueryService.getEffectiveAccess(user.clerkUserId());
		if (access.admin() || hasUnscopedGrant(access)) {
			return AgencyVisibility.unrestricted();
		}
		List<Long> teamIds = access.assignments().stream()
				.filter(assignment -> RbacScopeCode.TEAM.getCode().equals(assignment.scopeCode()))
				.map(assignment -> assignment.assignment().getScopeId())
				.filter(Objects::nonNull)
				.distinct()
				.toList();
		return AgencyVisibility.restrictedTo(hubTeamAgencyService.findAgencyIdsByTeamIdIn(teamIds));
	}

	/**
	 * Tells whether the user holds any ALL-scoped (global) role, which sees every agency like an admin.
	 *
	 * @param access the user's effective access
	 * @return {@code true} when an ALL-scoped assignment is present
	 */
	private boolean hasUnscopedGrant(EffectiveAccessContext access) {
		return access.assignments().stream()
				.map(RoleAssignmentModel::scopeCode)
				.anyMatch(RbacScopeCode.ALL.getCode()::equals);
	}
}
