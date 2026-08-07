package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySearchRequestV1;
import com.aidigital.operationalhub.application.mapper.AgencySearchContractMapper;
import com.aidigital.operationalhub.service.agency.AgencyService;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
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
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * Direct unit tests for {@link AgencyController}.
 *
 * <p>These tests exercise the controller method in isolation without the Spring MVC machinery,
 * verifying that it resolves the current user, delegates to the service, and maps the result.
 */
@ExtendWith(MockitoExtension.class)
class AgencyControllerTest {

	@Mock
	private AgencyService agencyService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private AgencySearchContractMapper agencySearchMapper;

	@InjectMocks
	private AgencyController controller;

	@Test
	void shouldSearchAgenciesForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		AgencySearchRequestV1 request = Instancio.create(AgencySearchRequestV1.class);
		request.setSearch(null);
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<AgencyModel> page = new PageImpl<>(Instancio.ofList(AgencyModel.class).size(1).create());
		AgencyPageResponseV1 response = Instancio.create(AgencyPageResponseV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(criteria).when(agencySearchMapper).toCriteria(request, 1, 20);
		doReturn(page).when(agencyService).searchAgencies(eq(currentUser), eq(criteria), anyString(), anyBoolean());
		doReturn(response).when(agencySearchMapper).toPageResponse(page);

		// When:
		ResponseEntity<AgencyPageResponseV1> result = controller.searchAgencies(1, 20, request);

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		verify(currentUserService).resolveCurrentUser();
		verify(agencySearchMapper).toCriteria(request, 1, 20);
		verify(agencyService).searchAgencies(eq(currentUser), eq(criteria), anyString(), anyBoolean());
		verify(agencySearchMapper).toPageResponse(page);
		verifyNoMoreInteractions(currentUserService, agencyService, agencySearchMapper);
	}
}
