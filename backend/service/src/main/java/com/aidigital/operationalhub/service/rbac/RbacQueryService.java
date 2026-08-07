package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Read-only RBAC queries: effective access context, the user directory, and a user's role assignments.
 */
public interface RbacQueryService {

	/**
	 * Returns a page of Hub users with their single active role, backing the user-management table.
	 *
	 * <p>Filtering, sorting, and paging are applied in the database; the active role code is resolved
	 * for the returned page.
	 *
	 * @param criteria the filter, sort, and paging criteria
	 * @return the page of user summaries
	 */
	Page<HubUserSummaryModel> searchUsers(SearchCriteria<HubUserField> criteria);

	/**
	 * Returns the cached, immutable effective access context for a Clerk user.
	 *
	 * <p>The result is cached in {@code rbacEffectiveAccessByClerkUserId} keyed by Clerk user id so
	 * routine authorization checks do not query PostgreSQL on every request.
	 *
	 * @param clerkUserId the Clerk {@code sub} identifier
	 * @return the effective access context for the user
	 */
	EffectiveAccessContext getEffectiveAccess(String clerkUserId);

	/**
	 * Lists the active role assignments for a user.
	 *
	 * @param userId the {@code hub_users.id} whose assignments to list
	 * @return the user's active role assignment views
	 */
	List<RoleAssignmentModel> listRoleAssignments(Long userId);
}
