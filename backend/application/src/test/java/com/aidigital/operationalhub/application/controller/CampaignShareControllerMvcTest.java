package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareV1;
import com.aidigital.operationalhub.application.mapper.CampaignShareContractMapper;
import com.aidigital.operationalhub.service.campaignshare.CampaignShareService;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The controller decides nothing - {@link CampaignShareService} owns every rule - so what is pinned
 * here is the wiring: the caller reaches the service, the id in the body reaches it unchanged, and the
 * statuses are the ones the contract promises.
 */
@ExtendWith(MockitoExtension.class)
class CampaignShareControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;
	@Mock
	private CampaignShareService campaignShareService;
	@Mock
	private CampaignShareContractMapper mapper;
	@InjectMocks
	private CampaignShareController controller;

	private CurrentUserModel stubCurrentUser() {
		CurrentUserModel user = new CurrentUserModel(1L, "clerk", "me@aidigital.com", "Me", "ACTIVE");
		doReturn(user).when(currentUserService).resolveCurrentUser();
		return user;
	}

	@Test
	void shouldListSharesForTheCurrentUserTest() throws Exception {
		// Given:
		CurrentUserModel user = stubCurrentUser();
		CampaignSharesModel model = new CampaignSharesModel(true, List.of(), List.of());
		doReturn(model).when(campaignShareService).listShares(user, 19813L);
		doReturn(new CampaignShareListV1().canShare(true).shares(List.of())).when(mapper).toV1(model);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/campaigns/19813/shares"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.canShare").value(true));
	}

	@Test
	void shouldCreateAShareWithTheRecipientFromTheBodyTest() throws Exception {
		// Given:
		CurrentUserModel user = stubCurrentUser();
		CampaignShareModel model = new CampaignShareModel(2L, "Beatris", "b@aidigital.com", null, "Me", null, null);
		doReturn(model).when(campaignShareService).share(user, 19813L, 2L);
		doReturn(new CampaignShareV1().hubUserId(2L).fullName("Beatris")).when(mapper).toV1(any(CampaignShareModel.class));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/campaigns/19813/shares")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"hubUserId\":2}"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.fullName").value("Beatris"));
	}

	@Test
	void shouldDeleteAShareAndAnswerNoContentTest() throws Exception {
		// Given:
		CurrentUserModel user = stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/campaigns/19813/shares/2"))
				.andExpect(status().isNoContent());
		verify(campaignShareService).unshare(user, 19813L, 2L, false);
	}

	@Test
	void shouldForwardTheConfirmedTransferFlagOnDeleteTest() throws Exception {
		// Given:
		CurrentUserModel user = stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/campaigns/19813/shares/2").param("transferPacings", "true"))
				.andExpect(status().isNoContent());
		verify(campaignShareService).unshare(user, 19813L, 2L, true);
	}

	@Test
	void shouldListThePacingsAPersonOwnsOnTheCampaignTest() throws Exception {
		// Given:
		CurrentUserModel user = stubCurrentUser();
		List<CampaignSharePacingModel> pacings = List.of(
				new CampaignSharePacingModel("p1", "fox-2026", "Fox 2026", List.of()));
		doReturn(pacings).when(campaignShareService).listOwnedPacings(user, 19813L, 2L);
		doReturn(new CampaignSharePacingListV1().pacings(List.of(
				new CampaignSharePacingV1().pacingId("p1").pacingName("Fox 2026").campaigns(List.of()))))
				.when(mapper).toPacingsV1(pacings);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/campaigns/19813/shares/2/pacings"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.pacings[0].pacingName").value("Fox 2026"));
	}
}
