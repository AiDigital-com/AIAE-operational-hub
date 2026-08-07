package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

/**
 * In-memory BigQuery client for local development without Google credentials.
 *
 * <p>Returns an empty result set for every query so agency/client pages render their empty state
 * without contacting BigQuery.
 */
public class BigQueryStubClient implements BigQueryClient {

	private static final Logger LOG = LoggerFactory.getLogger(BigQueryStubClient.class);

	private final BigQueryProperties properties;

	/**
	 * Constructs the stub client.
	 *
	 * @param properties BigQuery configuration properties
	 */
	public BigQueryStubClient(BigQueryProperties properties) {
		this.properties = properties;
	}

	@Override
	public List<Map<String, Object>> query(String sql) {
		LOG.debug("BigQuery stub query: project={}, dataset={}",
				properties.getProjectId(), properties.getDataset());
		return List.of();
	}
}
