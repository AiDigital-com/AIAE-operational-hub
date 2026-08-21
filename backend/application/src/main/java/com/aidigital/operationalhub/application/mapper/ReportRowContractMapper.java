package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowTotalsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowsPageResponseV1;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Maps {@link ReportRowModel}s to the generated report-row contract.
 */
@Component
@RequiredArgsConstructor
public class ReportRowContractMapper {

	private final ColumnOrderArranger columnOrderArranger;

	/**
	 * Maps one generated report-row request into the service-facing command shape used by list/export
	 * endpoints. Centralising this here keeps controllers from repeatedly spelling out the same optional
	 * request null checks and dimensions+metrics export-column merge.
	 *
	 * @param request the generated request body, or {@code null}
	 * @return mapped report-row command
	 */
	public ReportRowSearchCommand toSearchCommand(ReportRowSearchRequestV1 request) {
		return new ReportRowSearchCommand(
				toGroupBy(request == null ? null : request.getGroupBy()),
				request == null ? null : toSort(request.getSortField(), request.getSortDirection()),
				toFilters(request == null ? null : request.getFilters()),
				toDateRange(
						request == null ? null : request.getDateFrom(),
						request == null ? null : request.getDateTo()),
				toExportColumns(request));
	}

	/**
	 * Maps the current-view export column lists into workbook order: dimensions first, then metrics by
	 * default, then arranged by the request's saved {@code columnOrder} when one is given.
	 * {@code dimensions}/{@code metrics} alone still decide which columns are included -
	 * {@link ColumnOrderArranger} only decides where a selected column sits, and never resurrects an id
	 * that is not selected. A {@code null}/empty {@code columnOrder} leaves the default dimensions-then-
	 * metrics order byte-identical to the pre-{@code columnOrder} behaviour.
	 *
	 * @param request the generated request body, or {@code null}
	 * @return export columns, empty when none were requested
	 */
	public List<String> toExportColumns(ReportRowSearchRequestV1 request) {
		if (request == null) {
			return List.of();
		}
		List<String> columns = new ArrayList<>();
		if (request.getDimensions() != null) {
			columns.addAll(request.getDimensions());
		}
		if (request.getMetrics() != null) {
			columns.addAll(request.getMetrics());
		}
		return columnOrderArranger.arrange(columns, request.getColumnOrder());
	}

	/**
	 * Builds the service sort directive from the request's sortField/sortDirection query params.
	 * {@link ReportRowSortFieldEnumV1} and {@link ReportRowSortField} share constant names by
	 * construction, so the field maps by name with no lookup table to keep in sync.
	 *
	 * @param sortField     the requested sort dimension, or {@code null} for the default order
	 * @param sortDirection the requested sort direction, or {@code null} for ascending
	 * @return the sort directive, or {@code null} when no dimension was requested
	 */
	public SortCriterion<ReportRowSortField> toSort(ReportRowSortFieldEnumV1 sortField, DirectionEnumV1 sortDirection) {
		if (sortField == null) {
			return null;
		}
		SortDirection direction = sortDirection == DirectionEnumV1.DESC ? SortDirection.DESC : SortDirection.ASC;
		return new SortCriterion<>(ReportRowSortField.valueOf(sortField.name()), direction);
	}

	/**
	 * Maps the generated filter-field enum onto the same {@link ReportRowSortField} sorting reuses -
	 * {@link ReportRowFilterFieldEnumV1} is a dimension-only subset sharing constant names with it by
	 * construction, so it maps by name with no lookup table to keep in sync.
	 *
	 * @param field the requested filter dimension
	 * @return the matching sort field
	 */
	public ReportRowSortField toFilterField(ReportRowFilterFieldEnumV1 field) {
		return ReportRowSortField.valueOf(field.name());
	}

	/**
	 * Maps the request's group-by dimensions into their service-layer form, preserving display order -
	 * it is the order the grouped columns are selected and ordered by.
	 *
	 * @param dimensions the requested group-by dimensions, or {@code null} when the request carried none
	 * @return the mapped dimensions; never {@code null}, empty when {@code dimensions} is {@code null}
	 */
	public List<ReportRowSortField> toGroupBy(List<ReportRowFilterFieldEnumV1> dimensions) {
		if (dimensions == null) {
			return List.of();
		}
		return dimensions.stream().map(this::toFilterField).toList();
	}

	/**
	 * Maps the request's delivery-date window into its service-layer form.
	 *
	 * <p>No format validation here: the contract declares both bounds as {@code format: date}, so an
	 * unparseable value is rejected during deserialisation and never reaches this method. An inverted
	 * window (from after to) is passed through rather than rejected - it matches nothing, which is a
	 * truthful answer to the question that was asked.
	 *
	 * @param from the requested lower bound, or {@code null} for open-ended
	 * @param to   the requested upper bound, or {@code null} for open-ended
	 * @return the mapped window; never {@code null}
	 */
	public ReportRowDateRangeModel toDateRange(LocalDate from, LocalDate to) {
		return new ReportRowDateRangeModel(
				from == null ? null : from.toString(), to == null ? null : to.toString());
	}

	/**
	 * Maps the request's multi-value filter directives into their service-layer form.
	 *
	 * @param filters the requested filters, or {@code null} when the request carried none
	 * @return the mapped filters; never {@code null}, empty when {@code filters} is {@code null}
	 */
	public List<ReportRowFilterModel> toFilters(List<ReportRowFilterV1> filters) {
		if (filters == null) {
			return List.of();
		}
		return filters.stream()
				.map(filter -> new ReportRowFilterModel(toFilterField(filter.getField()), filter.getValues()))
				.toList();
	}

	/**
	 * Maps the request's adjustment DTOs to their service-layer form.
	 *
	 * @param adjustments the requested adjustments, or {@code null} when the request carried none
	 * @return the mapped adjustments; never {@code null}, empty when {@code adjustments} is {@code null}
	 */
	public List<AdjustmentRowModel> toAdjustmentModels(List<ReportRowAdjustmentV1> adjustments) {
		if (adjustments == null) {
			return List.of();
		}
		return adjustments.stream().map(this::toModel).toList();
	}

	/**
	 * Maps one adjustment DTO to its service-layer form. The derived ratios (cpm/ctr/avcr) have no
	 * field on {@link ReportRowAdjustmentV1} at all, so there is nothing to reject here - the contract
	 * itself makes them unsettable. Likewise for {@code rate_type}/{@code dynamic_rate}/{@code
	 * avg_dynamic_rate_by_date_tactic}/{@code line_item_description}: the write table has no columns for
	 * them, so the contract does not accept them either (see {@link AdjustmentRowModel}).
	 *
	 * @param v1 the adjustment DTO
	 * @return the mapped adjustment model
	 */
	AdjustmentRowModel toModel(ReportRowAdjustmentV1 v1) {
		return new AdjustmentRowModel(
				Boolean.TRUE.equals(v1.getAdded()),
				v1.getDate(), v1.getPlatform(), v1.getAccount(), v1.getAccountId(),
				v1.getLineItemName(), v1.getLineItemId(),
				v1.getInsertionOrderName(), v1.getInsertionOrderId(),
				v1.getCampaignConstructedName(), v1.getCampaignConstructedId(),
				v1.getAgencyId(), v1.getIndustryCode(), v1.getChannel(), v1.getTactic(),
				v1.getBuyingModel(), v1.getAudience(), v1.getUniqueLineItemId(), v1.getOther(),
				v1.getGeo(), v1.getCreativeTag(), v1.getMessage(), v1.getKeywordGroup(),
				v1.getFlightIdentifier(), v1.getLanguage(),
				v1.getImpressions(), v1.getClicks(), v1.getSpend(), v1.getStarts(), v1.getFirstQuartiles(),
				v1.getMidpoints(), v1.getThirdQuartiles(), v1.getCompletes(),
				v1.getDynamicCost(), v1.getLinkClicks(),
				v1.getAdjustedMetrics());
	}

	/**
	 * Maps a page of report row models into the generated page response.
	 *
	 * @param page the report row page
	 * @return the generated page response
	 */
	public ReportRowsPageResponseV1 toPageResponse(ReportRowPageModel page) {
		ReportRowsPageResponseV1 response = new ReportRowsPageResponseV1();
		response.setPageNumber(page.pageNumber());
		response.setPageSize(page.pageSize());
		response.setHasNext(page.hasNext());
		response.setTotalRows(page.totalRows());
		response.setContent(toV1(page.content()));
		response.setTotals(toV1(page.totals()));
		response.setMinDate(page.minDate());
		response.setMaxDate(page.maxDate());
		response.setDistinctLineItemCount(page.distinctLineItemCount());
		return response;
	}

	/**
	 * Maps a list of report row models into their generated contract form.
	 *
	 * @param rows the report row models
	 * @return the generated report row list
	 */
	List<ReportRowV1> toV1(List<ReportRowModel> rows) {
		return rows.stream().map(this::toV1).toList();
	}

	/**
	 * Maps report row totals into the generated contract.
	 *
	 * @param totals the report row totals
	 * @return the generated totals V1
	 */
	ReportRowTotalsV1 toV1(ReportRowTotalsModel totals) {
		ReportRowTotalsV1 v1 = new ReportRowTotalsV1();
		v1.setImpressions(totals.impressions());
		v1.setClicks(totals.clicks());
		v1.setSpend(totals.spend());
		v1.setStarts(totals.starts());
		v1.setFirstQuartiles(totals.firstQuartiles());
		v1.setMidpoints(totals.midpoints());
		v1.setThirdQuartiles(totals.thirdQuartiles());
		v1.setCompletes(totals.completes());
		v1.setConversions(totals.conversions());
		v1.setPostClickConversions(totals.postClickConversions());
		v1.setPostViewConversions(totals.postViewConversions());
		v1.setDynamicCost(totals.dynamicCost());
		v1.setLinkClicks(totals.linkClicks());
		v1.setDynamicRate(totals.dynamicRate());
		v1.setAvgDynamicRateByDateTactic(totals.avgDynamicRateByDateTactic());
		v1.setCpm(totals.cpm());
		v1.setCpc(totals.cpc());
		v1.setCpv(totals.cpv());
		v1.setCtr(totals.ctr());
		v1.setAvcr(totals.avcr());
		v1.setIvt(totals.ivt());
		return v1;
	}

	/**
	 * Maps a single report row model into the generated contract.
	 *
	 * @param model the report row model
	 * @return the generated report row V1
	 */
	ReportRowV1 toV1(ReportRowModel model) {
		ReportRowV1 v1 = new ReportRowV1();
		v1.setDate(model.date());
		v1.setPlatform(model.platform());
		v1.setAccount(model.account());
		v1.setAccountId(model.accountId());
		v1.setLineItemName(model.lineItemName());
		v1.setLineItemId(model.lineItemId());
		v1.setInsertionOrderName(model.insertionOrderName());
		v1.setInsertionOrderId(model.insertionOrderId());
		v1.setCampaignConstructedName(model.campaignConstructedName());
		v1.setCampaignConstructedId(model.campaignConstructedId());
		v1.setAgencyId(model.agencyId());
		v1.setClient(model.client());
		v1.setIndustryCode(model.industryCode());
		v1.setCampaignName(model.campaignName());
		v1.setChannel(model.channel());
		v1.setTactic(model.tactic());
		v1.setBuyingModel(model.buyingModel());
		v1.setAudience(model.audience());
		v1.setUniqueLineItemId(model.uniqueLineItemId());
		v1.setOther(model.other());
		v1.setGeo(model.geo());
		v1.setCreativeTag(model.creativeTag());
		v1.setMessage(model.message());
		v1.setKeywordGroup(model.keywordGroup());
		v1.setFlightIdentifier(model.flightIdentifier());
		v1.setLanguage(model.language());
		v1.setImpressions(model.impressions());
		v1.setClicks(model.clicks());
		v1.setSpend(model.spend());
		v1.setStarts(model.starts());
		v1.setFirstQuartiles(model.firstQuartiles());
		v1.setMidpoints(model.midpoints());
		v1.setThirdQuartiles(model.thirdQuartiles());
		v1.setCompletes(model.completes());
		v1.setConversions(model.conversions());
		v1.setPostClickConversions(model.postClickConversions());
		v1.setPostViewConversions(model.postViewConversions());
		v1.setDynamicCost(model.dynamicCost());
		v1.setLinkClicks(model.linkClicks());
		v1.setAdjustedMetrics(model.adjustedMetrics());
		v1.setCreatedAt(model.createdAt());
		v1.setCreatedBy(model.createdBy());
		v1.setLastModifiedAt(model.lastModifiedAt());
		v1.setLastModifiedBy(model.lastModifiedBy());
		v1.setRateType(model.rateType());
		v1.setDynamicRate(model.dynamicRate());
		v1.setAvgDynamicRateByDateTactic(model.avgDynamicRateByDateTactic());
		v1.setLineItemDescription(model.lineItemDescription());
		v1.setIvt(model.ivt());
		v1.setCpm(model.cpm());
		v1.setCpc(model.cpc());
		v1.setCpv(model.cpv());
		v1.setCtr(model.ctr());
		v1.setAvcr(model.avcr());
		return v1;
	}
}
