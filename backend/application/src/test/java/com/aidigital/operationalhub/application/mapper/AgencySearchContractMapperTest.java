package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySortFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
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
 * Unit tests for {@link AgencySearchContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class AgencySearchContractMapperTest {

	@Mock
	private AgencyContractMapper agencyMapper;

	@Test
	void shouldBuildEmptyCriteriaFromNullRequestTest() {
		// Given:
		AgencySearchContractMapper mapper = new AgencySearchContractMapper(new SearchContractSupport(), agencyMapper);

		// When:
		SearchCriteria<AgencyField> criteria = mapper.toCriteria(null, 3, 10);

		// Then:
		assertThat(criteria.filters()).isEmpty();
		assertThat(criteria.sort()).isNull();
		assertThat(criteria.pageNumber()).isEqualTo(3);
		assertThat(criteria.pageSize()).isEqualTo(10);
	}

	@Test
	void shouldMapFiltersAndSortFromRequestBodyTest() {
		// Given:
		AgencySearchContractMapper mapper = new AgencySearchContractMapper(new SearchContractSupport(), agencyMapper);
		AgencyFilterFieldV1 filter = new AgencyFilterFieldV1();
		filter.setField(AgencyFilterFieldEnumV1.NAME);
		filter.setValue("Acme");
		filter.setOperation(FilterOperationEnumV1.CONTAINS);
		filter.setCaseSensitive(false);
		AgencySortFieldV1 sort = new AgencySortFieldV1();
		sort.setField(AgencySortFieldEnumV1.STATUS);
		sort.setDirection(DirectionEnumV1.ASC);
		AgencySearchRequestV1 request = new AgencySearchRequestV1();
		request.setFilters(List.of(filter));
		request.setSorting(sort);

		// When:
		SearchCriteria<AgencyField> criteria = mapper.toCriteria(request, 1, 20);

		// Then:
		assertThat(criteria.filters()).hasSize(1);
		assertThat(criteria.filters().get(0).field()).isEqualTo(AgencyField.NAME);
		assertThat(criteria.filters().get(0).value()).isEqualTo("Acme");
		assertThat(criteria.filters().get(0).operation()).isEqualTo(FilterOperation.CONTAINS);
		assertThat(criteria.sort().field()).isEqualTo(AgencyField.STATUS);
		assertThat(criteria.sort().direction()).isEqualTo(SortDirection.ASC);
	}

	@Test
	void shouldMapPageIntoOneBasedPageResponseTest() {
		// Given:
		AgencySearchContractMapper mapper = new AgencySearchContractMapper(new SearchContractSupport(), agencyMapper);
		AgencyModel model = Instancio.create(AgencyModel.class);
		AgencyV1 agencyV1 = Instancio.create(AgencyV1.class);
		PageImpl<AgencyModel> page = new PageImpl<>(List.of(model), PageRequest.of(0, 2), 5);
		when(agencyMapper.toV1(page.getContent())).thenReturn(List.of(agencyV1));

		// When:
		AgencyPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(1);
		assertThat(response.getPageSize()).isEqualTo(2);
		assertThat(response.getTotalElements()).isEqualTo(5);
		assertThat(response.getTotalPages()).isEqualTo(3);
		assertThat(response.getContent()).containsExactly(agencyV1);
	}
}
