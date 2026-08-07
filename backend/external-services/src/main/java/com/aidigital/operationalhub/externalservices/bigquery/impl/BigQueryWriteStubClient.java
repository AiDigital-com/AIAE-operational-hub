package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * No-op BigQuery write client for local development without Google credentials.
 *
 * <p>Logs the statement and reports zero rows written, so the Reporting tab's "Edit data"/"Add line"
 * flows can be exercised locally without contacting BigQuery.
 */
public class BigQueryWriteStubClient implements BigQueryWriteClient {

	private static final Logger LOG = LoggerFactory.getLogger(BigQueryWriteStubClient.class);

	private final BigQueryProperties properties;

	/**
	 * Constructs the stub client.
	 *
	 * @param properties BigQuery configuration properties
	 */
	public BigQueryWriteStubClient(BigQueryProperties properties) {
		this.properties = properties;
	}

	@Override
	public long execute(String sql) {
		LOG.debug("BigQuery write stub statement: project={}, dataset={}",
				properties.getProjectId(), properties.getDataset());
		return 0L;
	}

	@Override
	public long execute(String sql, long timeoutMs) {
		return execute(sql);
	}
}
