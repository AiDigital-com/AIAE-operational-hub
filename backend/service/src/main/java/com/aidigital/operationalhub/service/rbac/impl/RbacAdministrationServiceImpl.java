package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.RbacAdministrationService;
import com.aidigital.operationalhub.service.rbac.mapper.HubRoleAssignmentMapper;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.ResolvedAssignment;
import com.aidigital.operationalhub.service.rbac.model.RevokeRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Default {@link RbacAdministrationService}: orchestrates locked, validated RBAC mutations.
 * Non-trivial validation/mapping lives in collaborators.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RbacAdministrationServiceImpl implements RbacAdministrationService {

	private final HubUserService hubUserService;
	private final RoleAssignmentValidator roleAssignmentValidator;
	private final HubRoleAssignmentMapper hubRoleAssignmentMapper;
	private final HubRoleAssignmentService hubRoleAssignmentService;
	private final CacheInvalidationEventService cacheInvalidationEventService;

	@Override
	@Transactional
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#command.userId()")
	public RoleAssignmentModel assignRole(AssignRoleModel command) {
		ResolvedAssignment resolved = roleAssignmentValidator.validate(command);
		HubUser user = hubUserService.existingByIdForUpdate(command.userId());

		List<HubRoleAssignment> conflicts = hubRoleAssignmentService.findActiveConflictsForUpdate(
				user.getId(),
				resolved.role().getId(),
				resolved.scopeType().getId(),
				command.scopeId());
		if (!conflicts.isEmpty()) {
			log.debug("Duplicate active assignment for user {}; returning existing.", user.getId());
			return singleView(conflicts.getFirst());
		}

		revokeOtherActiveAssignments(user.getId(), resolved.role().getId(), resolved.scopeType().getId(),
				command.scopeId());

		HubRoleAssignment saved = reactivateOrCreate(command, resolved, user.getId());
		cacheInvalidationEventService.publishUpdateEvent(HubRoleAssignment.class);

		return singleView(saved);
	}

	/**
	 * Reactivates the user's existing assignment for this exact role/scope if one exists in any status,
	 * or creates it otherwise. The unique index permits at most one row per
	 * {@code (user, role, scope type, scope id)} tuple regardless of status, so a role/scope that was
	 * previously revoked (e.g. reassigned away and back) must reuse that row rather than insert a
	 * second one for the same tuple.
	 *
	 * @param command  the assignment command
	 * @param resolved the resolved role and scope type
	 * @param userId   the target user id, already locked by the caller
	 * @return the reactivated or newly created assignment
	 */
	HubRoleAssignment reactivateOrCreate(AssignRoleModel command, ResolvedAssignment resolved, Long userId) {
		Optional<HubRoleAssignment> existing = hubRoleAssignmentService.findForScopeForUpdate(
				userId, resolved.role().getId(), resolved.scopeType().getId(), command.scopeId());
		if (existing.isPresent()) {
			HubRoleAssignment assignment = existing.get();
			assignment.setStatus(HubStatus.ACTIVE.getCode());
			return hubRoleAssignmentService.save(assignment);
		}
		HubRoleAssignment created = hubRoleAssignmentMapper.toNewAssignment(
				command, resolved, userId, HubStatus.ACTIVE.getCode());
		return hubRoleAssignmentService.save(created);
	}

	@Override
	@Transactional
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#command.userId()")
	public void revokeRole(RevokeRoleModel command) {
		if (command == null || command.assignmentId() == null) {
			throw new BusinessException(OperationalHubErrorReason.OPH_013);
		}
		hubRoleAssignmentService
				.findByIdForUpdate(command.assignmentId())
				.filter(assignment -> HubStatus.ACTIVE.getCode().equals(assignment.getStatus()))
				.ifPresent(this::revoke);
	}

	/**
	 * Enforces the single-active-assignment rule: a user may hold at most one active assignment at a
	 * time, so assigning a new role/scope automatically revokes whatever the user held before instead
	 * of requiring the caller to revoke first.
	 *
	 * <p>The schema still permits multiple assignment rows (kept for future requirements), so this
	 * rule is enforced in logic only. The caller has already locked the user row, which serializes
	 * concurrent assignments for the same user and makes this read consistent.
	 *
	 * @param userId      the target user id, already locked by the caller
	 * @param roleId      the id of the role being assigned
	 * @param scopeTypeId the id of the scope type being assigned
	 * @param scopeId     the scope id being assigned, or {@code null} for an unscoped assignment
	 */
	void revokeOtherActiveAssignments(Long userId, Long roleId, Long scopeTypeId, Long scopeId) {
		hubRoleAssignmentService.findActiveByUserId(userId).stream()
				.filter(assignment -> !matchesAssignment(assignment, roleId, scopeTypeId, scopeId))
				.forEach(this::revoke);
	}

	/**
	 * Tells whether an assignment already grants exactly the given role/scope.
	 *
	 * @param assignment  the existing assignment
	 * @param roleId      the role id to compare against
	 * @param scopeTypeId the scope type id to compare against
	 * @param scopeId     the scope id to compare against, or {@code null} for an unscoped assignment
	 * @return {@code true} when the assignment matches role, scope type, and scope id
	 */
	boolean matchesAssignment(HubRoleAssignment assignment, Long roleId, Long scopeTypeId, Long scopeId) {
		return assignment.getRole() != null
				&& roleId.equals(assignment.getRole().getId())
				&& assignment.getScopeType() != null
				&& scopeTypeId.equals(assignment.getScopeType().getId())
				&& Objects.equals(scopeId, assignment.getScopeId());
	}

	/**
	 * Marks an assignment as REVOKED and persists the change.
	 *
	 * @param assignment the active assignment to revoke
	 */
	void revoke(HubRoleAssignment assignment) {
		assignment.setStatus(HubStatus.REVOKED.getCode());
		hubRoleAssignmentService.save(assignment);
		cacheInvalidationEventService.publishUpdateEvent(HubRoleAssignment.class);
	}

	/**
	 * Maps a single assignment entity to its enriched model.
	 *
	 * @param assignment the assignment entity to map
	 * @return the enriched assignment model
	 */
	RoleAssignmentModel singleView(HubRoleAssignment assignment) {
		return hubRoleAssignmentMapper.toModel(assignment);
	}
}
