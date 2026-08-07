package com.aidigital.operationalhub.service.dashboard.model;

import java.util.List;

/**
 * One dashboard-dataset column filter.
 *
 * @param field  the dashboard output column alias
 * @param values accepted values for that column
 */
public record DashboardDatasetFilter(String field, List<String> values) {
}
