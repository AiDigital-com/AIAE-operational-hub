package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingDashboardApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAddableLineItemsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDisplayConflictReasonV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDisplayConflictV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDisplayUpdateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDisplayUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffReportV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPlanUpdateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPlanUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshTriggeredV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRetryAfterV1;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingNsDiffContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingPlanContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/pacing/dashboards/*} and
 * {@code /api/v1/pacing/pacings/{pacingId}/refresh} endpoints (§6 of the migration plan,
 * US-114/115/116/117/119).
 *
 * <p>Implements the OpenAPI-generated {@link PacingDashboardApi}. Contains no business logic: resolves
 * the current user, asks {@link PacingScopeResolver} for their Pacing entitlement exactly as
 * {@link PacingController} does, signs and sends it to Pacing via {@link PacingClient}, and maps the
 * result. A concurrent display-save conflict or a refresh cooldown is a normal outcome the mapper
 * turns into the matching typed response, not an exception.
 */
@RestController
@RequiredArgsConstructor
public class PacingDashboardController implements PacingDashboardApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper assertionMapper;
	private final PacingDashboardContractMapper mapper;
	private final PacingPlanContractMapper planMapper;
	private final PacingNsDiffContractMapper nsDiffMapper;

	@Override
	public ResponseEntity<PacingDashboardV1> getPacingDashboard(String slug) {
		HubAssertion assertion = signCurrentUser();
		PacingDashboardData data = pacingClient.getDashboardData(assertion, slug);
		return ResponseEntity.ok(mapper.toV1(data));
	}

	@Override
	public ResponseEntity<PacingRefreshStatusV1> getPacingRefreshStatus(String slug) {
		HubAssertion assertion = signCurrentUser();
		PacingRefreshStatus status = pacingClient.getRefreshStatus(assertion, slug);
		return ResponseEntity.ok(mapper.toV1(status));
	}

	@Override
	@SuppressWarnings("unchecked")
	public ResponseEntity<PacingRefreshTriggeredV1> refreshPacing(String pacingId) {
		HubAssertion assertion = signCurrentUser();
		PacingRefreshOutcome outcome = pacingClient.refreshPacing(assertion, pacingId);
		if (!outcome.started()) {
			// 429, not an exception: the cooldown is a normal, expected outcome US-119 asks the UI to
			// show as a countdown, never queuing a second run underneath it. The generated return type
			// is PacingRefreshTriggeredV1, but the actual body on this branch is PacingRetryAfterV1 - the
			// OpenAPI contract types this response per-status, so the raw ResponseEntity is built here
			// rather than through the generated signature.
			return (ResponseEntity<PacingRefreshTriggeredV1>) (ResponseEntity<?>) ResponseEntity
					.status(HttpStatus.TOO_MANY_REQUESTS)
					.body(new PacingRetryAfterV1().retryAfterSeconds(outcome.retryAfterSeconds()));
		}
		return ResponseEntity.ok(new PacingRefreshTriggeredV1().started(true));
	}

	@Override
	@SuppressWarnings("unchecked")
	public ResponseEntity<PacingDisplayUpdateResultV1> updatePacingDisplay(String slug, PacingDisplayUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		PacingDisplaySaveOutcome outcome =
				pacingClient.saveDisplay(
						assertion, slug, body.getDisplay(), body.getDisplayRev(), body.getDisplayWriter());
		if (!outcome.ok()) {
			// 409, not an exception (US-118): a concurrent edit is reported with the current revision so
			// the caller can reload and re-apply, never silently overwritten. Same per-status typing note
			// as refreshPacing above.
			PacingDisplayConflictV1 conflict = new PacingDisplayConflictV1()
					.reason(PacingDisplayConflictReasonV1.fromValue(outcome.conflictReason()))
					.currentRev(outcome.currentRev());
			return (ResponseEntity<PacingDisplayUpdateResultV1>) (ResponseEntity<?>) ResponseEntity
					.status(HttpStatus.CONFLICT)
					.body(conflict);
		}
		return ResponseEntity.ok(new PacingDisplayUpdateResultV1().display(outcome.display()));
	}

	@Override
	public ResponseEntity<PacingPlanUpdateResultV1> updatePacingPlan(String slug, PacingPlanUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		pacingClient.savePlan(assertion, slug, planMapper.toPlanUpdateLineItems(body));
		return ResponseEntity.ok(new PacingPlanUpdateResultV1().saved(true));
	}

	@Override
	public ResponseEntity<PacingDataSettingsUpdateResultV1> updatePacingDataSettings(
			String slug, PacingDataSettingsUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		pacingClient.saveDataSettings(assertion, slug, mapper.toDataSettings(body));
		return ResponseEntity.ok(new PacingDataSettingsUpdateResultV1().saved(true));
	}

	@Override
	public ResponseEntity<PacingAddableLineItemsV1> getAddablePacingLineItems(String slug) {
		HubAssertion assertion = signCurrentUser();
		PacingAddableLineItems result = pacingClient.getAddableLineItems(assertion, slug);
		return ResponseEntity.ok(planMapper.toAddableLineItemsV1(result));
	}

	@Override
	public ResponseEntity<PacingNsDiffReportV1> getPacingNsDiff(String pacingId) {
		HubAssertion assertion = signCurrentUser();
		PacingNsDiffReport report = pacingClient.getNsDiff(assertion, pacingId);
		return ResponseEntity.ok(nsDiffMapper.toV1(report));
	}

	private HubAssertion signCurrentUser() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return assertionMapper.toAssertion(user, entitlement);
	}
}
