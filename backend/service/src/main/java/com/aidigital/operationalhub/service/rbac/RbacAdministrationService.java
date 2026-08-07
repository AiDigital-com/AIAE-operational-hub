package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RevokeRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;

/**
 * RBAC write operations: assigning and revoking role assignments.
 *
 * <p>Implementations run inside a read-write transaction, take pessimistic write locks on the
 * affected rows to avoid concurrent duplicate assignments, and evict the affected user's effective
 * access cache entry after the transaction commits.
 */
public interface RbacAdministrationService {

	/**
	 * Assigns a role to a user within a scope.
	 *
	 * <p>Validates the role/scope combination, locks the target user and any conflicting active
	 * assignment rows, then creates the assignment. If an identical active assignment already
	 * exists the operation is a no-op and returns the existing assignment view.
	 *
	 * <p>Enforces a single active role per user: if the user already holds an active assignment for a
	 * different role the operation is rejected, and the caller must revoke that role first. The
	 * underlying schema still allows multiple rows, so this constraint lives in service logic only.
	 *
	 * @param command the assignment command
	 * @return the created (or pre-existing) role assignment view
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the user already has
	 *                                                                          an active assignment for a different
	 *                                                                          role
	 */
	RoleAssignmentModel assignRole(AssignRoleModel command);

	/**
	 * Revokes an active role assignment.
	 *
	 * <p>Locks the target assignment row before marking it revoked. Revoking a missing or
	 * already-revoked assignment is treated as a no-op.
	 *
	 * @param command the revocation command
	 */
	void revokeRole(RevokeRoleModel command);
}
