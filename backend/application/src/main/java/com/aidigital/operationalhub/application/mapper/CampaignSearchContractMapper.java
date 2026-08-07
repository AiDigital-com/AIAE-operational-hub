package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignFilterFieldV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps the campaign search contract to service criteria and back to the page response.
 */
@Component
@RequiredArgsConstructor
public class CampaignSearchContractMapper {

	private final SearchContractSupport support;

	/**
	 * Builds the service search criteria from the request body and paging parameters.
	 *
	 * @param request    the search request body, may be {@code null}
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the service search criteria
	 */
	public SearchCriteria<CampaignField> toCriteria(
			CampaignSearchRequestV1 request, int pageNumber, int pageSize) {
		List<FilterCriterion<CampaignField>> filters = support.toFilters(
				request == null ? null : request.getFilters(),
				filter -> {
					CampaignFilterFieldEnumV1 field = filter.getField();
					return field == null ? null : field.name();
				},
				CampaignFilterFieldV1::getValue,
				CampaignFilterFieldV1::getOperation,
				CampaignFilterFieldV1::getCaseSensitive,
				CampaignField::valueOf);
		SortCriterion<CampaignField> sort = support.toSort(
				request == null ? null : request.getSorting(),
				s -> {
					CampaignSortFieldEnumV1 field = s.getField();
					return field == null ? null : field.name();
				},
				s -> {
					DirectionEnumV1 direction = s.getDirection();
					return direction == null ? null : direction;
				},
				CampaignField::valueOf);
		return new SearchCriteria<>(filters, sort, pageNumber, pageSize);
	}

	/**
	 * Maps a page of campaign models into the generated page response.
	 *
	 * @param page the page of campaigns
	 * @return the generated page response
	 */
	public CampaignPageResponseV1 toPageResponse(Page<CampaignModel> page) {
		CampaignPageResponseV1 response = new CampaignPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(page.getContent().stream().map(this::toV1).toList());
		return response;
	}

	/**
	 * Maps a single campaign model into the generated contract.
	 *
	 * @param model the campaign model
	 * @return the generated campaign V1
	 */
	public CampaignV1 toV1(CampaignModel model) {
		CampaignV1 v1 = new CampaignV1();
		v1.setId(model.id());
		v1.setName(model.name());
		v1.setClientId(model.clientId());
		v1.setClientName(model.clientName());
		v1.setAgencyId(model.agencyId());
		v1.setAgencyName(model.agencyName());
		v1.setStatus(model.status());
		v1.setStartDate(model.startDate());
		v1.setEndDate(model.endDate());
		v1.setBudget(model.budget());
		v1.setChannels(model.channels());
		v1.setIndustryVertical(model.industryVertical());
		v1.setLineItemCount(model.lineItemCount());
		return v1;
	}
}
