package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.ClientPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSearchRequestV1;
import com.aidigital.operationalhub.application.mapper.ClientSearchContractMapper;
import com.aidigital.operationalhub.service.agency.ClientService;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link ClientController}.
 */
@ExtendWith(MockitoExtension.class)
class ClientControllerMvcTest {

	@Mock
	private ClientService clientService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private ClientSearchContractMapper clientSearchMapper;

	@InjectMocks
	private ClientController controller;

	@Test
	void shouldSearchClientsForCurrentUserTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<ClientModel> page = new PageImpl<>(Instancio.ofList(ClientModel.class).size(1).create());
		ClientPageResponseV1 response = Instancio.create(ClientPageResponseV1.class);
		response.setTotalElements(5L);
		ArgumentCaptor<ClientSearchRequestV1> bodyCaptor = ArgumentCaptor.forClass(ClientSearchRequestV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		when(clientSearchMapper.toCriteria(bodyCaptor.capture(), eq(1), eq(20))).thenReturn(criteria);
		doReturn(page).when(clientService).searchClients(currentUser, criteria);
		doReturn(response).when(clientSearchMapper).toPageResponse(page);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/clients/search")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"filters\":[]}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.totalElements").value(5));

		// Then: the search runs for the resolved current user
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(clientService).searchClients(userCaptor.capture(), eq(criteria));
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}
}
