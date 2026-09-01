package com.aidigital.operationalhub.application.mapper;

/**
 * One column of a Basic dashboard's fixed preview schema, as {@link DashboardDatasetXlsxExportAssembler}
 * renders it - mirrors one entry of the Dashboards tab's own {@code BASIC_DIMENSIONS}/{@code BASIC_METRICS}
 * TypeScript lists, which the Java side cannot share directly across the frontend/backend boundary.
 *
 * @param id       the column id, matching the preview table's own column id
 * @param label    the Excel header label, matching the preview table's own column header
 * @param field    the BigQuery output alias the value is read from, or {@code null} for the one derived
 *                 column (CPA), which has no output alias of its own
 * @param optional whether the dashboard's column selection may switch this column off
 */
public record DashboardExportColumn(String id, String label, String field, boolean optional) {
}
