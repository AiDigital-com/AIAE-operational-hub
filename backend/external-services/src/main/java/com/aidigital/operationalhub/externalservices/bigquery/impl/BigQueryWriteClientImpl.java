package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.RetryOption;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQueryOptions;
import com.google.cloud.bigquery.Job;
import com.google.cloud.bigquery.JobInfo;
import com.google.cloud.bigquery.JobStatistics;
import com.google.cloud.bigquery.QueryJobConfiguration;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.threeten.bp.Duration;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Production implementation of {@link BigQueryWriteClient} backed by the
 * {@code com.google.cloud:google-cloud-bigquery} SDK.
 *
 * <p>A service-account JSON key is loaded once at construction from the inline JSON in
 * {@link BigQueryProperties#getCredentialsJson()}. The credential contents are never logged.
 *
 * <p>Statements are executed with the BigQuery scope alone. The read client additionally carries a Drive
 * scope for the Sheets-backed external tables some of its views read through; this client writes only to
 * the app's own native tables, so it has nothing to fetch from Drive.
 *
 * <p>Unlike the read client's {@code BigQuery#query(...)} convenience call (which only returns a {@link
 * com.google.cloud.bigquery.TableResult}), this submits the job explicitly via {@code create(...)} +
 * {@code waitFor(...)} so the affected-row count can be read from the job's own statistics — a DML
 * statement's {@code TableResult} carries no row data to derive it from.
 */
@Slf4j
@RequiredArgsConstructor
public class BigQueryWriteClientImpl implements BigQueryWriteClient {

	/**
	 * The OAuth scope the write token carries. Deliberately narrower than
	 * {@code BigQueryClientImpl}'s: no Drive, because every statement this client runs targets a native
	 * table.
	 */
	private static final String SCOPE = "https://www.googleapis.com/auth/bigquery";

	private final BigQueryProperties properties;
	private final BigQuery bigQuery;

	/**
	 * Constructs the client and authenticates using the configured service-account JSON string.
	 *
	 * @param properties BigQuery configuration (project ID, dataset, credentials JSON)
	 * @throws BigQueryExternalException when credentials cannot be loaded
	 */
	public BigQueryWriteClientImpl(BigQueryProperties properties) {
		this.properties = properties;
		log.info("Initialising BigQuery write client: project={}, dataset={}",
				properties.getProjectId(), properties.getDataset());
		String credentialsJson = properties.getCredentialsJson();

		try (var inputStream = new ByteArrayInputStream(credentialsJson.getBytes(StandardCharsets.UTF_8))) {
			GoogleCredentials credentials = GoogleCredentials
					.fromStream(inputStream)
					.createScoped(SCOPE);
			this.bigQuery = BigQueryOptions.newBuilder()
					.setProjectId(properties.getProjectId())
					.setCredentials(credentials)
					.build()
					.getService();
		} catch (IOException ex) {
			throw new BigQueryExternalException(
					"Failed to load BigQuery credentials — check app.external.bigquery.credentials-json", ex);
		}
	}

	/**
	 * {@inheritDoc}
	 *
	 * <p>Bounded by {@link BigQueryProperties#getJobTimeoutMs()} both as the job's own deadline and as
	 * the wait's retry-total-timeout budget, mirroring {@link BigQueryClientImpl#query(String)}.
	 *
	 * @throws BigQueryExternalException on statement failure, timeout, or SDK error
	 */
	@Override
	public long execute(String sql) {
		log.debug("Running BigQuery DML statement:\nproject = {},\ndataset = {},\nstatement = {}",
				properties.getProjectId(), properties.getDataset(), sql);
		try {
			QueryJobConfiguration config = QueryJobConfiguration.newBuilder(sql)
					.setUseLegacySql(false)
					.setJobTimeoutMs(properties.getJobTimeoutMs())
					.build();
			Job job = bigQuery.create(JobInfo.of(config));
			job = job.waitFor(RetryOption.totalTimeout(Duration.ofMillis(properties.getJobTimeoutMs())));
			if (job == null) {
				throw new BigQueryExternalException("BigQuery write job no longer exists after waiting");
			}
			if (job.getStatus().getError() != null) {
				throw new BigQueryExternalException("BigQuery write job failed: " + job.getStatus().getError());
			}
			return numAffectedRows(job);
		} catch (BigQueryExternalException ex) {
			throw ex;
		} catch (Exception ex) {
			throw new BigQueryExternalException("BigQuery write statement failed", ex);
		}
	}

	/**
	 * Reads the number of rows a completed DML job affected from its query statistics.
	 *
	 * @param job the completed, error-free write job
	 * @return the number of rows written, or {@code 0} when the SDK reports none
	 */
	private long numAffectedRows(Job job) {
		JobStatistics.QueryStatistics stats = job.getStatistics();
		Long affected = stats == null ? null : stats.getNumDmlAffectedRows();
		return affected == null ? 0L : affected;
	}
}
