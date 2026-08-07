package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.ClientsApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSearchRequestV1;
import com.aidigital.operationalhub.application.mapper.ClientSearchContractMapper;
import com.aidigital.operationalhub.service.agency.ClientService;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/clients} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link ClientsApi}. Contains no business logic: it resolves
 * the current user, delegates to {@link ClientService} (which applies the RBAC scope, dynamic
 * filters, sorting, and paging against BigQuery), and maps the result into the generated contract.
 */
@RestController
@RequiredArgsConstructor
public class ClientController implements ClientsApi {

	private final ClientService clientService;
	private final CurrentUserService currentUserService;
	private final ClientSearchContractMapper clientSearchMapper;

	@Override
	public ResponseEntity<ClientPageResponseV1> searchClients(
			Integer pageNumber, Integer pageSize, ClientSearchRequestV1 clientSearchRequestV1) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do search:
		SearchCriteria<ClientField> criteria =
				clientSearchMapper.toCriteria(clientSearchRequestV1, pageNumber, pageSize);
		Page<ClientModel> page = clientService.searchClients(currentUser, criteria);

		// Do map&response:
		return ResponseEntity.ok(clientSearchMapper.toPageResponse(page));
	}
}
