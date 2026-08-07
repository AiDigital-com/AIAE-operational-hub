package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.SyncApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.SyncSummaryV1;
import com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/sync} endpoint.
 *
 * <p>Implements the OpenAPI-generated {@link SyncApi}. Contains no business logic: it resolves the
 * current user, enforces the manage-roles permission via
 * {@link RbacAuthorizationService#requireCanManageRoles(CurrentUserModel)}, then delegates to
 * {@link NetSuiteSyncService} to eagerly sync users, teams, and team role assignments from the
 * NetSuite/Rippling BigQuery sources.
 */
@RestController
@RequiredArgsConstructor
public class SyncController implements SyncApi {

	private final NetSuiteSyncService netSuiteSyncService;
	private final CurrentUserService currentUserService;
	private final RbacAuthorizationService rbacAuthorizationService;

	@Override
	public ResponseEntity<SyncSummaryV1> syncNetSuite() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to trigger a sync (admin / manage-roles):
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		// Do sync & map&response:
		SyncSummary summary = netSuiteSyncService.sync();
		return ResponseEntity.ok(new SyncSummaryV1(
				summary.teams(), summary.users(), summary.assignmentsUpdated(), summary.agenciesMapped()));
	}
}
