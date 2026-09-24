package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDelegationContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationGrant;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * §12. The controller decides nothing - Pacing owns every delegation rule - so what is worth
 * pinning is the wiring: that the caller's identity reaches the mapper (without it nobody can be
 * told which grants are theirs), and that a refusal arrives as the sentence Pacing wrote.
 */
@ExtendWith(MockitoExtension.class)
class PacingDelegationControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;
	@Mock
	private PacingScopeResolver pacingScopeResolver;
	@Mock
	private PacingClient pacingClient;
	@Mock
	private PacingContractMapper assertionMapper;
	@Mock
	private PacingDelegationContractMapper mapper;
	@InjectMocks
	private PacingDelegationController controller;

	private CurrentUserModel stubCurrentUser() {
		CurrentUserModel user = new CurrentUserModel(1L, "clerk", "me@aidigital.com", "Me", "ACTIVE");
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(assertionMapper).toAssertion(user, entitlement);
		return user;
	}

	private PacingDelegation aDelegation() {
		return new PacingDelegation("d1", "u1", "Lead", "lead@aidigital.com", "u2", "Me",
				"me@aidigital.com", "2026-09-01T00:00:00Z", "2026-09-20T23:59:59Z", null, null, null, null, 3);
	}

	@Test
	void shouldTellTheMapperWhoIsAskingTest() throws Exception {
		// Given: which side of a grant the caller is on can only be answered against their identity,
		// and the id a delegation is keyed on is Pacing's, not the Hub's - so email is what travels.
		CurrentUserModel user = stubCurrentUser();
		doReturn(List.of(aDelegation())).when(pacingClient).listDelegations(any());
		doReturn(new PacingDelegationV1().delegationId("d1").direction(PacingDelegationV1.DirectionEnum.RECEIVED))
				.when(mapper).toV1(any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/delegations"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.delegations[0].direction").value("received"));
		ArgumentCaptor<String> email = ArgumentCaptor.forClass(String.class);
		verify(mapper).toV1(any(), email.capture());
		assertThat(email.getValue()).isEqualTo(user.email());
	}

	@Test
	void shouldGrantADelegationTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingDelegationGrant grant = new PacingDelegationGrant("u2", null, "2026-09-20", null, List.of());
		doReturn(grant).when(mapper).toGrant(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: 201 - the caller asked for access to exist, and now it does
		mockMvc.perform(post("/api/v1/pacing/delegations")
						.contentType(APPLICATION_JSON)
						.content("{\"delegateId\":\"u2\",\"expiresAt\":\"2026-09-20\"}"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.saved").value(true));
		verify(pacingClient).createDelegation(any(), any());
	}

	@Test
	void shouldForwardPacingsRefusalWithItsOwnWordsTest() throws Exception {
		// Given: Pacing refusing a grant that would cut an active one short. The date it carries is
		// the whole point - "conflict" alone leaves the delegator with nothing to do next.
		stubCurrentUser();
		doReturn(new PacingDelegationGrant("u2", null, "2026-09-20", null, List.of())).when(mapper).toGrant(any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_BAD_REQUEST, "would_shorten_active",
				"An active delegation already runs to 2026-10-05. Revoke it first, or pick a date on or after that one."))
				.when(pacingClient).createDelegation(any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/delegations")
						.contentType(APPLICATION_JSON)
						.content("{\"delegateId\":\"u2\",\"expiresAt\":\"2026-09-20\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("2026-10-05")));
	}

	@Test
	void shouldRevokeAndExtendByIdTest() throws Exception {
		// Given: a delegation over several pacings is several rows, so both act on one id.
		stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/delegations/{id}", "d1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.saved").value(true));
		mockMvc.perform(patch("/api/v1/pacing/delegations/{id}", "d1")
						.contentType(APPLICATION_JSON).content("{\"expiresAt\":\"2026-09-25\"}"))
				.andExpect(status().isOk());
		verify(pacingClient).revokeDelegation(any(), org.mockito.ArgumentMatchers.eq("d1"));
		verify(pacingClient).extendDelegation(any(), org.mockito.ArgumentMatchers.eq("d1"),
				org.mockito.ArgumentMatchers.eq("2026-09-25"));
	}
}
