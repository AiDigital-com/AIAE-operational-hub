package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.RbacApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignRoleRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.RoleAssignmentV1;
import com.aidigital.operationalhub.application.mapper.HubUserSearchContractMapper;
import com.aidigital.operationalhub.application.mapper.RoleAssignmentContractMapper;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAdministrationService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.model.RevokeRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/rbac} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link RbacApi}. Contains no business logic: it delegates to
 * the RBAC services and enforces the manage-roles permission on every RBAC endpoint by resolving the current user
 * and calling {@link RbacAuthorizationService#requireCanManageRoles(CurrentUserModel)}.
 */
@RestController
@RequiredArgsConstructor
public class RbacController implements RbacApi {

	private final RbacQueryService rbacQueryService;
	private final CurrentUserService currentUserService;
	private final HubUserSearchContractMapper hubUserSearchMapper;
	private final RoleAssignmentContractMapper roleAssignmentMapper;
	private final RbacAuthorizationService rbacAuthorizationService;
	private final RbacAdministrationService rbacAdministrationService;

	@Override
	public ResponseEntity<HubUserPageResponseV1> searchUsers(
			Integer pageNumber, Integer pageSize, HubUserSearchRequestV1 hubUserSearchRequestV1) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		var filters = hubUserSearchMapper.toCriteria(hubUserSearchRequestV1, pageNumber, pageSize);
		Page<HubUserSummaryModel> resultPage = rbacQueryService.searchUsers(filters);

		// Do search & map&response:
		return ResponseEntity.ok(hubUserSearchMapper.toPageResponse(resultPage));
	}

	@Override
	public ResponseEntity<List<RoleAssignmentV1>> listRoleAssignments(Long userId) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		List<RoleAssignmentModel> roleAssignmentViews = rbacQueryService.listRoleAssignments(userId);

		// Do map&response:
		return ResponseEntity.ok(roleAssignmentMapper.toV1(roleAssignmentViews));
	}

	@Override
	public ResponseEntity<RoleAssignmentV1> assignRole(
			Long userId, AssignRoleRequestV1 assignRoleRequestV1) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		// Do assignment:
		AssignRoleModel command = roleAssignmentMapper.fromV1(userId, assignRoleRequestV1, currentUser);
		RoleAssignmentModel assignment = rbacAdministrationService.assignRole(command);

		// Do map&response:
		return ResponseEntity.status(HttpStatus.CREATED).body(roleAssignmentMapper.toV1(assignment));
	}

	@Override
	public ResponseEntity<Void> revokeRole(Long userId, Long assignmentId) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		// Do revoke:
		rbacAdministrationService.revokeRole(
				new RevokeRoleModel(userId, assignmentId, currentUser.id()));

		// Do map&response:
		return ResponseEntity.noContent().build();
	}
}
