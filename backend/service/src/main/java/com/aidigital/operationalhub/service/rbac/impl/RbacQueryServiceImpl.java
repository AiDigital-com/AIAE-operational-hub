package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.mapper.HubRoleAssignmentMapper;
import com.aidigital.operationalhub.service.rbac.mapper.HubUserMapper;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Default {@link RbacQueryService} reading RBAC state through the per-entity services.
 */
@Service
@RequiredArgsConstructor
public class RbacQueryServiceImpl implements RbacQueryService {

	private final HubUserService hubUserService;
	private final HubUserMapper hubUserMapper;
	private final HubRoleAssignmentMapper hubRoleAssignmentMapper;
	private final HubRoleAssignmentService hubRoleAssignmentService;

	@Override
	@Transactional(readOnly = true)
	public Page<HubUserSummaryModel> searchUsers(SearchCriteria<HubUserField> criteria) {
		Page<HubUser> page = hubUserService.searchUsers(criteria);
		Map<Long, HubRoleAssignment> activeByUserId = activeAssignmentByUserId(page.getContent());
		return page.map(user -> {
			HubRoleAssignment assignment = activeByUserId.get(user.getId());
			String roleCode = assignment == null ? null : assignment.getRole().getRoleCode();
			return hubUserMapper.toSummaryModel(user, roleCode, teamScopeId(assignment));
		});
	}

	@Override
	@Transactional(readOnly = true)
	public EffectiveAccessContext getEffectiveAccess(String clerkUserId) {
		HubUser user = hubUserService
				.findByClerkUserId(clerkUserId)
				.orElseThrow(() -> new AccessDeniedException("Unknown Clerk user: " + clerkUserId));
		List<RoleAssignmentModel> assignments = activeAssignmentModels(user.getId());
		Set<String> roleCodes = assignments.stream()
				.map(RoleAssignmentModel::roleCode)
				.collect(Collectors.toSet());
		boolean admin = roleCodes.contains(RbacRoleCode.ADMIN.getCode());
		return new EffectiveAccessContext(
				user.getClerkUserId(), user.getId(), roleCodes, assignments, admin, admin);
	}

	@Override
	@Transactional(readOnly = true)
	public List<RoleAssignmentModel> listRoleAssignments(Long userId) {
		return activeAssignmentModels(userId);
	}

	/**
	 * Resolves each user's single active assignment via one batched query.
	 *
	 * <p>The single-active-role rule guarantees at most one assignment per user; if legacy data carries
	 * several, the first encountered active assignment wins.
	 *
	 * @param users the users to resolve assignments for
	 * @return a map of {@code hub_users.id} to its active assignment, omitting users with none
	 */
	Map<Long, HubRoleAssignment> activeAssignmentByUserId(List<HubUser> users) {
		List<Long> userIds = users.stream().map(HubUser::getId).toList();
		return hubRoleAssignmentService.findActiveByUserIds(userIds).stream()
				.collect(Collectors.toMap(
						HubRoleAssignment::getUserId,
						assignment -> assignment,
						(first, second) -> first));
	}

	/**
	 * Returns the scoped team id of a TEAM-scoped assignment, or {@code null} for any other scope or
	 * a missing assignment.
	 *
	 * @param assignment the active assignment, may be {@code null}
	 * @return the {@code hub_teams.id} the role is scoped to, or {@code null}
	 */
	Long teamScopeId(HubRoleAssignment assignment) {
		if (assignment == null || assignment.getScopeType() == null) {
			return null;
		}
		return RbacScopeCode.TEAM.getCode().equals(assignment.getScopeType().getScopeCode())
				? assignment.getScopeId()
				: null;
	}

	/**
	 * Loads a user's active assignments and maps them to immutable models.
	 *
	 * @param userId the {@code hub_users.id} whose active assignments to load
	 * @return the user's active assignment models
	 */
	List<RoleAssignmentModel> activeAssignmentModels(Long userId) {
		return hubRoleAssignmentService.findActiveByUserId(userId).stream()
				.map(hubRoleAssignmentMapper::toModel)
				.toList();
	}
}
