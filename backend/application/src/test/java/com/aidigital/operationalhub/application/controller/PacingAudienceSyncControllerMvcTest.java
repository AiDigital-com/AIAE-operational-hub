package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.service.pacingsync.PacingAudienceSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingAudienceSyncController}, mirroring
 * {@code PacingUserSyncControllerMvcTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingAudienceSyncControllerMvcTest {

	@Mock
	private PacingAudienceSyncService pacingAudienceSyncService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@InjectMocks
	private PacingAudienceSyncController controller;

	@Test
	void shouldSyncAndReturnSummaryTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(new PacingAudienceSyncSummary(42, 3, 38, 1, 2))
				.when(pacingAudienceSyncService).sync();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/sync/pacing-audience"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.pacingsSent").value(42))
				.andExpect(jsonPath("$.created").value(3))
				.andExpect(jsonPath("$.replaced").value(38))
				.andExpect(jsonPath("$.unknown").value(1))
				.andExpect(jsonPath("$.ownersUnresolved").value(2));

		// Then: the manage-roles permission is enforced for the resolved user
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldReturnForbiddenWhenSyncingWithoutPermissionTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied"))
				.when(rbacAuthorizationService).requireCanManageRoles(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/sync/pacing-audience"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnServiceUnavailableWhenPacingIsUnreachableTest() throws Exception {
		// Given: proves the existing generic PacingExternalException handling applies here too,
		// with no extra mapping needed for this controller
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "unreachable"))
				.when(pacingAudienceSyncService).sync();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/sync/pacing-audience"))
				.andExpect(status().isServiceUnavailable());
	}
}
