package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingOrderNumberBackfillResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingReferenceSyncError;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingReferenceSyncMarginKpi;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingReferenceSyncNsmapping;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingReferenceSyncResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRevalidateResult;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingAdminController} - the pacing administration screen (not
 * in the migration plan). The tests that matter most here are the non-admin ones: they pin that the
 * Hub refuses the request itself, before {@link PacingClient} is ever called - never merely a hidden
 * button.
 */
@ExtendWith(MockitoExtension.class)
class PacingAdminControllerTest {

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingContractMapper mapper;

	@InjectMocks
	private PacingAdminController controller;

	@Test
	void shouldDeletePacingTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/admin/pacings/p1"))
				.andExpect(status().isNoContent());
		verify(rbacAuthorizationService).requireAdmin(user);
		verify(pacingClient).deletePacing(assertion, "p1");
	}

	@Test
	void shouldRefuseDeleteForNonAdminWithoutCallingPacingTest() throws Exception {
		// Given: the Hub must not send a request it already knows Pacing would refuse - the admin gate
		// throws before pacingClient is ever touched.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("User is not an administrator."))
				.when(rbacAuthorizationService).requireAdmin(user);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/admin/pacings/p1"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
		verify(pacingClient, never()).deletePacing(any(), any());
	}

	@Test
	void shouldReturnNotFoundWhenDeletingAMissingPacingTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true))
				.when(mapper).toAssertion(any(), any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_NOT_FOUND, "pacing_not_found"))
				.when(pacingClient).deletePacing(any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/admin/pacings/missing"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("OPH_054"));
	}

	@Test
	void shouldRunOrderNumberBackfillAndReturnItsSummaryTest() throws Exception {
		// Given: unlike refresh-all this is synchronous - the 200 IS the run's final summary.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(new PacingOrderNumberBackfillResult(614, 12, 580, 22))
				.when(pacingClient).backfillOrderNumbers(assertion);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/backfill-order-numbers"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.scanned").value(614))
				.andExpect(jsonPath("$.filled").value(12))
				.andExpect(jsonPath("$.alreadyHad").value(580))
				.andExpect(jsonPath("$.skippedNoNumbers").value(22));
		verify(rbacAuthorizationService).requireAdmin(user);
	}

	@Test
	void shouldRefuseOrderNumberBackfillForNonAdminWithoutCallingPacingTest() throws Exception {
		// Given: same rule as delete - the Hub refuses before Pacing is ever called.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("User is not an administrator."))
				.when(rbacAuthorizationService).requireAdmin(user);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/backfill-order-numbers"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
		verify(pacingClient, never()).backfillOrderNumbers(any());
	}

	@Test
	void shouldReturnReferenceSyncCountsTest() throws Exception {
		// Given: a healthy run. The counts are the point - they are the only way to tell this apart
		// from a run that read an empty workbook, which also answers 200.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(new PacingReferenceSyncResult(
				true,
				new PacingReferenceSyncNsmapping(730, 45, 41, 5999),
				new PacingReferenceSyncMarginKpi(26, 49),
				List.of()))
				.when(pacingClient).syncReferenceData(assertion);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/sync-reference-data"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.ok").value(true))
				.andExpect(jsonPath("$.marginKpi.margin").value(26))
				.andExpect(jsonPath("$.marginKpi.kpi").value(49))
				.andExpect(jsonPath("$.nsmapping.agencies").value(730));
		verify(rbacAuthorizationService).requireAdmin(user);
	}

	@Test
	void shouldReportAPartlyFailedReferenceSyncAsOkFalseNotAnErrorTest() throws Exception {
		// The unusual contract this controller has to preserve: one half wrote, the other did not.
		// Mapping that onto a 5xx would discard the half that worked and tell the admin nothing about
		// which one to fix.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(new PacingReferenceSyncResult(
				false,
				null,
				new PacingReferenceSyncMarginKpi(26, 49),
				List.of(new PacingReferenceSyncError("nsmapping", "HTTP 403"))))
				.when(pacingClient).syncReferenceData(assertion);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/sync-reference-data"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.ok").value(false))
				.andExpect(jsonPath("$.nsmapping").doesNotExist())
				.andExpect(jsonPath("$.marginKpi.margin").value(26))
				.andExpect(jsonPath("$.errors[0].part").value("nsmapping"));
	}

	@Test
	void shouldRefuseReferenceSyncForNonAdminWithoutCallingPacingTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("User is not an administrator."))
				.when(rbacAuthorizationService).requireAdmin(user);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/sync-reference-data"))
				.andExpect(status().isForbidden());
		verify(pacingClient, never()).syncReferenceData(any());
	}

	@Test
	void shouldTriggerRefreshAllDashboardsTest() throws Exception {
		// Given: a 200 here means "started", never "finished" - the response is the trigger, not the
		// build's completion.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(PacingRefreshOutcome.triggered()).when(pacingClient).refreshAllDashboards(assertion);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/refresh-all-dashboards"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.started").value(true));
	}

	@Test
	void shouldReturnTooManyRequestsWithCountdownOnCooldownTest() throws Exception {
		// Given: US-119's countdown pattern, reused here for the same admin-triggered build.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(PacingRefreshOutcome.cooldown(180)).when(pacingClient).refreshAllDashboards(assertion);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/refresh-all-dashboards"))
				.andExpect(status().isTooManyRequests())
				.andExpect(jsonPath("$.retryAfterSeconds").value(180));
	}

	@Test
	void shouldRefuseRefreshAllForNonAdminWithoutCallingPacingTest() throws Exception {
		// Given: same "never send a request Pacing will refuse" contract as delete.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("User is not an administrator."))
				.when(rbacAuthorizationService).requireAdmin(user);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/refresh-all-dashboards"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
		verify(pacingClient, never()).refreshAllDashboards(any());
	}

	@Test
	void shouldRevalidatePacingAndReportWhatChangedTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(new PacingRevalidateResult(true, List.of("client", "12345"), List.of()))
				.when(pacingClient).revalidatePacing(assertion, "p1");
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: the changed fields are named, not merely counted
		mockMvc.perform(post("/api/v1/pacing/admin/pacings/p1/revalidate"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.changed").value(true))
				.andExpect(jsonPath("$.changes[0]").value("client"))
				.andExpect(jsonPath("$.changes[1]").value("12345"));
		verify(rbacAuthorizationService).requireAdmin(user);
	}

	@Test
	void shouldReturnOkWhenRevalidateFoundNothingToChangeTest() throws Exception {
		// Given: "already in sync with NetSuite" is an answer, not a failure - a plain 200 with
		// changed=false, so the screen can say so rather than render an error.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(new PacingRevalidateResult(false, List.of(), List.of()))
				.when(pacingClient).revalidatePacing(assertion, "p1");
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/pacings/p1/revalidate"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.changed").value(false))
				.andExpect(jsonPath("$.changes").isEmpty());
	}

	@Test
	void shouldRefuseRevalidateForNonAdminWithoutCallingPacingTest() throws Exception {
		// Given: same "never send a request Pacing will refuse" contract as delete.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("User is not an administrator."))
				.when(rbacAuthorizationService).requireAdmin(user);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/pacings/p1/revalidate"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
		verify(pacingClient, never()).revalidatePacing(any(), any());
	}

	@Test
	void shouldReturnServiceUnavailableWhenPacingCannotReachNetSuiteTest() throws Exception {
		// Given: the NetSuite master behind Pacing did not answer - nothing the caller did wrong, and
		// nothing retrying the same second will fix.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true))
				.when(mapper).toAssertion(any(), any());
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "ns_master_error"))
				.when(pacingClient).revalidatePacing(any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/admin/pacings/p1/revalidate"))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("OPH_051"));
	}
}
