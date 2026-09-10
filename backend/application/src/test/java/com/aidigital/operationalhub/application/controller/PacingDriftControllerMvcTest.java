package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.service.pacingdrift.PacingDriftService;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftCategory;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftReport;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftRow;
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

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingDriftController}, mirroring {@code
 * PacingUserSyncControllerMvcTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingDriftControllerMvcTest {

	@Mock
	private PacingDriftService pacingDriftService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@InjectMocks
	private PacingDriftController controller;

	@Test
	void shouldReturnTheDriftReportMappedToTheGeneratedContractTest() throws Exception {
		// Given: reproduces the exact live-database case this report exists to catch
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		PacingDriftReport report = new PacingDriftReport(List.of(
				new PacingDriftRow(
						"alice@aidigital.com", PacingDriftCategory.MISSING_IN_HUB, null, "Alice", null, true),
				new PacingDriftRow(
						"drift@x.com", PacingDriftCategory.NAME_MISMATCH, "Hub Name", "Pacing Name", true, true)));
		doReturn(report).when(pacingDriftService).getDrift();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/drift"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.rows.length()").value(2))
				.andExpect(jsonPath("$.rows[0].email").value("alice@aidigital.com"))
				.andExpect(jsonPath("$.rows[0].category").value("MISSING_IN_HUB"))
				.andExpect(jsonPath("$.rows[0].hubName").value(nullValue()))
				.andExpect(jsonPath("$.rows[0].pacingName").value("Alice"))
				.andExpect(jsonPath("$.rows[0].pacingActive").value(true))
				.andExpect(jsonPath("$.rows[1].category").value("NAME_MISMATCH"))
				.andExpect(jsonPath("$.rows[1].hubName").value("Hub Name"))
				.andExpect(jsonPath("$.rows[1].pacingName").value("Pacing Name"));

		// Then: admin-only is enforced for the resolved user
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireAdmin(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldReturnForbiddenWhenNotAnAdminTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied")).when(rbacAuthorizationService).requireAdmin(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/drift"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnServiceUnavailableWhenPacingIsUnreachableTest() throws Exception {
		// Given: proves the existing generic PacingExternalException handling applies here too
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "unreachable"))
				.when(pacingDriftService).getDrift();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/drift"))
				.andExpect(status().isServiceUnavailable());
	}

	@Test
	void shouldReturnAnEmptyRowListWhenBothSidesAgreeTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(new PacingDriftReport(List.of())).when(pacingDriftService).getDrift();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/drift"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.rows.length()").value(0));
	}
}
