package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;

import java.util.List;

/**
 * Application-layer representation of one report-row search/export request after contract mapping.
 *
 * @param groupBy   dimensions to group by, in display order
 * @param sort      sort directive, or {@code null} for the service default
 * @param filters   value-list dimension filters
 * @param dateRange delivery-date window
 * @param columns   current-view export columns, dimensions followed by metrics
 */
public record ReportRowSearchCommand(
		List<ReportRowSortField> groupBy,
		SortCriterion<ReportRowSortField> sort,
		List<ReportRowFilterModel> filters,
		ReportRowDateRangeModel dateRange,
		List<String> columns) {

}
