package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingDriftApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDriftReportV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDriftRowV1;
import com.aidigital.operationalhub.service.pacingdrift.PacingDriftService;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftReport;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftRow;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/pacing/drift} endpoint (US-106, §2 of the migration plan).
 *
 * <p>Implements the OpenAPI-generated {@link PacingDriftApi}. Contains no business logic: resolves the
 * current user, enforces admin-only access via {@link RbacAuthorizationService#requireAdmin} (this is a
 * read of the full roster of both systems, not something every Hub user should see), then delegates to
 * {@link PacingDriftService} and maps the result to the generated contract.
 */
@RestController
@RequiredArgsConstructor
public class PacingDriftController implements PacingDriftApi {

	private final PacingDriftService pacingDriftService;
	private final CurrentUserService currentUserService;
	private final RbacAuthorizationService rbacAuthorizationService;

	@Override
	public ResponseEntity<PacingDriftReportV1> getPacingDrift() {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do check that user is allowed to see this (admin-only):
		rbacAuthorizationService.requireAdmin(currentUser);

		// Do diff & map&response:
		PacingDriftReport report = pacingDriftService.getDrift();
		return ResponseEntity.ok(new PacingDriftReportV1().rows(toV1(report.rows())));
	}

	private List<PacingDriftRowV1> toV1(List<PacingDriftRow> rows) {
		return rows.stream()
				.map(row -> new PacingDriftRowV1()
						.email(row.email())
						.category(PacingDriftRowV1.CategoryEnum.valueOf(row.category().name()))
						.hubName(row.hubName())
						.pacingName(row.pacingName())
						.hubActive(row.hubActive())
						.pacingActive(row.pacingActive()))
				.toList();
	}
}
