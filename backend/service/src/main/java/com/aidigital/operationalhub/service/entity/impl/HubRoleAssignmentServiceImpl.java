package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubRoleAssignmentRepository;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Default {@link HubRoleAssignmentService} delegating to {@link HubRoleAssignmentRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubRoleAssignmentServiceImpl implements HubRoleAssignmentService {

	private final HubRoleAssignmentRepository assignmentRepository;

	@Override
	public List<HubRoleAssignment> findActiveByUserId(Long userId) {
		return assignmentRepository.findAllByUserIdAndStatus(userId, HubStatus.ACTIVE.getCode());
	}

	@Override
	public List<HubRoleAssignment> findActiveByUserIds(Collection<Long> userIds) {
		if (userIds.isEmpty()) {
			return List.of();
		}
		return assignmentRepository.findAllByUserIdInAndStatus(userIds, HubStatus.ACTIVE.getCode());
	}

	@Override
	public List<HubRoleAssignment> findAllByUserIds(Collection<Long> userIds) {
		if (userIds.isEmpty()) {
			return List.of();
		}
		return assignmentRepository.findAllByUserIdIn(userIds);
	}

	@Override
	public Optional<HubRoleAssignment> findByIdForUpdate(Long assignmentId) {
		return assignmentRepository.findByIdForUpdate(assignmentId);
	}

	@Override
	public List<HubRoleAssignment> findActiveConflictsForUpdate(
			Long userId, Long roleId, Long scopeTypeId, Long scopeId) {
		return assignmentRepository.findActiveForUserAndScopeForUpdate(
				userId, roleId, scopeTypeId, scopeId, HubStatus.ACTIVE.getCode());
	}

	@Override
	public Optional<HubRoleAssignment> findForScopeForUpdate(
			Long userId, Long roleId, Long scopeTypeId, Long scopeId) {
		return assignmentRepository.findForScopeForUpdate(userId, roleId, scopeTypeId, scopeId);
	}

	@Override
	public HubRoleAssignment save(HubRoleAssignment assignment) {
		return assignmentRepository.save(assignment);
	}
}
