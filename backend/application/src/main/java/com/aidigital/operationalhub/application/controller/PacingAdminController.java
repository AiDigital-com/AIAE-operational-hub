package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingAdminApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshTriggeredV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRetryAfterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRevalidateResultV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRevalidateResult;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/pacing/admin/*} endpoints - the pacing administration
 * screen that is not in the migration plan (the plan's seventeen sections skip it entirely) but is
 * carried over from the retired Pacing front end's own Admin screen and row menu: deleting a
 * mistakenly created pacing, re-running the nightly Daily Build off-schedule, and re-pulling one
 * pacing's configuration from the NetSuite master.
 *
 * <p>Implements the OpenAPI-generated {@link PacingAdminApi}. Unlike {@link PacingController}, every
 * method here first calls {@link RbacAuthorizationService#requireAdmin} - the Hub does not merely hide
 * these actions from a non-admin's UI, it refuses the request itself before it ever reaches Pacing,
 * which would refuse it again anyway (both endpoints are admin-only on the Pacing side too). Beyond
 * that gate, no business logic: resolves the current user, signs the assertion and forwards to
 * {@link PacingClient}, mapping a cooldown to 429 exactly as {@link PacingDashboardController#refreshPacing}
 * does for a single pacing.
 */
@RestController
@RequiredArgsConstructor
public class PacingAdminController implements PacingAdminApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final RbacAuthorizationService rbacAuthorizationService;
	private final PacingClient pacingClient;
	private final PacingContractMapper mapper;

	@Override
	public ResponseEntity<Void> deletePacing(String pacingId) {
		HubAssertion assertion = signCurrentUserAsAdmin();
		pacingClient.deletePacing(assertion, pacingId);
		// 204, not 200: there is nothing to report, and an empty body under a 200
		// made the generated client try to parse one - a successful delete reached
		// the user as "Unexpected end of JSON input".
		return ResponseEntity.noContent().build();
	}

	@Override
	@SuppressWarnings("unchecked")
	public ResponseEntity<PacingRefreshTriggeredV1> refreshAllDashboards() {
		HubAssertion assertion = signCurrentUserAsAdmin();
		PacingRefreshOutcome outcome = pacingClient.refreshAllDashboards(assertion);
		if (!outcome.started()) {
			// 429, not an exception - the same normal-outcome shape as PacingDashboardController's
			// single-pacing refresh: the cooldown is shown as a countdown, never queuing a second build
			// underneath it. The generated return type is PacingRefreshTriggeredV1, but the actual body
			// on this branch is PacingRetryAfterV1 - the OpenAPI contract types this response
			// per-status, so the raw ResponseEntity is built here rather than through the generated
			// signature, same as the single-pacing refresh controller.
			return (ResponseEntity<PacingRefreshTriggeredV1>) (ResponseEntity<?>) ResponseEntity
					.status(HttpStatus.TOO_MANY_REQUESTS)
					.body(new PacingRetryAfterV1().retryAfterSeconds(outcome.retryAfterSeconds()));
		}
		return ResponseEntity.ok(new PacingRefreshTriggeredV1().started(true));
	}

	@Override
	public ResponseEntity<PacingRevalidateResultV1> revalidatePacing(String pacingId) {
		HubAssertion assertion = signCurrentUserAsAdmin();
		PacingRevalidateResult result = pacingClient.revalidatePacing(assertion, pacingId);
		// A run that found nothing to change is a plain 200 with changed=false - the screen reports
		// "already in sync", which is an answer, not an error.
		return ResponseEntity.ok(new PacingRevalidateResultV1()
				.changed(result.changed())
				.changes(result.changes())
				.warnings(result.warnings()));
	}

	/**
	 * Requires the current user to be an administrator, then resolves and signs their assertion. Every
	 * admin caller resolves to an unfiltered ({@code kind=all}) Pacing scope by construction (see
	 * {@link PacingScopeResolver}), which is exactly what Pacing itself requires of these two endpoints
	 * - so the requireAdmin check here and Pacing's own {@code admin_only} gate agree by the same route,
	 * never by coincidence.
	 *
	 * @return the signed assertion to send to Pacing
	 */
	private HubAssertion signCurrentUserAsAdmin() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		rbacAuthorizationService.requireAdmin(user);
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return mapper.toAssertion(user, entitlement);
	}
}
