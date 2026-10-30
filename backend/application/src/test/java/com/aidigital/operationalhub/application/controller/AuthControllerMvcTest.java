package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.UserContractMapper;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link AuthController}.
 */
@ExtendWith(MockitoExtension.class)
class AuthControllerMvcTest {

	@Mock
	private UserContractMapper mapper;

	@Mock
	private RbacQueryService rbacQueryService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@InjectMocks
	private AuthController controller;

	/** A synced Hub user whose Pacing id is {@code pacingUserId}, or an unsynced one when null. */
	private void stubPacingIdentity(CurrentUserModel user, String pacingUserId, PacingScope scope) {
		if (pacingUserId == null) {
			doReturn(Optional.empty()).when(hubUserService).findByClerkUserId(user.clerkUserId());
		} else {
			HubUser hubUser = new HubUser();
			hubUser.setPacingUserId(pacingUserId);
			doReturn(Optional.of(hubUser)).when(hubUserService).findByClerkUserId(user.clerkUserId());
		}
		doReturn(new PacingEntitlement(scope, true)).when(pacingScopeResolver).resolveForCurrentUser(user);
	}

	@Test
	void shouldReturnCurrentUserTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);
		UserV1 body = Instancio.create(UserV1.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(access).when(rbacQueryService).getEffectiveAccess(user.clerkUserId());
		stubPacingIdentity(user, "pu-1", PacingScope.all());
		doReturn(body).when(mapper).toV1(user, access, "pu-1", true);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: an ADMIN (unfiltered scope) is unrestricted, with their own Pacing id.
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.user_id").value(body.getUserId()))
				.andExpect(jsonPath("$.email").value(body.getEmail()))
				.andExpect(jsonPath("$.status").value(body.getStatus()));
	}

	@Test
	void shouldReportARestrictedScopeAsNotUnrestrictedTest() throws Exception {
		// Given: a TEAM-scoped person (owners scope) who is synced into Pacing.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);
		UserV1 body = new UserV1().userId(user.clerkUserId()).email("a@b.c").pacingUserId("pu-7").pacingUnrestricted(false);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(access).when(rbacQueryService).getEffectiveAccess(user.clerkUserId());
		stubPacingIdentity(user, "pu-7", PacingScope.owners(List.of("pu-7"), List.of()));
		doReturn(body).when(mapper).toV1(user, access, "pu-7", false);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: the mapper was handed `false`, and the two fields reach the wire by name.
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.pacingUserId").value("pu-7"))
				.andExpect(jsonPath("$.pacingUnrestricted").value(false));
	}

	@Test
	void shouldLeaveThePacingUserIdNullForAnUnsyncedPersonTest() throws Exception {
		// Given: the §2 sync has not reached this person - no hub_users.pacing_user_id yet.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);
		UserV1 body = new UserV1().userId(user.clerkUserId()).email("a@b.c").pacingUnrestricted(false);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(access).when(rbacQueryService).getEffectiveAccess(user.clerkUserId());
		stubPacingIdentity(user, null, PacingScope.owners(List.of(), List.of()));
		doReturn(body).when(mapper).toV1(eq(user), eq(access), isNull(), eq(false));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.pacingUserId").value((Object) null))
				.andExpect(jsonPath("$.pacingUnrestricted").value(false));
	}

	@Test
	void shouldReturnForbiddenWhenUserCannotBeResolvedTest() throws Exception {
		// Given:
		doThrow(new AccessDeniedException("no principal")).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnForbiddenWhenEffectiveAccessDeniedTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("unknown clerk user"))
				.when(rbacQueryService).getEffectiveAccess(user.clerkUserId());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnInternalServerErrorOnAppExceptionTest() throws Exception {
		// Given:
		doThrow(new AppException("boom")).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.code").value("OPH_000"));
	}
}
