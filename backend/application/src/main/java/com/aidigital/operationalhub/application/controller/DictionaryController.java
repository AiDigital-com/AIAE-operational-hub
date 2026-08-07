package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.DictionaryApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.RoleV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ScopeTypeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.StatusV1;
import com.aidigital.operationalhub.application.mapper.RoleContractMapper;
import com.aidigital.operationalhub.application.mapper.ScopeContractMapper;
import com.aidigital.operationalhub.application.mapper.StatusContractMapper;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.dictionary.HubStatusService;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/dictionary} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link DictionaryApi}. Contains no business logic: it delegates
 * to the dictionary entity services and enforces the manage-roles permission on every dictionary
 * endpoint by resolving the current user and calling
 * {@link RbacAuthorizationService#requireCanManageRoles(CurrentUserModel)}.
 */
@RestController
@RequiredArgsConstructor
public class DictionaryController implements DictionaryApi {

	private final HubRoleService hubRoleService;
	private final RoleContractMapper roleMapper;
	private final ScopeContractMapper scopeMapper;
	private final StatusContractMapper statusMapper;
	private final HubStatusService hubStatusService;
	private final CurrentUserService currentUserService;
	private final HubScopeTypeService hubScopeTypeService;
	private final RbacAuthorizationService rbacAuthorizationService;

	@Override
	public ResponseEntity<List<RoleV1>> listRoles() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		List<HubRole> roles = hubRoleService.listActiveOrderedByDisplayName();

		// Do map&response:
		return ResponseEntity.ok(roleMapper.toV1(roles));
	}

	@Override
	public ResponseEntity<List<ScopeTypeV1>> listScopeTypes() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		List<HubScopeType> scopeTypes = hubScopeTypeService.listActiveOrderedByDisplayName();

		// Do map&response:
		return ResponseEntity.ok(scopeMapper.toV1(scopeTypes));
	}

	@Override
	public ResponseEntity<List<StatusV1>> listStatuses() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to access resource:
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		List<HubStatus> statuses = hubStatusService.listStatuses();

		// Do map&response:
		return ResponseEntity.ok(statusMapper.toV1(statuses));
	}
}
