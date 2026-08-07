package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.hibernate.jpa.HibernateHints;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubRoleAssignment} ({@code hub_role_assignments}).
 */
public interface HubRoleAssignmentRepository extends JpaRepository<HubRoleAssignment, Long> {

	/**
	 * Lists all role assignments for a user filtered by status. Every authorization check
	 * (see {@code RbacQueryServiceImpl#getEffectiveAccess}) resolves through this query, so its
	 * result is Hibernate-query-cached like its sibling dictionary/lookup queries; role-assignment
	 * mutations and the nightly sync evict the region via
	 * {@code HubCacheNamesByClassRegistry}.
	 *
	 * @param userId the user id
	 * @param status the assignment status (e.g. {@code ACTIVE})
	 * @return matching role assignments
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllByUserIdAndStatus")
	})
	List<HubRoleAssignment> findAllByUserIdAndStatus(Long userId, String status);

	/**
	 * Lists role assignments for a set of users filtered by status, for batch enrichment. Cached like
	 * its singular sibling {@link #findAllByUserIdAndStatus} for symmetry, though the hit rate here
	 * depends on how often the same exact user-id set repeats across calls.
	 *
	 * @param userIds the user ids to load assignments for
	 * @param status  the assignment status (e.g. {@code ACTIVE})
	 * @return matching role assignments across the given users
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllByUserIdInAndStatus")
	})
	List<HubRoleAssignment> findAllByUserIdInAndStatus(Collection<Long> userIds, String status);

	/**
	 * Lists every role assignment (any status) for a set of users, for preloading before a bulk
	 * reconcile instead of one status/tuple-scoped query per user.
	 *
	 * @param userIds the user ids to load assignments for
	 * @return every matching role assignment across the given users, regardless of status
	 */
	List<HubRoleAssignment> findAllByUserIdIn(Collection<Long> userIds);

	/**
	 * Finds a role assignment by id, acquiring a pessimistic write lock on the row.
	 *
	 * <p>The {@code jakarta.persistence.lock.timeout} hint (milliseconds) bounds how long the
	 * database waits for the lock before failing, preventing indefinite lock waits.
	 *
	 * @param id the assignment id to lock and load
	 * @return the locked assignment, or empty if none exists
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
	@Query("select a from HubRoleAssignment a where a.id = :id")
	Optional<HubRoleAssignment> findByIdForUpdate(@Param("id") Long id);

	/**
	 * Finds conflicting assignments for a given user/role/scope tuple, acquiring a pessimistic
	 * write lock so concurrent assign operations cannot create duplicate active rows.
	 *
	 * <p>Handles both null and non-null {@code scopeId}: when {@code scopeId} is null only rows
	 * with a null scope match; otherwise rows with the matching scope id match. The
	 * {@code jakarta.persistence.lock.timeout} hint (milliseconds) bounds the lock wait.
	 *
	 * @param userId      the user id
	 * @param roleId      the role id
	 * @param scopeTypeId the scope type id
	 * @param scopeId     the scope id, or null for unscoped assignments
	 * @param status      the assignment status to match (e.g. {@code ACTIVE})
	 * @return matching, locked role assignments
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
	@Query("select a from HubRoleAssignment a where a.userId = :userId and a.role.id = :roleId "
			+ "and a.scopeType.id = :scopeTypeId and ((:scopeId is null and a.scopeId is null) "
			+ "or a.scopeId = :scopeId) and a.status = :status")
	List<HubRoleAssignment> findActiveForUserAndScopeForUpdate(
			@Param("userId") Long userId,
			@Param("roleId") Long roleId,
			@Param("scopeTypeId") Long scopeTypeId,
			@Param("scopeId") Long scopeId,
			@Param("status") String status);

	/**
	 * Finds an assignment in any status for a given user/role/scope tuple, acquiring a pessimistic
	 * write lock so it can be reactivated in place instead of inserted as a duplicate: the unique index
	 * permits at most one row per {@code (user, role, scope type, scope id)} tuple regardless of status,
	 * so re-assigning a role/scope that was previously revoked must reuse that row.
	 *
	 * <p>Handles both null and non-null {@code scopeId}, like {@link #findActiveForUserAndScopeForUpdate}.
	 * The {@code jakarta.persistence.lock.timeout} hint (milliseconds) bounds the lock wait.
	 *
	 * @param userId      the user id
	 * @param roleId      the role id
	 * @param scopeTypeId the scope type id
	 * @param scopeId     the scope id, or null for unscoped assignments
	 * @return the matching, locked role assignment in any status, or empty if none exists
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
	@Query("select a from HubRoleAssignment a where a.userId = :userId and a.role.id = :roleId "
			+ "and a.scopeType.id = :scopeTypeId and ((:scopeId is null and a.scopeId is null) "
			+ "or a.scopeId = :scopeId)")
	Optional<HubRoleAssignment> findForScopeForUpdate(
			@Param("userId") Long userId,
			@Param("roleId") Long roleId,
			@Param("scopeTypeId") Long scopeTypeId,
			@Param("scopeId") Long scopeId);
}
