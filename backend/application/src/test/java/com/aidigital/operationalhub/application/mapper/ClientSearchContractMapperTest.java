package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ClientFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSortFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ClientSearchContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class ClientSearchContractMapperTest {

	@Mock
	private ClientContractMapper clientMapper;

	@Test
	void shouldBuildEmptyCriteriaFromNullRequestTest() {
		// Given:
		ClientSearchContractMapper mapper = new ClientSearchContractMapper(new SearchContractSupport(), clientMapper);

		// When:
		SearchCriteria<ClientField> criteria = mapper.toCriteria(null, 1, 50);

		// Then:
		assertThat(criteria.filters()).isEmpty();
		assertThat(criteria.sort()).isNull();
		assertThat(criteria.pageNumber()).isEqualTo(1);
		assertThat(criteria.pageSize()).isEqualTo(50);
	}

	@Test
	void shouldMapFiltersAndSortFromRequestBodyTest() {
		// Given:
		ClientSearchContractMapper mapper = new ClientSearchContractMapper(new SearchContractSupport(), clientMapper);
		ClientFilterFieldV1 filter = new ClientFilterFieldV1();
		filter.setField(ClientFilterFieldEnumV1.AGENCY_ID);
		filter.setValue("42");
		filter.setOperation(FilterOperationEnumV1.EQUALS);
		filter.setCaseSensitive(false);
		ClientSortFieldV1 sort = new ClientSortFieldV1();
		sort.setField(ClientSortFieldEnumV1.NAME);
		sort.setDirection(DirectionEnumV1.DESC);
		ClientSearchRequestV1 request = new ClientSearchRequestV1();
		request.setFilters(List.of(filter));
		request.setSorting(sort);

		// When:
		SearchCriteria<ClientField> criteria = mapper.toCriteria(request, 1, 20);

		// Then:
		assertThat(criteria.filters()).hasSize(1);
		assertThat(criteria.filters().get(0).field()).isEqualTo(ClientField.AGENCY_ID);
		assertThat(criteria.filters().get(0).value()).isEqualTo("42");
		assertThat(criteria.filters().get(0).operation()).isEqualTo(FilterOperation.EQUALS);
		assertThat(criteria.sort().field()).isEqualTo(ClientField.NAME);
		assertThat(criteria.sort().direction()).isEqualTo(SortDirection.DESC);
	}

	@Test
	void shouldMapPageIntoOneBasedPageResponseTest() {
		// Given:
		ClientSearchContractMapper mapper = new ClientSearchContractMapper(new SearchContractSupport(), clientMapper);
		ClientModel model = Instancio.create(ClientModel.class);
		ClientV1 clientV1 = Instancio.create(ClientV1.class);
		PageImpl<ClientModel> page = new PageImpl<>(List.of(model), PageRequest.of(2, 20), 70);
		when(clientMapper.toV1(page.getContent())).thenReturn(List.of(clientV1));

		// When:
		ClientPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(3);
		assertThat(response.getPageSize()).isEqualTo(20);
		assertThat(response.getTotalElements()).isEqualTo(70);
		assertThat(response.getTotalPages()).isEqualTo(4);
		assertThat(response.getContent()).containsExactly(clientV1);
	}
}
