package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.UserContractMapper;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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

	@InjectMocks
	private AuthController controller;

	@Test
	void shouldReturnCurrentUserTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);
		UserV1 body = Instancio.create(UserV1.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(access).when(rbacQueryService).getEffectiveAccess(user.clerkUserId());
		doReturn(body).when(mapper).toV1(user, access);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/auth/me"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.user_id").value(body.getUserId()))
				.andExpect(jsonPath("$.email").value(body.getEmail()))
				.andExpect(jsonPath("$.status").value(body.getStatus()));
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
