package com.aidigital.operationalhub.externalservices.bigquery.config;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.impl.BigQueryClientImpl;
import com.aidigital.operationalhub.externalservices.bigquery.impl.BigQueryStubClient;
import com.aidigital.operationalhub.externalservices.bigquery.impl.BigQueryWriteClientImpl;
import com.aidigital.operationalhub.externalservices.bigquery.impl.BigQueryWriteStubClient;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Selects the active {@link BigQueryClient} implementation from properties.
 *
 * <p>{@code stub-enabled=true} activates {@link BigQueryStubClient} for local development without
 * Google credentials. Production mode requires {@code enabled=true}, credentials, and project id.
 */
@Configuration
@EnableConfigurationProperties(BigQueryProperties.class)
public class BigQueryConfig {

	/**
	 * Stub client for local development (no credentials).
	 *
	 * @param properties BigQuery configuration properties
	 * @return in-memory stub client
	 */
	@Bean
	@ConditionalOnProperty(prefix = "app.external.bigquery", name = "stub-enabled", havingValue = "true")
	public BigQueryClient bigQueryStubClient(BigQueryProperties properties) {
		return new BigQueryStubClient(properties);
	}

	/**
	 * Production client backed by the Google Cloud SDK.
	 *
	 * @param properties    BigQuery configuration properties
	 * @param meterRegistry registry the client's per-query {@code bigquery.query} timer is recorded against
	 * @param operationContext names the operation each job belongs to
	 * @return production client
	 */
	@Bean
	@ConditionalOnExpression(
			"${app.external.bigquery.enabled:false} && !${app.external.bigquery.stub-enabled:false}")
	public BigQueryClient bigQueryClient(BigQueryProperties properties, MeterRegistry meterRegistry,
			BigQueryOperationContext operationContext) {
		if (properties.getCredentialsJson() == null
				|| properties.getCredentialsJson().isBlank()) {
			throw new IllegalStateException(
					"app.external.bigquery.credentials-json must be set when BigQuery is enabled. "
							+ "Provide the service-account key JSON via BIGQUERY_CREDENTIALS_JSON, "
							+ "or enable app.external.bigquery.stub-enabled for local development.");
		}
		if (properties.getProjectId() == null || properties.getProjectId().isBlank()) {
			throw new IllegalStateException(
					"app.external.bigquery.project-id must be set when BigQuery is enabled. "
							+ "Set BIGQUERY_PROJECT_ID.");
		}
		return new BigQueryClientImpl(properties, meterRegistry, operationContext);
	}

	/**
	 * Stub write client for local development (no credentials) — reports zero rows written.
	 *
	 * @param properties BigQuery configuration properties
	 * @return in-memory stub write client
	 */
	@Bean
	@ConditionalOnProperty(prefix = "app.external.bigquery", name = "stub-enabled", havingValue = "true")
	public BigQueryWriteClient bigQueryWriteStubClient(BigQueryProperties properties) {
		return new BigQueryWriteStubClient(properties);
	}

	/**
	 * Production write client backed by the Google Cloud SDK, authenticated with the read-write scope a
	 * DML query job requires (distinct from {@link #bigQueryClient(BigQueryProperties)}'s read-only
	 * scope).
	 *
	 * @param properties    BigQuery configuration properties
	 * @param meterRegistry registry the client's per-statement {@code bigquery.write} meters are recorded against
	 * @param operationContext names the operation each job belongs to
	 * @return production write client
	 */
	@Bean
	@ConditionalOnExpression(
			"${app.external.bigquery.enabled:false} && !${app.external.bigquery.stub-enabled:false}")
	public BigQueryWriteClient bigQueryWriteClient(BigQueryProperties properties, MeterRegistry meterRegistry,
			BigQueryOperationContext operationContext) {
		if (properties.getCredentialsJson() == null
				|| properties.getCredentialsJson().isBlank()) {
			throw new IllegalStateException(
					"app.external.bigquery.credentials-json must be set when BigQuery is enabled. "
							+ "Provide the service-account key JSON via BIGQUERY_CREDENTIALS_JSON, "
							+ "or enable app.external.bigquery.stub-enabled for local development.");
		}
		if (properties.getProjectId() == null || properties.getProjectId().isBlank()) {
			throw new IllegalStateException(
					"app.external.bigquery.project-id must be set when BigQuery is enabled. "
							+ "Set BIGQUERY_PROJECT_ID.");
		}
		return new BigQueryWriteClientImpl(properties, meterRegistry, operationContext);
	}
}
