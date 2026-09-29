package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingAudienceSyncApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAudienceSyncSummaryV1;
import com.aidigital.operationalhub.service.pacingsync.PacingAudienceSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/sync/pacing-audience} endpoint.
 *
 * <p>Implements the OpenAPI-generated {@link PacingAudienceSyncApi}. Contains no business logic,
 * the same shape as {@link PacingUserSyncController}: resolves the current user, enforces the
 * manage-roles permission via {@link RbacAuthorizationService#requireCanManageRoles}, then
 * delegates to {@link PacingAudienceSyncService#sync()} — the exact same run the 01:45
 * {@code PacingAudienceSyncScheduler} performs, so there is one implementation of the push.
 *
 * <p>Deliberately does NOT take the {@code pacing_audience_sync} lock the scheduler uses: that
 * lock exists to deduplicate a scheduled firing across nodes, not to serialize manual runs — the
 * manual user sync ({@link PacingUserSyncController}) makes the same choice, and the push itself
 * is an idempotent full replacement per pacing, so an overlap with the cron is harmless.
 */
@RestController
@RequiredArgsConstructor
public class PacingAudienceSyncController implements PacingAudienceSyncApi {

	private final PacingAudienceSyncService pacingAudienceSyncService;
	private final CurrentUserService currentUserService;
	private final RbacAuthorizationService rbacAuthorizationService;

	@Override
	public ResponseEntity<PacingAudienceSyncSummaryV1> syncPacingAudience() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to trigger a sync (admin / manage-roles):
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		// Do sync & map&response:
		PacingAudienceSyncSummary summary = pacingAudienceSyncService.sync();
		return ResponseEntity.ok(new PacingAudienceSyncSummaryV1(
				summary.pacingsSent(),
				summary.created(),
				summary.replaced(),
				summary.unknown(),
				summary.ownersUnresolved()));
	}
}
