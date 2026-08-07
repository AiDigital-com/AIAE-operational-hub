package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencySortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps the agency search contract to service criteria and back to the page response.
 */
@Component
@RequiredArgsConstructor
public class AgencySearchContractMapper {

	private final SearchContractSupport support;
	private final AgencyContractMapper agencyMapper;

	/**
	 * Builds the service search criteria from the request body and paging parameters.
	 *
	 * @param request    the search request body, may be {@code null}
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the service search criteria
	 */
	public SearchCriteria<AgencyField> toCriteria(
			AgencySearchRequestV1 request, int pageNumber, int pageSize) {
		List<FilterCriterion<AgencyField>> filters = support.toFilters(
				request == null ? null : request.getFilters(),
				filter -> {
					AgencyFilterFieldEnumV1 field = filter.getField();
					return field == null ? null : field.name();
				},
				AgencyFilterFieldV1::getValue,
				AgencyFilterFieldV1::getOperation,
				AgencyFilterFieldV1::getCaseSensitive,
				AgencyField::valueOf);
		SortCriterion<AgencyField> sort = support.toSort(
				request == null ? null : request.getSorting(),
				s -> {
					AgencySortFieldEnumV1 field = s.getField();
					return field == null ? null : field.name();
				},
				s -> {
					DirectionEnumV1 direction = s.getDirection();
					return direction == null ? null : direction;
				},
				AgencyField::valueOf);
		return new SearchCriteria<>(filters, sort, pageNumber, pageSize);
	}

	/**
	 * Maps a page of agency models into the generated page response.
	 *
	 * @param page the page of agencies
	 * @return the generated page response
	 */
	public AgencyPageResponseV1 toPageResponse(Page<AgencyModel> page) {
		AgencyPageResponseV1 response = new AgencyPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(agencyMapper.toV1(page.getContent()));
		return response;
	}
}
