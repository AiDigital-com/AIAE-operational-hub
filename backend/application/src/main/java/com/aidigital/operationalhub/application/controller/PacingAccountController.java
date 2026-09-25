package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingAccountApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAccountUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAccountV1;
import com.aidigital.operationalhub.application.mapper.PacingAccountContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAccount;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for {@code /api/v1/pacing/account} (Account Settings, "Daily Summary").
 *
 * <p>Implements the OpenAPI-generated {@link PacingAccountApi}. Contains no business logic: which
 * values are valid, and where {@code auto} actually delivers to, are decided entirely by Pacing.
 * This resolves the caller, signs, forwards and maps.
 */
@RestController
@RequiredArgsConstructor
public class PacingAccountController implements PacingAccountApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper assertionMapper;
	private final PacingAccountContractMapper mapper;

	@Override
	public ResponseEntity<PacingAccountV1> getPacingAccount() {
		HubAssertion assertion = signCurrentUser();
		PacingAccount account = pacingClient.getAccount(assertion);
		return ResponseEntity.ok(mapper.toV1(account));
	}

	@Override
	public ResponseEntity<PacingAccountV1> updatePacingAccount(PacingAccountUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		PacingAccount saved = pacingClient.updateAccount(
				assertion, body.getNotifyDestination().getValue(), body.getSlackChannelId());
		return ResponseEntity.ok(mapper.toV1(saved));
	}

	/**
	 * Signs the current user's Pacing entitlement, the same way every other pacing controller does.
	 *
	 * @return the assertion to send
	 */
	HubAssertion signCurrentUser() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return assertionMapper.toAssertion(user, entitlement);
	}
}
