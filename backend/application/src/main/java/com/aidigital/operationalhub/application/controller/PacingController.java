package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemValidateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingOwnerUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingStatusUpdateV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingCreateContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.AssignableOwnerService;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

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
	private final PacingCreateContractMapper createMapper;
	private final AssignableOwnerService assignableOwnerService;

	@Override
	public ResponseEntity<PacingListResponseV1> listPacings() {
		// Resolve user from authN:
		CurrentUserModel user = currentUserService.resolveCurrentUser();

		// Do resolve the Hub RBAC entitlement into a Pacing assertion, and fetch:
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		List<PacingRow> pacings = pacingClient.listPacings(assertion);

		// Do map&response:
		return ResponseEntity.ok(mapper.toV1(entitlement, pacings));
	}

	/**
	 * §8 of the migration plan (US-123/124): creates a pacing from the caller's reviewed, selected
	 * line items. No business logic here either - Pacing is the one that enforces {@code canCreate}
	 * (carried on the signed assertion) and every other create rule; this only signs, forwards and
	 * maps the result.
	 */
	@Override
	public ResponseEntity<PacingCreateResultV1> createPacing(PacingCreateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		List<PacingCreateLineItem> lineItems =
				body.getLineItems().stream().map(createMapper::toCreateLineItem).toList();
		PacingCreateResult result = pacingClient.createPacing(assertion, body.getPacingName(), lineItems);
		return ResponseEntity.status(HttpStatus.CREATED).body(createMapper.toCreateResultV1(result));
	}

	/**
	 * Changes a pacing's administrative lifecycle status (§9 of the migration plan, US-128). No
	 * business logic here either - Pacing journals the change and fires its own Slack line; this only
	 * signs, forwards and maps the (bodiless) result.
	 */
	@Override
	public ResponseEntity<Void> updatePacingStatus(String pacingId, PacingStatusUpdateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		pacingClient.updateStatus(assertion, pacingId, body.getStatus().getValue());
		// 204, not a bodiless 200 - see the endpoint's own note in openapi.yaml. A 200 with
		// `produces: application/json` and nothing in it is a response the browser client tries to
		// parse the moment a proxy drops its Content-Length.
		return ResponseEntity.noContent().build();
	}

	/**
	 * Reassigns a pacing to another person (§11 of the migration plan, US-131).
	 *
	 * <p>No logic here either: Pacing checks that both the pacing and the recipient sit inside the
	 * asserted scope, and journals who made the change. This signs and forwards.
	 */
	@Override
	public ResponseEntity<Void> transferPacingOwner(String pacingId, PacingOwnerUpdateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		pacingClient.transferOwner(assertion, pacingId, body.getNewOwnerId());
		// 204 for {@link #updatePacingStatus}'s reason.
		return ResponseEntity.noContent().build();
	}

	/**
	 * Who the current user may hand a pacing to (§11, US-131).
	 *
	 * <p>Resolved from the same entitlement that filters the overview, so the picker and the list
	 * agree by construction rather than by two implementations staying in step.
	 */
	@Override
	public ResponseEntity<AssignableOwnerListV1> listAssignableOwners() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return ResponseEntity.ok(mapper.toAssignableOwnerListV1(assignableOwnerService.resolveFor(entitlement)));
	}

	/**
	 * Looks up line items by id directly (§9 of the migration plan, US-126's add-by-id path) - the same
	 * validate endpoint {@link #createPacing}'s draft screen (§8) uses, with a {@code lineItemIds}
	 * selector instead of a campaign id, and therefore the exact same {@code canCreate} requirement.
	 */
	@Override
	public ResponseEntity<PacingDraftV1> validatePacingLineItems(PacingLineItemValidateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		PacingValidateResult result = pacingClient.validateLineItems(assertion, body.getLineItemIds());
		return ResponseEntity.ok(createMapper.toDraftV1(result));
	}
}
