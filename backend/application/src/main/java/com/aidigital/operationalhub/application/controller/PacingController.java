package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * REST controller for {@code GET /api/v1/pacing/pacings}.
 *
 * <p>Implements the OpenAPI-generated {@link PacingApi}. Contains no business logic: resolves the
 * current user, asks {@link PacingScopeResolver} for their Pacing entitlement, signs and sends it to
 * Pacing via {@link PacingClient}, and returns the pacings alongside the entitlement that produced
 * them.
 */
@RestController
@RequiredArgsConstructor
public class PacingController implements PacingApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper mapper;

	@Override
	public ResponseEntity<PacingListResponseV1> listPacings() {
		// Resolve user from authN:
		CurrentUserModel user = currentUserService.resolveCurrentUser();

		// Do resolve the Hub RBAC entitlement into a Pacing assertion, and fetch:
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		List<Map<String, Object>> pacings = pacingClient.listPacings(assertion);

		// Do map&response:
		return ResponseEntity.ok(mapper.toV1(entitlement, pacings));
	}
}
