package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingUserSyncApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingUserSyncSummaryV1;
import com.aidigital.operationalhub.service.pacingsync.PacingUserSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/sync/pacing-users} endpoint (§2 of the migration plan).
 *
 * <p>Implements the OpenAPI-generated {@link PacingUserSyncApi}. Contains no business logic, the same
 * shape as {@code SyncController} for the NetSuite/Rippling sync: resolves the current user, enforces
 * the manage-roles permission via {@link RbacAuthorizationService#requireCanManageRoles}, then
 * delegates to {@link PacingUserSyncService} to eagerly sync Hub employees into Pacing's user mirror.
 */
@RestController
@RequiredArgsConstructor
public class PacingUserSyncController implements PacingUserSyncApi {

	private final PacingUserSyncService pacingUserSyncService;
	private final CurrentUserService currentUserService;
	private final RbacAuthorizationService rbacAuthorizationService;

	@Override
	public ResponseEntity<PacingUserSyncSummaryV1> syncPacingUsers() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to trigger a sync (admin / manage-roles):
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		// Do sync & map&response:
		PacingUserSyncSummary summary = pacingUserSyncService.sync();
		return ResponseEntity.ok(new PacingUserSyncSummaryV1(
				summary.usersSent(),
				summary.createdInPacing(),
				summary.activated(),
				summary.deactivated(),
				summary.unchanged(),
				summary.idsWritten()));
	}
}
