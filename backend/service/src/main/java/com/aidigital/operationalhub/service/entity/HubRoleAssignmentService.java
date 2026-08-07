package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Single gateway to the {@code hub_role_assignments} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubRoleAssignmentRepository}; other services depend on this contract instead of the
 * repository.
 */
public interface HubRoleAssignmentService {

	/**
	 * Lists a user's active role assignments.
	 *
	 * @param userId the {@code hub_users.id} whose active assignments to load
	 * @return the user's active role assignments
	 */
	List<HubRoleAssignment> findActiveByUserId(Long userId);

	/**
	 * Lists active role assignments for a set of users, for batch enrichment of user listings.
	 *
	 * @param userIds the {@code hub_users.id} values whose active assignments to load
	 * @return active role assignments across the given users; empty when {@code userIds} is empty
	 */
	List<HubRoleAssignment> findActiveByUserIds(Collection<Long> userIds);

	/**
	 * Lists every role assignment (any status) for a set of users, for preloading before a bulk
	 * reconcile (e.g. the NetSuite sync) instead of one query per user.
	 *
	 * @param userIds the {@code hub_users.id} values whose assignments to load
	 * @return every matching role assignment across the given users, regardless of status; empty when
	 * {@code userIds} is empty
	 */
	List<HubRoleAssignment> findAllByUserIds(Collection<Long> userIds);

	/**
	 * Finds a role assignment by id, acquiring a pessimistic write lock on the row.
	 *
	 * <p>Must be called inside an active transaction owned by the caller.
	 *
	 * @param assignmentId the assignment id to lock and load
	 * @return the locked assignment, or empty if none exists
	 */
	Optional<HubRoleAssignment> findByIdForUpdate(Long assignmentId);

	/**
	 * Finds active assignments conflicting with the given user/role/scope tuple, acquiring a
	 * pessimistic write lock so concurrent assign operations cannot create duplicate active rows.
	 *
	 * <p>Must be called inside an active transaction owned by the caller.
	 *
	 * @param userId      the user id
	 * @param roleId      the role id
	 * @param scopeTypeId the scope type id
	 * @param scopeId     the scope id, or null for unscoped assignments
	 * @return matching, locked active role assignments
	 */
	List<HubRoleAssignment> findActiveConflictsForUpdate(
			Long userId, Long roleId, Long scopeTypeId, Long scopeId);

	/**
	 * Finds an assignment in any status for a given user/role/scope tuple, acquiring a pessimistic
	 * write lock so it can be reactivated in place instead of inserted as a duplicate.
	 *
	 * <p>Must be called inside an active transaction owned by the caller.
	 *
	 * @param userId      the user id
	 * @param roleId      the role id
	 * @param scopeTypeId the scope type id
	 * @param scopeId     the scope id, or null for unscoped assignments
	 * @return the matching, locked assignment in any status, or empty if none exists
	 */
	Optional<HubRoleAssignment> findForScopeForUpdate(Long userId, Long roleId, Long scopeTypeId, Long scopeId);

	/**
	 * Persists the given role assignment entity.
	 *
	 * @param assignment the assignment entity to save
	 * @return the saved assignment entity
	 */
	HubRoleAssignment save(HubRoleAssignment assignment);
}
