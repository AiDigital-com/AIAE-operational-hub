package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingCreateContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.service.rbac.AssignableOwnerService;
import com.aidigital.operationalhub.service.rbac.model.AssignableOwner;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
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
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingController}.
 */
@ExtendWith(MockitoExtension.class)
class PacingControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingContractMapper mapper;

	@Mock
	private PacingCreateContractMapper createMapper;

	@Mock
	private AssignableOwnerService assignableOwnerService;

	@InjectMocks
	private PacingController controller;

	@Test
	void shouldReturnPacingsWithResolvedScopeTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		List<PacingRow> pacings =
				List.of(new PacingRow("p1", "nike-ss26", "Live", null, null, null, 0, null, null, null, null, null));
		PacingListResponseV1 body = new PacingListResponseV1()
				.scope(new PacingScopeV1().kind(PacingScopeV1.KindEnum.ALL).ids(List.of()).canCreate(true))
				.pacings(List.of(new PacingRowV1()
						.id("p1").name("nike-ss26").status(PacingRowV1.StatusEnum.LIVE)
						.lineItemCount(0).alerts(List.of())));
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(pacings).when(pacingClient).listPacings(assertion);
		doReturn(body).when(mapper).toV1(entitlement, pacings);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/pacings"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.scope.kind").value(body.getScope().getKind().getValue()));
	}

	@Test
	void shouldReturnForbiddenWhenUserCannotBeResolvedTest() throws Exception {
		// Given:
		doThrow(new AccessDeniedException("no principal")).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/pacings"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnInternalServerErrorWhenPacingCallFailsTest() throws Exception {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.owners(List.of()), false);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(new HubAssertion(user.email(), PacingScope.KIND_OWNERS, List.of(), false))
				.when(mapper).toAssertion(any(), any());
		doThrow(new PacingExternalException("boom")).when(pacingClient).listPacings(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/pacings"))
				.andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.code").value("OPH_055"));
	}

	@Test
	void shouldCreatePacingFromSelectedLineItemsTest() throws Exception {
		// Given: §8 (US-123) - a straight passthrough, no figure computed along the way.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		PacingCreateLineItem lineItem = new PacingCreateLineItem(
				"599852", "DOOH", "2026-03-01", "2026-03-31", "CPM", "desc", 20633.4, "USD", 1.0,
				"40539", "Campaign", "TM-271064", "Daria Feofanova", 1432875.0, 15.5, 0.85, null);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(lineItem).when(createMapper).toCreateLineItem(any(PacingCreateLineItemV1.class));
		doReturn(new PacingCreateResult("p9", "2026-campaign"))
				.when(pacingClient).createPacing(eq(assertion), eq("2026_Campaign"), eq(List.of(lineItem)));
		doReturn(new PacingCreateResultV1().pacingId("p9").dashSlug("2026-campaign"))
				.when(createMapper).toCreateResultV1(any(PacingCreateResult.class));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		String body = "{\"pacingName\":\"2026_Campaign\",\"lineItems\":[{\"lineItemId\":\"599852\","
				+ "\"flightStart\":\"2026-03-01\",\"flightEnd\":\"2026-03-31\"}]}";

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/pacings").contentType(APPLICATION_JSON).content(body))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.pacingId").value("p9"))
				.andExpect(jsonPath("$.dashSlug").value("2026-campaign"));
	}

	@Test
	void shouldReturnForbiddenWhenCreatePacingLacksCanCreateTest() throws Exception {
		// Given: Pacing itself enforces canCreate and answers 403/no_create_permission, mapped to
		// UPSTREAM_FORBIDDEN by the client - a real, honest 403 here, not the 500 an UNAUTHORIZED gets.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.owners(List.of()), false);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(new HubAssertion(user.email(), PacingScope.KIND_OWNERS, List.of(), false))
				.when(mapper).toAssertion(any(), any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_FORBIDDEN, "no_create_permission"))
				.when(pacingClient).createPacing(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		String body = "{\"pacingName\":\"Pacing\",\"lineItems\":[{\"lineItemId\":\"1\","
				+ "\"flightStart\":\"2026-01-01\",\"flightEnd\":\"2026-01-31\"}]}";

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/pacings").contentType(APPLICATION_JSON).content(body))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_057"));
	}
	@Test
	// 204, not 200: a bodiless 200 on an operation the generator marks `produces: application/json`
	// is a response the browser client parses as JSON and chokes on as soon as a proxy re-chunks it
	// and drops the Content-Length. See the endpoint's note in openapi.yaml.
	void shouldChangePacingStatusTest() throws Exception {
		// Given: §9 (US-128) - a straight passthrough, bodiless on success.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/pacings/p1/status")
						.contentType(APPLICATION_JSON).content("{\"status\":\"Archive\"}"))
				.andExpect(status().isNoContent());
		verify(pacingClient).updateStatus(assertion, "p1", "Archive");
	}

	@Test
	void shouldReturnBadRequestWhenStatusInvalidTest() throws Exception {
		// Given: an unrecognized status never reaches the controller as a valid enum value - it is a
		// generated-model validation 400, not a call to Pacing.
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/pacings/p1/status")
						.contentType(APPLICATION_JSON).content("{\"status\":\"Bogus\"}"))
				.andExpect(status().isBadRequest());
	}

	// ── §11: ownership (US-131) ──

	@Test
	void shouldTransferOwnerTest() throws Exception {
		// Given: a straight passthrough. Pacing decides whether the move is allowed, from the scope this
		// assertion carries - the controller neither re-checks nor records anything.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/pacings/p1/owner")
						.contentType(APPLICATION_JSON)
						.content("{\"newOwnerId\":\"11111111-1111-1111-1111-111111111111\"}"))
				.andExpect(status().isNoContent());
		verify(pacingClient).transferOwner(assertion, "p1", "11111111-1111-1111-1111-111111111111");
	}

	@Test
	void shouldListAssignableOwnersTest() throws Exception {
		// Given: resolved from the SAME entitlement that filters the overview, so the picker and the
		// list cannot disagree.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.owners(List.of("u-azat")), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		List<AssignableOwner> owners = List.of(new AssignableOwner("u-azat", "Azat Nabiev", "azat@aidigital.com"));
		doReturn(owners).when(assignableOwnerService).resolveFor(entitlement);
		doReturn(new AssignableOwnerListV1().owners(List.of(
				new AssignableOwnerV1().pacingUserId("u-azat").name("Azat Nabiev").email("azat@aidigital.com"))))
				.when(mapper).toAssignableOwnerListV1(owners);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/assignable-owners"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.owners[0].pacingUserId").value("u-azat"))
				.andExpect(jsonPath("$.owners[0].name").value("Azat Nabiev"));
	}

	@Test
	void shouldValidateLineItemsByIdTest() throws Exception {
		// Given: §9 (US-126) - add-by-id, a line item from another campaign returned verbatim.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(), List.of(), null, null, null, null, null, null, null, null);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(mapper).toAssertion(user, entitlement);
		doReturn(result).when(pacingClient).validateLineItems(eq(assertion), eq(List.of("12345")));
		doReturn(new PacingDraftV1().ok(true).lineItems(List.of()))
				.when(createMapper).toDraftV1(result);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/line-items/validate")
						.contentType(APPLICATION_JSON).content("{\"lineItemIds\":[\"12345\"]}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.ok").value(true));
	}

	@Test
	void shouldReturnForbiddenWhenValidateLineItemsLacksCanCreateTest() throws Exception {
		// Given: the same canCreate requirement createPacing's validate shares (§9's crooked-but-real
		// constraint carried over from the shared Pacing endpoint).
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.owners(List.of()), false);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(new HubAssertion(user.email(), PacingScope.KIND_OWNERS, List.of(), false))
				.when(mapper).toAssertion(any(), any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_FORBIDDEN, "no_create_permission"))
				.when(pacingClient).validateLineItems(any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/line-items/validate")
						.contentType(APPLICATION_JSON).content("{\"lineItemIds\":[\"12345\"]}"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_057"));
	}
}

