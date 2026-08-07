package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSortFieldEnumV1;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps the user-management search contract to service criteria and back to the page response.
 */
@Component
@RequiredArgsConstructor
public class HubUserSearchContractMapper {

	private final SearchContractSupport support;
	private final HubUserContractMapper userMapper;

	/**
	 * Builds the service search criteria from the request body and paging parameters.
	 *
	 * @param request    the search request body, may be {@code null}
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the service search criteria
	 */
	public SearchCriteria<HubUserField> toCriteria(
			HubUserSearchRequestV1 request, int pageNumber, int pageSize) {
		List<FilterCriterion<HubUserField>> filters = support.toFilters(
				request == null ? null : request.getFilters(),
				filter -> {
					HubUserFilterFieldEnumV1 field = filter.getField();
					return field == null ? null : field.name();
				},
				HubUserFilterFieldV1::getValue,
				HubUserFilterFieldV1::getOperation,
				HubUserFilterFieldV1::getCaseSensitive,
				HubUserField::valueOf);
		SortCriterion<HubUserField> sort = support.toSort(
				request == null ? null : request.getSorting(),
				s -> {
					HubUserSortFieldEnumV1 field = s.getField();
					return field == null ? null : field.name();
				},
				s -> {
					DirectionEnumV1 direction = s.getDirection();
					return direction == null ? null : direction;
				},
				HubUserField::valueOf);
		return new SearchCriteria<>(filters, sort, pageNumber, pageSize);
	}

	/**
	 * Maps a page of user summary models into the generated page response.
	 *
	 * @param page the page of user summaries
	 * @return the generated page response
	 */
	public HubUserPageResponseV1 toPageResponse(Page<HubUserSummaryModel> page) {
		HubUserPageResponseV1 response = new HubUserPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(userMapper.toV1(page.getContent()));
		return response;
	}
}
