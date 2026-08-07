package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
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
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.threeten.bp.Duration;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Production implementation of {@link BigQueryWriteClient} backed by the
 * {@code com.google.cloud:google-cloud-bigquery} SDK.
 *
 * <p>A service-account JSON key is loaded once at construction from the inline JSON in
 * {@link BigQueryProperties#getCredentialsJson()}. The credential contents are never logged.
 *
 * <p>Statements are executed with the BigQuery and Drive scopes, the same pair the read client carries:
 * this client writes to the app's own native tables, but the statement that fills one of them reads a
 * Sheets-backed view to do it (see {@link #SCOPES}).
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
	 * OAuth scopes the write token carries, the same pair {@code BigQueryClientImpl} reads with.
	 *
	 * <p>Drive is not decoration here either, though it was once absent on the grounds that every
	 * statement this client runs targets a native table. That stopped being true when
	 * {@code replaceTable} arrived: its {@code CREATE OR REPLACE TABLE ... AS SELECT} reads the
	 * conversions view, which is built over an external table backed by Google Sheets. BigQuery fetches
	 * that through the caller's own token, so a token without a Drive scope fails with
	 * {@code Permission denied while getting Drive credentials} whatever the service account's BigQuery
	 * IAM says. The sheet must additionally be shared with the service account - the scope is the token's
	 * half of the requirement, the share is Drive's half.
	 */
	private static final List<String> SCOPES = List.of(
			"https://www.googleapis.com/auth/bigquery",
			"https://www.googleapis.com/auth/drive.readonly");

	private static final String METRIC_WRITE = "bigquery.write";
	private static final String METRIC_BYTES_BILLED = "bigquery.write.bytes.billed";
	private static final String METRIC_SLOT_MS = "bigquery.write.slot.ms";
	private static final String TAG_OUTCOME = "outcome";
	private static final String TAG_OPERATION = "operation";
	private static final String LABEL_OPERATION = "oph_operation";
	private static final String OUTCOME_SUCCESS = "success";
	private static final String OUTCOME_ERROR = "error";

	private final BigQueryProperties properties;
	private final BigQuery bigQuery;
	private final MeterRegistry meterRegistry;
	private final BigQueryOperationContext operationContext;

	/**
	 * Constructs the client and authenticates using the configured service-account JSON string.
	 *
	 * @param properties       BigQuery configuration (project ID, dataset, credentials JSON)
	 * @param meterRegistry    registry the per-statement {@code bigquery.write} meters are recorded against
	 * @param operationContext names the operation each job belongs to
	 * @throws BigQueryExternalException when credentials cannot be loaded
	 */
	public BigQueryWriteClientImpl(BigQueryProperties properties, MeterRegistry meterRegistry,
								   BigQueryOperationContext operationContext) {
		this.properties = properties;
		this.meterRegistry = meterRegistry;
		this.operationContext = operationContext;
		log.info("Initialising BigQuery write client: project={}, dataset={}",
				properties.getProjectId(), properties.getDataset());
		String credentialsJson = properties.getCredentialsJson();

		try (var inputStream = new ByteArrayInputStream(credentialsJson.getBytes(StandardCharsets.UTF_8))) {
			GoogleCredentials credentials = GoogleCredentials
					.fromStream(inputStream)
					.createScoped(SCOPES);
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
		return execute(sql, properties.getJobTimeoutMs());
	}

	@Override
	public long execute(String sql, long timeoutMs) {
		log.debug("Running BigQuery DML statement:\nproject = {},\ndataset = {},\nstatement = {}",
				properties.getProjectId(), properties.getDataset(), sql);
		Timer.Sample sample = Timer.start(meterRegistry);
		String operation = operationContext.current();
		String outcome = OUTCOME_SUCCESS;
		// Held apart: the submitted job is what names a failure, and it exists from the moment of submission -
		// including when the wait is interrupted or the job comes back with an error. The finished job is what
		// carries statistics, and only exists once BigQuery has answered.
		Job submitted = null;
		Job finished = null;
		long affected = 0L;
		try {
			QueryJobConfiguration config = QueryJobConfiguration.newBuilder(sql)
					.setUseLegacySql(false)
					.setLabels(Map.of(LABEL_OPERATION, operation))
					.setJobTimeoutMs(timeoutMs)
					.build();
			submitted = bigQuery.create(JobInfo.of(config));
			finished = submitted.waitFor(RetryOption.totalTimeout(Duration.ofMillis(timeoutMs)));
			if (finished == null) {
				outcome = OUTCOME_ERROR;
				throw new BigQueryExternalException("BigQuery write job no longer exists after waiting"
						+ BigQueryJobs.suffix(submitted));
			}
			if (finished.getStatus() != null && finished.getStatus().getError() != null) {
				outcome = OUTCOME_ERROR;
				throw new BigQueryExternalException("BigQuery write job failed"
						+ BigQueryJobs.suffix(finished) + ": " + finished.getStatus().getError());
			}
			affected = numAffectedRows(finished);
			return affected;
		} catch (BigQueryExternalException ex) {
			outcome = OUTCOME_ERROR;
			throw ex;
		} catch (InterruptedException ex) {
			outcome = OUTCOME_ERROR;
			// Restored: the caller is being abandoned mid-write, and whoever interrupted it is entitled to see
			// that the interruption took effect. The BigQuery job itself outlives this thread either way.
			Thread.currentThread().interrupt();
			throw new BigQueryExternalException("BigQuery write interrupted"
					+ BigQueryJobs.suffix(submitted), ex);
		} catch (Exception ex) {
			outcome = OUTCOME_ERROR;
			throw new BigQueryExternalException("BigQuery write statement failed"
					+ BigQueryJobs.suffix(submitted), ex);
		} finally {
			// Recorded whatever the outcome: a table rebuild that failed on a resource limit spent bytes and
			// slots getting there, and a distribution that only counts successes describes a cheaper Hub than
			// the one being billed for.
			if (finished != null) {
				recordStatistics(finished, operation, outcome, affected);
			}
			sample.stop(Timer.builder(METRIC_WRITE)
					.description("BigQuery write latency, by the operation that asked")
					.tag(TAG_OPERATION, operation)
					.tag(TAG_OUTCOME, outcome)
					.register(meterRegistry));
		}
	}

	/**
	 * Records what the completed statement cost, to the log and to the meter registry.
	 *
	 * <p>A dashboard's data source rebuilds a whole table from a campaign's entire history, which makes this
	 * the most expensive single job the Hub runs. Duration alone does not say whether that cost came from the
	 * bytes read or from waiting on slots, and only the job knows.
	 *
	 * <p>Never throws: losing a measurement must not turn a completed write into a failed one.
	 *
	 * @param job       the completed write job, whether or not it succeeded
	 * @param operation the operation this write belongs to
	 * @param outcome   whether the job succeeded, so a costly failure is not counted as a cheap success
	 * @param affected  how many rows the statement reported affecting
	 */
	void recordStatistics(Job job, String operation, String outcome, long affected) {
		try {
			JobStatistics.QueryStatistics statistics = job.getStatistics();
			if (statistics == null) {
				return;
			}
			log.info("BigQuery write finished: outcome={}, operation={}, job={}, affectedRows={},"
							+ " bytesProcessed={}, bytesBilled={}, slotMs={}",
					outcome, operation, BigQueryJobs.id(job), affected,
					statistics.getTotalBytesProcessed(), statistics.getTotalBytesBilled(),
					statistics.getTotalSlotMs());
			record(METRIC_BYTES_BILLED, "Bytes BigQuery billed for one write", operation, outcome,
					statistics.getTotalBytesBilled());
			record(METRIC_SLOT_MS, "Slot milliseconds one write consumed", operation, outcome,
					statistics.getTotalSlotMs());
		} catch (RuntimeException ex) {
			log.warn("Could not record BigQuery write statistics: {}", ex.getMessage());
		}
	}

	/**
	 * Records one value on a distribution, skipping the ones BigQuery left unset.
	 *
	 * @param name        the meter name
	 * @param description what the meter measures
	 * @param operation   the operation this write belongs to
	 * @param outcome     whether the job succeeded
	 * @param value       the measured value, or {@code null} when BigQuery reported none
	 */
	void record(String name, String description, String operation, String outcome, Long value) {
		if (value == null) {
			return;
		}
		DistributionSummary.builder(name)
				.description(description)
				.tag(TAG_OPERATION, operation)
				.tag(TAG_OUTCOME, outcome)
				.register(meterRegistry)
				.record(value);
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
