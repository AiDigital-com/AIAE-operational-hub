package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * Default {@link RbacAuthorizationService} deriving decisions from cached effective access.
 *
 * <p>Admin / manage-roles status is taken from the user's cached {@link EffectiveAccessContext}
 * (an active {@code ADMIN} assignment). Company visibility currently returns {@code true} for any
 * active Hub user, so {@link #requireCanViewCompany(CurrentUserModel, Long)} passes for active users.
 */
@Service
@RequiredArgsConstructor
public class RbacAuthorizationServiceImpl implements RbacAuthorizationService {

	private final RbacQueryService rbacQueryService;

	@Override
	public void requireAdmin(CurrentUserModel user) {
		if (!effectiveAccess(user).admin()) {
			throw new AccessDeniedException("User is not an administrator.");
		}
	}

	@Override
	public void requireCanManageRoles(CurrentUserModel user) {
		if (!effectiveAccess(user).canManageRoles()) {
			throw new AccessDeniedException("User may not manage roles.");
		}
	}

	@Override
	public void requireCanViewCompany(CurrentUserModel user, Long companyId) {
		if (!canViewAllCompanies(user)) {
			throw new AccessDeniedException("User may not view company: " + companyId);
		}
	}

	@Override
	public boolean canViewAllCompanies(CurrentUserModel user) {
		return user != null && HubStatus.ACTIVE.getCode().equals(user.status());
	}

	/**
	 * Resolves the cached effective access context for the given current user.
	 *
	 * @param user the current user to authorize
	 * @return the user's effective access context
	 * @throws AccessDeniedException if the user or its Clerk identifier is missing
	 */
	EffectiveAccessContext effectiveAccess(CurrentUserModel user) {
		if (user == null || user.clerkUserId() == null) {
			throw new AccessDeniedException("No current user to authorize.");
		}
		return rbacQueryService.getEffectiveAccess(user.clerkUserId());
	}
}
