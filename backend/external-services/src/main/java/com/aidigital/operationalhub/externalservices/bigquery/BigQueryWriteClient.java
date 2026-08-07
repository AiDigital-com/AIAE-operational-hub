package com.aidigital.operationalhub.externalservices.bigquery;

/**
 * Narrow application-facing interface for BigQuery data-manipulation (write) statements.
 *
 * <p>Distinct from {@link BigQueryClient} (read-only scope): this client authenticates with the
 * read-write BigQuery scope, since a DML query job requires it. Credentials are sourced from
 * {@link com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties} only and are
 * never logged.
 *
 * @see BigQueryExternalException for error semantics
 */
public interface BigQueryWriteClient {

	/**
	 * Runs a data-manipulation statement (e.g. {@code INSERT}) against the configured BigQuery project
	 * and returns the number of rows the statement affected.
	 *
	 * @param sql the standard SQL DML statement to execute
	 * @return the number of rows written
	 * @throws BigQueryExternalException on failure or credential error
	 */
	long execute(String sql);

	/**
	 * Runs a statement with an explicit time budget, for work whose shape makes the default one wrong.
	 *
	 * @param sql       the standard SQL statement to execute
	 * @param timeoutMs the maximum time the job may run, in milliseconds
	 * @return the number of rows written, or {@code 0} for a statement that reports none (e.g. DDL)
	 * @throws BigQueryExternalException on failure or credential error
	 */
	long execute(String sql, long timeoutMs);
}
