package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

/**
 * Enforces RBAC authorization decisions for the current user.
 *
 * <p>A user is treated as an administrator (and may manage roles) when they hold an active
 * assignment with role code {@code ADMIN}. Company visibility currently returns {@code true} for
 * any active Hub user until stricter agency/client scoping is activated.
 */
public interface RbacAuthorizationService {

	/**
	 * Requires that the given user is an administrator.
	 *
	 * @param user the current user
	 * @throws org.springframework.security.access.AccessDeniedException if the user is not an admin
	 */
	void requireAdmin(CurrentUserModel user);

	/**
	 * Requires that the given user may manage role assignments.
	 *
	 * @param user the current user
	 * @throws org.springframework.security.access.AccessDeniedException if the user may not manage
	 *                                                                   roles
	 */
	void requireCanManageRoles(CurrentUserModel user);

	/**
	 * Requires that the given user may view the specified company.
	 *
	 * @param user      the current user
	 * @param companyId the company id to check visibility for
	 * @throws org.springframework.security.access.AccessDeniedException if the user may not view the
	 *                                                                   company
	 */
	void requireCanViewCompany(CurrentUserModel user, Long companyId);

	/**
	 * Indicates whether the given user may view all companies.
	 *
	 * @param user the current user
	 * @return {@code true} if the user may view all companies
	 */
	boolean canViewAllCompanies(CurrentUserModel user);
}
