package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ClientFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ClientSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps the client search contract to service criteria and back to the page response.
 */
@Component
@RequiredArgsConstructor
public class ClientSearchContractMapper {

	private final SearchContractSupport support;
	private final ClientContractMapper clientMapper;

	/**
	 * Builds the service search criteria from the request body and paging parameters.
	 *
	 * @param request    the search request body, may be {@code null}
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the service search criteria
	 */
	public SearchCriteria<ClientField> toCriteria(
			ClientSearchRequestV1 request, int pageNumber, int pageSize) {
		List<FilterCriterion<ClientField>> filters = support.toFilters(
				request == null ? null : request.getFilters(),
				filter -> {
					ClientFilterFieldEnumV1 field = filter.getField();
					return field == null ? null : field.name();
				},
				ClientFilterFieldV1::getValue,
				ClientFilterFieldV1::getOperation,
				ClientFilterFieldV1::getCaseSensitive,
				ClientField::valueOf);
		SortCriterion<ClientField> sort = support.toSort(
				request == null ? null : request.getSorting(),
				s -> {
					ClientSortFieldEnumV1 field = s.getField();
					return field == null ? null : field.name();
				},
				s -> {
					DirectionEnumV1 direction = s.getDirection();
					return direction == null ? null : direction;
				},
				ClientField::valueOf);
		return new SearchCriteria<>(filters, sort, pageNumber, pageSize);
	}

	/**
	 * Maps a page of client models into the generated page response.
	 *
	 * @param page the page of clients
	 * @return the generated page response
	 */
	public ClientPageResponseV1 toPageResponse(Page<ClientModel> page) {
		ClientPageResponseV1 response = new ClientPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(clientMapper.toV1(page.getContent()));
		return response;
	}
}
