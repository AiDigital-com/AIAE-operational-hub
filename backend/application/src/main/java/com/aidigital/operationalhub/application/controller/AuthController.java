package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.AuthApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.application.mapper.UserContractMapper;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import com.aidigital.operationalhub.usagelogging.LogUsage;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for {@code GET /api/v1/auth/me}.
 *
 * <p>Implements the OpenAPI-generated {@link AuthApi}. Contains no business logic: it resolves the
 * current Hub user, fetches the cached effective access context, looks up the two Pacing facts the
 * dashboard's browser-side journal rule needs, and maps them into the generated {@link UserV1}
 * response.
 */
@RestController
@RequiredArgsConstructor
public class AuthController implements AuthApi {

	private final UserContractMapper mapper;
	private final RbacQueryService rbacQueryService;
	private final CurrentUserService currentUserService;
	private final HubUserService hubUserService;
	private final PacingScopeResolver pacingScopeResolver;

	// The Hub's login signal (PDI_100). This endpoint, and only this one, is what the frontend calls once a
	// Clerk session exists, so it is the single place a sign-in is observable. `resolveCurrentUser` itself is
	// not annotated on purpose: every endpoint calls it, so an event there would count requests, not logins.
	@Override
	@LogUsage(action = "auth.login", eventType = "auth")
	public ResponseEntity<UserV1> getCurrentUser() {
		// Resolve user from authN:
		CurrentUserModel user = currentUserService.resolveCurrentUser();

		// Do fetch RBAC info:
		EffectiveAccessContext access = rbacQueryService.getEffectiveAccess(user.clerkUserId());

		// The two inputs of the dashboard journal's canEdit (DASHBOARD-DATA-PASSTHROUGH-PLAN, H3): the
		// same two lines PacingDashboardController used to run on every dashboard open, answered once
		// per session here so the browser-side port (features/pacing-dashboard/wire.ts) can apply the
		// rule itself. null when the §2 sync has not given this person a Pacing id yet.
		String pacingUserId = hubUserService.findByClerkUserId(user.clerkUserId())
				.map(HubUser::getPacingUserId)
				.orElse(null);
		boolean pacingUnrestricted =
				PacingScope.KIND_ALL.equals(pacingScopeResolver.resolveForCurrentUser(user).scope().kind());

		// Do map&response:
		return ResponseEntity.ok(mapper.toV1(user, access, pacingUserId, pacingUnrestricted));
	}
}
