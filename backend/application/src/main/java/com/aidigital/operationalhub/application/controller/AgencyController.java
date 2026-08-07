package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.AgenciesApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySearchRequestV1;
import com.aidigital.operationalhub.application.mapper.AgencySearchContractMapper;
import com.aidigital.operationalhub.service.agency.AgencyService;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for the {@code /api/v1/agencies} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link AgenciesApi}. Contains no business logic: it resolves
 * the current user, delegates to {@link AgencyService} (which applies the RBAC scope, dynamic
 * filters, sorting, and paging against BigQuery), and maps the result into the generated contract.
 */
@RestController
@RequiredArgsConstructor
public class AgencyController implements AgenciesApi {

	private final AgencyService agencyService;
	private final CurrentUserService currentUserService;
	private final AgencySearchContractMapper agencySearchMapper;

	@Override
	public ResponseEntity<AgencyPageResponseV1> searchAgencies(
			Integer pageNumber, Integer pageSize, AgencySearchRequestV1 agencySearchRequestV1) {
		// Resolve user from authN:
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();

		// Do search:
		SearchCriteria<AgencyField> criteria =
				agencySearchMapper.toCriteria(agencySearchRequestV1, pageNumber, pageSize);
		boolean includeClients = agencySearchRequestV1 != null
				&& Boolean.TRUE.equals(agencySearchRequestV1.getIncludeClients());
		String search =
				agencySearchRequestV1 != null && agencySearchRequestV1.getSearch() != null
						? agencySearchRequestV1.getSearch().trim()
						: "";
		Page<AgencyModel> page =
				agencyService.searchAgencies(currentUser, criteria, search, includeClients);

		// Do map&response:
		return ResponseEntity.ok(agencySearchMapper.toPageResponse(page));
	}
}
