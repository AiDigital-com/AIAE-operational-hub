package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSortFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSummaryV1;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
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
 * Unit tests for {@link HubUserSearchContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class HubUserSearchContractMapperTest {

	@Mock
	private HubUserContractMapper userMapper;

	@Test
	void shouldBuildEmptyCriteriaFromNullRequestTest() {
		// Given:
		HubUserSearchContractMapper mapper = new HubUserSearchContractMapper(new SearchContractSupport(), userMapper);

		// When:
		SearchCriteria<HubUserField> criteria = mapper.toCriteria(null, 2, 25);

		// Then:
		assertThat(criteria.filters()).isEmpty();
		assertThat(criteria.sort()).isNull();
		assertThat(criteria.pageNumber()).isEqualTo(2);
		assertThat(criteria.pageSize()).isEqualTo(25);
	}

	@Test
	void shouldMapFiltersAndSortFromRequestBodyTest() {
		// Given:
		HubUserSearchContractMapper mapper = new HubUserSearchContractMapper(new SearchContractSupport(), userMapper);
		HubUserFilterFieldV1 filter = new HubUserFilterFieldV1();
		filter.setField(HubUserFilterFieldEnumV1.ROLE_CODE);
		filter.setValue("ADMIN");
		filter.setOperation(FilterOperationEnumV1.EQUALS);
		filter.setCaseSensitive(true);
		HubUserSortFieldV1 sort = new HubUserSortFieldV1();
		sort.setField(HubUserSortFieldEnumV1.EMAIL);
		sort.setDirection(DirectionEnumV1.DESC);
		HubUserSearchRequestV1 request = new HubUserSearchRequestV1();
		request.setFilters(List.of(filter));
		request.setSorting(sort);

		// When:
		SearchCriteria<HubUserField> criteria = mapper.toCriteria(request, 1, 20);

		// Then:
		assertThat(criteria.filters()).hasSize(1);
		assertThat(criteria.filters().get(0).field()).isEqualTo(HubUserField.ROLE_CODE);
		assertThat(criteria.filters().get(0).value()).isEqualTo("ADMIN");
		assertThat(criteria.filters().get(0).operation()).isEqualTo(FilterOperation.EQUALS);
		assertThat(criteria.filters().get(0).caseSensitive()).isTrue();
		assertThat(criteria.sort().field()).isEqualTo(HubUserField.EMAIL);
		assertThat(criteria.sort().direction()).isEqualTo(SortDirection.DESC);
	}

	@Test
	void shouldMapPageIntoOneBasedPageResponseTest() {
		// Given:
		HubUserSearchContractMapper mapper = new HubUserSearchContractMapper(new SearchContractSupport(), userMapper);
		HubUserSummaryModel model = Instancio.create(HubUserSummaryModel.class);
		HubUserSummaryV1 userV1 = Instancio.create(HubUserSummaryV1.class);
		PageImpl<HubUserSummaryModel> page = new PageImpl<>(List.of(model), PageRequest.of(1, 20), 42);
		when(userMapper.toV1(page.getContent())).thenReturn(List.of(userV1));

		// When:
		HubUserPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(20);
		assertThat(response.getTotalElements()).isEqualTo(42);
		assertThat(response.getTotalPages()).isEqualTo(3);
		assertThat(response.getContent()).containsExactly(userV1);
	}
}
