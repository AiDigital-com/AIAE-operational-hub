package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingDelegationApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationUpdateV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDelegationContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for {@code /api/v1/pacing/delegations} (§12 of the migration plan,
 * US-133/134/135).
 *
 * <p>Implements the OpenAPI-generated {@link PacingDelegationApi}. Contains no business logic: the
 * rules a delegation is subject to - at most 30 days, no delegating to yourself, no duplicate live
 * grants - are database constraints in Pacing, and the plan says so in as many words. This resolves
 * the caller, signs, forwards and maps.
 *
 * <p>Which grants a person may see or revoke is Pacing's answer too: the asserted scope decides, and
 * a delegator outside it earns a 403 there rather than a filter here.
 */
@RestController
@RequiredArgsConstructor
public class PacingDelegationController implements PacingDelegationApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper assertionMapper;
	private final PacingDelegationContractMapper mapper;

	@Override
	public ResponseEntity<PacingDelegationListV1> listPacingDelegations() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		HubAssertion assertion = signUser(user);
		List<PacingDelegation> delegations = pacingClient.listDelegations(assertion);
		return ResponseEntity.ok(new PacingDelegationListV1()
				.delegations(delegations.stream().map((d) -> mapper.toV1(d, user.email())).toList()));
	}

	@Override
	public ResponseEntity<PacingDelegationResultV1> createPacingDelegation(PacingDelegationCreateV1 body) {
		HubAssertion assertion = signCurrentUser();
		pacingClient.createDelegation(assertion, mapper.toGrant(body));
		// 201: a grant is a new thing, and re-granting to the same person over the same scope extends
		// the row Pacing already has rather than adding one - which is still the same answer to the
		// caller, who asked for access to exist and now has it.
		return ResponseEntity.status(HttpStatus.CREATED).body(new PacingDelegationResultV1().saved(true));
	}

	@Override
	public ResponseEntity<PacingDelegationResultV1> updatePacingDelegation(
			String delegationId, PacingDelegationUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		pacingClient.extendDelegation(assertion, delegationId,
				body.getExpiresAt() == null ? null : body.getExpiresAt().toString());
		return ResponseEntity.ok(new PacingDelegationResultV1().saved(true));
	}

	@Override
	public ResponseEntity<PacingDelegationResultV1> revokePacingDelegation(String delegationId) {
		HubAssertion assertion = signCurrentUser();
		pacingClient.revokeDelegation(assertion, delegationId);
		return ResponseEntity.ok(new PacingDelegationResultV1().saved(true));
	}

	/**
	 * Signs the current user's Pacing entitlement, the same way every other pacing controller does.
	 *
	 * @return the assertion to send
	 */
	HubAssertion signCurrentUser() {
		return signUser(currentUserService.resolveCurrentUser());
	}

	/**
	 * Signs an already-resolved user, so a handler that needs the user itself does not resolve twice.
	 *
	 * @param user the current user
	 * @return the assertion to send
	 */
	HubAssertion signUser(CurrentUserModel user) {
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return assertionMapper.toAssertion(user, entitlement);
	}
}
