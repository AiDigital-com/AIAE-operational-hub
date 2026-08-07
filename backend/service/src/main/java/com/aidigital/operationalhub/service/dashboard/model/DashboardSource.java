package com.aidigital.operationalhub.service.dashboard.model;

import java.time.LocalDateTime;

/**
 * The outcome of writing a dashboard's data source to BigQuery: which table now holds it, how many rows it
 * received, and when.
 *
 * <p>Carried as one value rather than three parameters because the three are only ever true together - a
 * table name without its row count describes a source nobody can trust, and either without a timestamp
 * cannot be told apart from an older write.
 *
 * @param table     fully-qualified BigQuery table the source was written to, as it must be typed into ClicData
 * @param rowCount  how many rows the write put in that table
 * @param writtenAt when the write completed, as reported by the caller that performed it
 */
public record DashboardSource(String table, long rowCount, LocalDateTime writtenAt) {
}
