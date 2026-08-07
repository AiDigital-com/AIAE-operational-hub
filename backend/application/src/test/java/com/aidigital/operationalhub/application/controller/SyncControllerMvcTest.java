package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
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
 * MockMvc contract tests for {@link SyncController}.
 */
@ExtendWith(MockitoExtension.class)
class SyncControllerMvcTest {

	@Mock
	private NetSuiteSyncService netSuiteSyncService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@InjectMocks
	private SyncController controller;

	@Test
	void shouldSyncAndReturnSummaryTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(new SyncSummary(3, 12, 5, 8)).when(netSuiteSyncService).sync();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/sync"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.teams").value(3))
				.andExpect(jsonPath("$.users").value(12))
				.andExpect(jsonPath("$.assignmentsUpdated").value(5))
				.andExpect(jsonPath("$.agenciesMapped").value(8));

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
		mockMvc.perform(post("/api/v1/sync"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}
}
