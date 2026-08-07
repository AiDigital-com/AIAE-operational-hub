package com.aidigital.operationalhub.externalservices.bigquery;

import java.util.List;
import java.util.Map;

/**
 * Narrow application-facing interface for BigQuery SQL queries.
 *
 * <p>Credentials are sourced from
 * {@link com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties}
 * only and are never logged.
 *
 * @see com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException for error semantics
 */
public interface BigQueryClient {

	/**
	 * Runs a read-only SQL query against the configured BigQuery project and returns each row as a
	 * map of column name to value.
	 *
	 * @param sql the standard SQL query to execute
	 * @return the result rows, never {@code null}
	 * @throws BigQueryExternalException on query failure or credential error
	 */
	List<Map<String, Object>> query(String sql);
}
