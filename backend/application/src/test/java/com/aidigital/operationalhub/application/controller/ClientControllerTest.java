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
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.ResponseEntity;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * Direct unit tests for {@link ClientController}.
 *
 * <p>These tests exercise the controller method in isolation without the Spring MVC machinery,
 * verifying that it resolves the current user, delegates to the service, and maps the result.
 */
@ExtendWith(MockitoExtension.class)
class ClientControllerTest {

	@Mock
	private ClientService clientService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private ClientSearchContractMapper clientSearchMapper;

	@InjectMocks
	private ClientController controller;

	@Test
	void shouldSearchClientsForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ClientSearchRequestV1 request = Instancio.create(ClientSearchRequestV1.class);
		SearchCriteria<ClientField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<ClientModel> page = new PageImpl<>(Instancio.ofList(ClientModel.class).size(1).create());
		ClientPageResponseV1 response = Instancio.create(ClientPageResponseV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(criteria).when(clientSearchMapper).toCriteria(request, 1, 20);
		doReturn(page).when(clientService).searchClients(currentUser, criteria);
		doReturn(response).when(clientSearchMapper).toPageResponse(page);

		// When:
		ResponseEntity<ClientPageResponseV1> result = controller.searchClients(1, 20, request);

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		verify(currentUserService).resolveCurrentUser();
		verify(clientSearchMapper).toCriteria(request, 1, 20);
		verify(clientService).searchClients(currentUser, criteria);
		verify(clientSearchMapper).toPageResponse(page);
		verifyNoMoreInteractions(currentUserService, clientService, clientSearchMapper);
	}
}
