package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAccountV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifyDestinationV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingAccountContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAccount;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Account Settings ("Daily Summary"). Pacing decides everything about the preference itself -
 * which values are valid, and what {@code auto} resolves to - so what is worth pinning here is the
 * wiring: the caller's own assertion reaches Pacing, the selected value is forwarded as sent, and a
 * refusal (an invalid value) arrives as a real 400 with Pacing's own reason.
 */
@ExtendWith(MockitoExtension.class)
class PacingAccountControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;
	@Mock
	private PacingScopeResolver pacingScopeResolver;
	@Mock
	private PacingClient pacingClient;
	@Mock
	private PacingContractMapper assertionMapper;
	@Mock
	private PacingAccountContractMapper mapper;
	@InjectMocks
	private PacingAccountController controller;

	private void stubCurrentUser() {
		CurrentUserModel user = new CurrentUserModel(1L, "clerk", "me@aidigital.com", "Me", "ACTIVE");
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(assertionMapper).toAssertion(user, entitlement);
	}

	@Test
	void shouldReturnTheStoredPreferenceTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(new PacingAccount("auto", "G123", null)).when(pacingClient).getAccount(any());
		doReturn(new PacingAccountV1().notifyDestination(PacingNotifyDestinationV1.AUTO).slackChannelId("G123"))
				.when(mapper).toV1(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/account"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.notifyDestination").value("auto"))
				.andExpect(jsonPath("$.slackChannelId").value("G123"));
	}

	@Test
	void shouldForwardTheSelectedValueAsSentTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(new PacingAccount("dm", "G123", null)).when(pacingClient).updateAccount(any(), eq("dm"), eq("G123"));
		doReturn(new PacingAccountV1().notifyDestination(PacingNotifyDestinationV1.DM).slackChannelId("G123"))
				.when(mapper).toV1(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: the body round-trips slackChannelId even though only notifyDestination changed
		// - see PacingAccountUpdateV1's own description for why the caller always sends both.
		mockMvc.perform(patch("/api/v1/pacing/account")
						.contentType(APPLICATION_JSON)
						.content("{\"notifyDestination\":\"dm\",\"slackChannelId\":\"G123\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.notifyDestination").value("dm"));
		verify(pacingClient).updateAccount(any(), eq("dm"), eq("G123"));
	}

	@Test
	void shouldForwardPacingsRefusalAsABadRequestTest() throws Exception {
		// Given: Pacing refuses anything outside auto/dm/off - the contract cannot express that value
		// in the first place, but the failure still needs an honest status if Pacing's own validation
		// ever disagrees with the Hub's.
		stubCurrentUser();
		doThrow(new PacingExternalException(
				PacingFailureReason.UPSTREAM_BAD_REQUEST, "invalid_notify_destination", "invalid_notify_destination"))
				.when(pacingClient).updateAccount(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/account")
						.contentType(APPLICATION_JSON)
						.content("{\"notifyDestination\":\"off\",\"slackChannelId\":\"\"}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void shouldForwardASlackChannelRefusalAsABadRequestWithPacingsOwnReasonTest() throws Exception {
		// Given: a slackChannelId Pacing could not verify against Slack - the reason must reach the
		// caller as words (Pacing's own detail), not just a status code.
		stubCurrentUser();
		doThrow(new PacingExternalException(
				PacingFailureReason.UPSTREAM_BAD_REQUEST, "slack_channel_invalid",
				"You aren't a member of that group yet. Join it, then save again."))
				.when(pacingClient).updateAccount(any(), any(), eq("G_NOT_MINE"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(patch("/api/v1/pacing/account")
						.contentType(APPLICATION_JSON)
						.content("{\"notifyDestination\":\"auto\",\"slackChannelId\":\"G_NOT_MINE\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("member of that group")));
	}
}
