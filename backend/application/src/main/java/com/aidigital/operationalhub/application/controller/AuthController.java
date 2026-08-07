package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.AuthApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.application.mapper.UserContractMapper;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for {@code GET /api/v1/auth/me}.
 *
 * <p>Implements the OpenAPI-generated {@link AuthApi}. Contains no business logic: it resolves the
 * current Hub user, fetches the cached effective access context, and maps both into the generated
 * {@link UserV1} response.
 */
@RestController
@RequiredArgsConstructor
public class AuthController implements AuthApi {

	private final UserContractMapper mapper;
	private final RbacQueryService rbacQueryService;
	private final CurrentUserService currentUserService;

	@Override
	public ResponseEntity<UserV1> getCurrentUser() {
		// Resolve user from authN:
		CurrentUserModel user = currentUserService.resolveCurrentUser();

		// Do fetch RBAC info:
		EffectiveAccessContext access = rbacQueryService.getEffectiveAccess(user.clerkUserId());

		// Do map&response:
		return ResponseEntity.ok(mapper.toV1(user, access));
	}
}
