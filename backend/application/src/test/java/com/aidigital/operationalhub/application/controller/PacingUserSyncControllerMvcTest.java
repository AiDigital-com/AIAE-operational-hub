package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.service.pacingsync.PacingUserSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
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
 * MockMvc contract tests for {@link PacingUserSyncController}, mirroring {@code SyncControllerMvcTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingUserSyncControllerMvcTest {

	@Mock
	private PacingUserSyncService pacingUserSyncService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@InjectMocks
	private PacingUserSyncController controller;

	@Test
	void shouldSyncAndReturnSummaryTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(new PacingUserSyncSummary(178, 3, 2, 5, 168, 8)).when(pacingUserSyncService).sync();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/sync/pacing-users"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.usersSent").value(178))
				.andExpect(jsonPath("$.createdInPacing").value(3))
				.andExpect(jsonPath("$.activated").value(2))
				.andExpect(jsonPath("$.deactivated").value(5))
				.andExpect(jsonPath("$.unchanged").value(168))
				.andExpect(jsonPath("$.idsWritten").value(8));

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
		mockMvc.perform(post("/api/v1/sync/pacing-users"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnServiceUnavailableWhenPacingIsUnreachableTest() throws Exception {
		// Given: proves the existing generic PacingExternalException handling (registered for
		// listPacings) applies here too, with no extra mapping needed for this controller
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "unreachable"))
				.when(pacingUserSyncService).sync();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/sync/pacing-users"))
				.andExpect(status().isServiceUnavailable());
	}
}
