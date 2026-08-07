package com.aidigital.operationalhub.service.dashboard.model;

import java.util.Map;

/**
 * One row of a dashboard data-source preview.
 *
 * @param values column alias to value, ordered as the dashboard template emits columns
 */
public record DashboardDatasetRow(Map<String, Object> values) {
}
