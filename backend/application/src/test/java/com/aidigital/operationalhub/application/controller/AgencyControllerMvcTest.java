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
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link AgencyController}.
 */
@ExtendWith(MockitoExtension.class)
class AgencyControllerMvcTest {

	@Mock
	private AgencyService agencyService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private AgencySearchContractMapper agencySearchMapper;

	@InjectMocks
	private AgencyController controller;

	@Test
	void shouldSearchAgenciesForCurrentUserTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		SearchCriteria<AgencyField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<AgencyModel> page = new PageImpl<>(Instancio.ofList(AgencyModel.class).size(1).create());
		AgencyPageResponseV1 response = Instancio.create(AgencyPageResponseV1.class);
		response.setTotalElements(3L);
		ArgumentCaptor<AgencySearchRequestV1> bodyCaptor = ArgumentCaptor.forClass(AgencySearchRequestV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		when(agencySearchMapper.toCriteria(bodyCaptor.capture(), eq(1), eq(20))).thenReturn(criteria);
		doReturn(page).when(agencyService).searchAgencies(eq(currentUser), eq(criteria), anyString(), anyBoolean());
		doReturn(response).when(agencySearchMapper).toPageResponse(page);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/agencies/search")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"filters\":[]}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.totalElements").value(3));

		// Then: the search runs for the resolved current user
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(agencyService).searchAgencies(userCaptor.capture(), eq(criteria), anyString(), anyBoolean());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}
}
