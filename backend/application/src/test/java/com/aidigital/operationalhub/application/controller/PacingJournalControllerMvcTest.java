package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingJournalController} (§15 of the migration plan, US-139).
 */
@ExtendWith(MockitoExtension.class)
class PacingJournalControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingContractMapper assertionMapper;

	@Mock
	private PacingDashboardContractMapper mapper;

	@Mock
	private HubUserService hubUserService;

	@InjectMocks
	private PacingJournalController controller;

	private CurrentUserModel stubCurrentUser(PacingScope scope) {
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(scope, true);
		HubAssertion assertion = new HubAssertion(user.email(), scope.kind(), scope.ids(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(assertionMapper).toAssertion(user, entitlement);
		return user;
	}

	@Test
	void shouldAddJournalEntryAndReturnTheWholeFreshJournalTest() throws Exception {
		// Given: §15, US-139 - an admin (kind=all) scope, so every returned entry is editable.
		CurrentUserModel user = stubCurrentUser(PacingScope.all());
		List<PacingJournalEntry> journal =
				List.of(new PacingJournalEntry("j1", "2026-08-05", "Kicked off", user.email(), "pu-1", null));
		doReturn(journal).when(pacingClient).addJournalEntry(any(), eq("nike-ss26"), eq("Kicked off"), eq((String) null));
		doReturn(List.of(mockEntryV1("j1", "Kicked off", true)))
				.when(mapper).toJournalV1(eq(journal), any(), eq(true));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/journal", "nike-ss26")
						.contentType(APPLICATION_JSON).content("{\"message\":\"Kicked off\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.journal[0].id").value("j1"))
				.andExpect(jsonPath("$.journal[0].msg").value("Kicked off"))
				.andExpect(jsonPath("$.journal[0].canEdit").value(true));
	}

	@Test
	void shouldAddJournalEntryWithADateTest() throws Exception {
		// Given: the request carries the note's own date, forwarded to Pacing as plain YYYY-MM-DD.
		stubCurrentUser(PacingScope.all());
		doReturn(List.of()).when(pacingClient).addJournalEntry(any(), eq("nike-ss26"), eq("Kicked off"), eq("2026-08-05"));
		doReturn(List.of()).when(mapper).toJournalV1(any(), any(), eq(true));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/journal", "nike-ss26")
						.contentType(APPLICATION_JSON).content("{\"message\":\"Kicked off\",\"date\":\"2026-08-05\"}"))
				.andExpect(status().isOk());
		verify(pacingClient).addJournalEntry(any(), eq("nike-ss26"), eq("Kicked off"), eq("2026-08-05"));
	}

	@Test
	void shouldComputeCanEditFromTheCallersOwnResolvedPacingUserIdTest() throws Exception {
		// Given: a restricted-scope caller synced into Pacing as "pu-1".
		CurrentUserModel user = stubCurrentUser(PacingScope.owners(List.of("pu-1")));
		HubUser hubUser = new HubUser();
		hubUser.setPacingUserId("pu-1");
		doReturn(Optional.of(hubUser)).when(hubUserService).findByClerkUserId(user.clerkUserId());
		List<PacingJournalEntry> journal =
				List.of(new PacingJournalEntry("j1", "2026-08-05", "Note", user.email(), "pu-1", null));
		doReturn(journal).when(pacingClient).updateJournalEntry(any(), eq("nike-ss26"), eq("j1"), eq("Edited"), eq((String) null));
		doReturn(List.of(mockEntryV1("j1", "Edited", true)))
				.when(mapper).toJournalV1(eq(journal), eq("pu-1"), eq(false));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: the mapper is asked with this caller's own resolved id, not a blanket admin scope.
		mockMvc.perform(patch("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", "nike-ss26", "j1")
						.contentType(APPLICATION_JSON).content("{\"message\":\"Edited\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.journal[0].canEdit").value(true));
		verify(mapper).toJournalV1(journal, "pu-1", false);
	}

	@Test
	void shouldForwardPacingsAuthorOrAdminRejectionAsForbiddenTest() throws Exception {
		// Given: US-139 - Pacing's own SQL refuses an edit from someone who is neither the author nor an
		// admin; the Hub repeats no check of its own, only maps the failure.
		stubCurrentUser(PacingScope.owners(List.of("pu-2")));
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_FORBIDDEN, "not your entry"))
				.when(pacingClient).updateJournalEntry(any(), any(), any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", "nike-ss26", "j1")
						.contentType(APPLICATION_JSON).content("{\"message\":\"Edited\"}"))
				.andExpect(status().isForbidden());
	}

	@Test
	void shouldDeleteJournalEntryWithNoAuthorCheckTest() throws Exception {
		// Given: deleting is permissive by design - any caller with dashboard access may delete any
		// entry, so this needs no author stubbing at all, unlike the edit tests above.
		stubCurrentUser(PacingScope.owners(List.of("pu-2")));
		List<PacingJournalEntry> journal = List.of();
		doReturn(journal).when(pacingClient).deleteJournalEntry(any(), eq("nike-ss26"), eq("j1"));
		doReturn(List.of()).when(mapper).toJournalV1(eq(journal), any(), eq(false));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", "nike-ss26", "j1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.journal").isArray());
		verify(pacingClient).deleteJournalEntry(any(), eq("nike-ss26"), eq("j1"));
	}

	@Test
	void shouldMapUnreachablePacingToServiceUnavailableTest() throws Exception {
		// Given: the generic PacingExternalException mapping applies here too, same as every other
		// pacing endpoint.
		stubCurrentUser(PacingScope.all());
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "down"))
				.when(pacingClient).deleteJournalEntry(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", "nike-ss26", "j1"))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("OPH_051"));
	}

	@Test
	void shouldMapJournalTooFastToTooManyRequestsTest() throws Exception {
		// Given: dash-gate's `journal` bucket refuses a seventh write in a minute with 429 too_fast; the
		// Hub must answer 429/OPH_058 ("wait a moment"), not the bare 500 a rate limit used to collapse
		// into.
		stubCurrentUser(PacingScope.all());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_RATE_LIMITED, "too_fast"))
				.when(pacingClient).addJournalEntry(any(), any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/journal", "nike-ss26")
						.contentType(APPLICATION_JSON).content("{\"message\":\"Kicked off\"}"))
				.andExpect(status().isTooManyRequests())
				.andExpect(jsonPath("$.code").value("OPH_058"));
	}

	private com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryV1 mockEntryV1(
			String id, String msg, boolean canEdit) {
		return new com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryV1()
				.id(id).msg(msg).canEdit(canEdit);
	}
}
