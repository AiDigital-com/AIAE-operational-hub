package com.aidigital.operationalhub.service.dashboard.model;

/**
 * What a dashboard's data source would contain if it were created right now.
 *
 * @param rowCount        how many rows the query returns today
 * @param optionalColumns whether each optional column is kept, so the preview and the write cannot disagree
 *                        about the shape being counted
 * @param sourceTable     the fully-qualified table name the create-source action will replace
 */
public record DashboardPreview(long rowCount, DashboardColumnChoice optionalColumns, String sourceTable) {
}
