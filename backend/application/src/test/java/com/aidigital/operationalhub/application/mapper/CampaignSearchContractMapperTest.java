package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSortFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link CampaignSearchContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class CampaignSearchContractMapperTest {

	@Mock
	private SearchContractSupport support;

	@InjectMocks
	private CampaignSearchContractMapper mapper;

	@Test
	void shouldMapCriteriaWithNullRequestTest() {
		// Given:
		// support.toFilters and support.toSort return null with null inputs

		// When:
		SearchCriteria<CampaignField> criteria = mapper.toCriteria(null, 1, 20);

		// Then:
		assertThat(criteria.pageNumber()).isEqualTo(1);
		assertThat(criteria.pageSize()).isEqualTo(20);
	}

	@Test
	void shouldMapCriteriaWithFiltersAndSortTest() {
		// Given:
		CampaignSearchRequestV1 request = new CampaignSearchRequestV1();
		CampaignFilterFieldV1 filter = new CampaignFilterFieldV1();
		filter.setField(CampaignFilterFieldEnumV1.NAME);
		filter.setValue("Fall");
		filter.setOperation(FilterOperationEnumV1.CONTAINS);
		filter.setCaseSensitive(false);
		request.setFilters(List.of(filter));
		CampaignSortFieldV1 sort = new CampaignSortFieldV1();
		sort.setField(CampaignSortFieldEnumV1.NAME);
		sort.setDirection(DirectionEnumV1.ASC);
		request.setSorting(sort);

		// When:
		SearchCriteria<CampaignField> criteria = mapper.toCriteria(request, 2, 10);

		// Then:
		assertThat(criteria.pageNumber()).isEqualTo(2);
		assertThat(criteria.pageSize()).isEqualTo(10);
	}

	@Test
	void shouldMapPageResponseTest() {
		// Given:
		CampaignModel model = new CampaignModel(1L, "Fall Campaign", 10L, "Space Coast",
				20L, "&Barr", "Finished", "2025-10-14", "2026-01-31",
				50000.0, List.of("Display", "Video"), "Automotive", 4L);
		var page = new PageImpl<>(List.of(model), PageRequest.of(0, 20), 1);

		// When:
		CampaignPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(1);
		assertThat(response.getPageSize()).isEqualTo(20);
		assertThat(response.getTotalElements()).isEqualTo(1L);
		assertThat(response.getContent()).hasSize(1);
		CampaignV1 v1 = response.getContent().get(0);
		assertThat(v1.getId()).isEqualTo(1L);
		assertThat(v1.getName()).isEqualTo("Fall Campaign");
		assertThat(v1.getClientId()).isEqualTo(10L);
		assertThat(v1.getClientName()).isEqualTo("Space Coast");
		assertThat(v1.getAgencyId()).isEqualTo(20L);
		assertThat(v1.getAgencyName()).isEqualTo("&Barr");
		assertThat(v1.getStatus()).isEqualTo("Finished");
		assertThat(v1.getStartDate()).isEqualTo("2025-10-14");
		assertThat(v1.getEndDate()).isEqualTo("2026-01-31");
		assertThat(v1.getBudget()).isEqualTo(50000.0);
		assertThat(v1.getChannels()).containsExactly("Display", "Video");
		assertThat(v1.getIndustryVertical()).isEqualTo("Automotive");
		assertThat(v1.getLineItemCount()).isEqualTo(4L);
	}

	@Test
	void shouldHandleNullFieldsInModelTest() {
		// Given:
		CampaignModel model = new CampaignModel(null, null, null, null,
				null, null, null, null, null, null, List.of(), null, null);
		var page = new PageImpl<>(List.of(model));

		// When:
		CampaignPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getContent()).hasSize(1);
		CampaignV1 v1 = response.getContent().get(0);
		assertThat(v1.getId()).isNull();
		assertThat(v1.getName()).isNull();
		assertThat(v1.getChannels()).isEmpty();
	}
}
