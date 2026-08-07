package com.aidigital.operationalhub.service.agency.model;

import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;

import java.util.List;

/**
 * A single dimension's multi-value filter directive for the report-rows table - a row matches when its
 * value for {@code field} is any of {@code values} (IN). Distinct from the shared, single-value
 * {@link com.aidigital.operationalhub.service.common.search.FilterCriterion} used by the agency/client/
 * campaign searches, since a report-rows filter picker lets a user select several values for the same
 * dimension at once (see the mockup's checkbox-list filter popovers).
 *
 * @param field  the dimension filtered on - never a metric (see {@link ReportRowSortField#numeric()})
 * @param values the dimension's values to match; never {@code null}
 */
public record ReportRowFilterModel(ReportRowSortField field, List<String> values) {
}
